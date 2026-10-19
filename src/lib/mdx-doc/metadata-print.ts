import { parse } from "acorn";
import type { Program } from "estree";

import { metadataText, parseMetadata } from "./metadata";
import type { MetadataValue } from "./metadata";
import type { MdxDoc } from "./split";

/**
 * 다시 쓸 때 원본 스타일을 따른다(결정: 고정 스타일이 아니라 감지).
 * 고정 스타일이면 값을 안 바꾼 글도 첫 저장에 따옴표·들여쓰기 diff가 생겨 "바꾼 것만 커밋"이 깨진다.
 * 감지하지 못한 항목은 사이트의 prettier 기본값(큰따옴표, 2칸, 후행 쉼표)을 쓴다.
 */
export type MetadataStyle = { quote: '"' | "'"; indent: string; trailingComma: boolean; bareKeys: boolean };

const DEFAULT_STYLE: MetadataStyle = { quote: '"', indent: "  ", trailingComma: true, bareKeys: true };
const MAX_WIDTH = 120;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** 값이 바뀌었을 때만 metadata 블록을 다시 쓴다. 같거나 편집할 수 없는 metadata면 doc을 그대로 돌려준다. */
export function setMetadata(doc: MdxDoc, next: { [key: string]: MetadataValue }): MdxDoc {
  const original = metadataText(doc);
  if (!doc.ok || original === null) return doc;
  const current = parseMetadata(original);
  if (!current.editable || isEqual(current.value, next)) return doc;

  // metadata 구간은 한 글에 하나뿐이다. 같은 이름을 두 번 export하면 구문 오류라 구간으로 나뉘지 않는다.
  const head = doc.head.map((segment) =>
    segment.kind === "metadata" ? { ...segment, text: printMetadata(next, detectStyle(original)) } : segment,
  );
  return { ...doc, head };
}

export function printMetadata(value: { [key: string]: MetadataValue }, style: MetadataStyle = DEFAULT_STYLE): string {
  return `export const metadata = ${printValue(value, style, "", "export const metadata = ".length)};`;
}

export function detectStyle(text: string): MetadataStyle {
  let program: Program;
  try {
    program = parse(text, { ecmaVersion: "latest", sourceType: "module" }) as unknown as Program;
  } catch {
    return DEFAULT_STYLE;
  }
  const style = { ...DEFAULT_STYLE };
  const counts = { '"': 0, "'": 0 };
  let sawKey = false;
  let sawIndent = false;

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== "object") return;
    const n = node as { type?: string; start?: number; end?: number; raw?: string; value?: unknown } & Record<
      string,
      unknown
    >;
    if (n.type === "Literal" && typeof n.value === "string" && n.raw) counts[n.raw[0] === "'" ? "'" : '"']++;
    if (n.type === "TemplateLiteral") return;
    if (n.type === "ObjectExpression") {
      const props = n.properties as { key: { type: string }; start: number }[];
      for (const p of props) {
        if (!sawKey) {
          sawKey = true;
          style.bareKeys = p.key.type === "Identifier";
        }
        if (!sawIndent) {
          const lineStart = text.lastIndexOf("\n", p.start) + 1;
          const prefix = text.slice(lineStart, p.start);
          if (prefix !== "" && /^[ \t]+$/.test(prefix)) {
            sawIndent = true;
            style.indent = prefix;
          }
        }
      }
      if (props.length > 0 && n.end !== undefined && n.start === text.indexOf("{")) {
        style.trailingComma = /,\s*(\/\/[^\n]*\s*|\/\*[\s\S]*?\*\/\s*)*}$/.test(text.slice(0, n.end));
      }
    }
    Object.values(n).forEach(visit);
  };
  visit(program);
  if (counts["'"] > counts['"']) style.quote = "'";
  return style;
}

function printValue(value: MetadataValue, style: MetadataStyle, pad: string, column: number): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return printString(value, style.quote);

  const inner = pad + style.indent;
  const comma = style.trailingComma ? "," : "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => printValue(item, style, inner, 0));
    const inline = `[${items.join(", ")}]`;
    if (!inline.includes("\n") && column + inline.length + 1 <= MAX_WIDTH) return inline;
    return `[\n${items.map((item) => `${inner}${item}`).join(",\n")}${comma}\n${pad}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  const lines = entries.map(([key, item]) => {
    const printedKey = style.bareKeys && IDENTIFIER.test(key) ? key : printString(key, style.quote);
    const head = `${inner}${printedKey}: `;
    const printed = printValue(item, style, inner, head.length);
    // prettier처럼 긴 문자열은 키 다음 줄로 내린다.
    if (typeof item === "string" && head.length + printed.length + 1 > MAX_WIDTH) {
      return `${inner}${printedKey}:\n${inner}${style.indent}${printed}`;
    }
    return head + printed;
  });
  return `{\n${lines.join(",\n")}${comma}\n${pad}}`;
}

function printString(value: string, quote: '"' | "'"): string {
  const escaped = JSON.stringify(value).slice(1, -1).replaceAll('\\"', '"');
  return quote + escaped.replaceAll(quote, `\\${quote}`) + quote;
}

function isEqual(a: MetadataValue, b: MetadataValue): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => isEqual(item, b[i]!));
  }
  const keys = Object.keys(a);
  // 키 순서가 바뀐 것도 변경이다. 순서는 파일에 그대로 나타난다.
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key, i) => key === Object.keys(b)[i] && isEqual(a[key]!, b[key]!))
  );
}
