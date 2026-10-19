import { parse } from "acorn";
import type { Expression, Program } from "estree";

import type { MdxDoc } from "./split";

export type MetadataValue = string | number | boolean | null | MetadataValue[] | { [key: string]: MetadataValue };

export type MetadataResult =
  | { editable: true; value: { [key: string]: MetadataValue } }
  /** 폼으로 편집할 수 없는 metadata. 그 글은 원문 모드에서만 편집한다. */
  | { editable: false; reason: string };

export type MetadataLookup =
  | { kind: "found"; value: MetadataValue }
  | { kind: "missing" }
  /** 중간 키가 객체가 아니어서 그 안의 값을 읽거나 넣을 수 없다. */
  | { kind: "blocked"; reason: string };

class Unsupported extends Error {}

/**
 * doc.head에서 metadata 구간의 위치. 없으면 -1.
 * 빈 줄로 나뉜 ESM 블록은 따로 파싱되어 구간이 둘일 수 있다. 읽기와 다시 쓰기가 같은 구간을 고르도록 첫 구간 하나로 정한다.
 */
export function metadataIndex(doc: Extract<MdxDoc, { ok: true }>): number {
  return doc.head.findIndex((segment) => segment.kind === "metadata");
}

/** doc의 metadata 구간 원문. 구간으로 나눌 수 없는 글이거나 metadata export가 없으면 null. */
export function metadataText(doc: MdxDoc): string | null {
  if (!doc.ok) return null;
  return doc.head[metadataIndex(doc)]?.text ?? null;
}

/**
 * doc의 metadata를 읽는다. 구간으로 나눌 수 없는 글이거나 metadata export가 없으면 null,
 * export는 있지만 폼으로 읽을 수 없으면 `editable: false`.
 */
export function readMetadata(doc: MdxDoc): MetadataResult | null {
  const text = metadataText(doc);
  return text === null ? null : parseMetadata(text);
}

/** 점으로 이은 키(`other.createdAt`)의 값. */
export function lookupMetadata(metadata: { [key: string]: MetadataValue }, key: string): MetadataLookup {
  const parts = key.split(".");
  let node = metadata;
  for (const [i, part] of parts.entries()) {
    if (!Object.hasOwn(node, part)) return { kind: "missing" };
    const value = node[part]!;
    if (i === parts.length - 1) return { kind: "found", value };
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { kind: "blocked", reason: `${parts.slice(0, i + 1).join(".")}가 객체가 아니다` };
    }
    node = value;
  }
  return { kind: "missing" };
}

/** `export const metadata = {...}` 문장 하나(HeadSegment의 metadata text)를 JS 값으로 읽는다. */
export function parseMetadata(text: string): MetadataResult {
  let program: Program;
  try {
    program = parse(text, { ecmaVersion: "latest", sourceType: "module" }) as unknown as Program;
  } catch (error) {
    return { editable: false, reason: `구문 오류: ${(error as Error).message}` };
  }

  const statement = program.body[0];
  const declaration = statement?.type === "ExportNamedDeclaration" ? statement.declaration : null;
  const init = declaration?.type === "VariableDeclaration" ? declaration.declarations[0]?.init : null;
  if (!init) return { editable: false, reason: "export const metadata = ... 형태가 아니다" };

  try {
    const value = evaluate(init);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { editable: false, reason: "metadata 값이 객체가 아니다" };
    }
    return { editable: true, value };
  } catch (error) {
    if (error instanceof Unsupported) return { editable: false, reason: error.message };
    throw error;
  }
}

function evaluate(node: Expression): MetadataValue {
  switch (node.type) {
    case "ObjectExpression": {
      const result: { [key: string]: MetadataValue } = {};
      for (const property of node.properties) {
        if (property.type !== "Property") throw new Unsupported("전개(...) 구문");
        if (property.kind !== "init" || property.method) throw new Unsupported("getter/setter/메서드");
        if (property.computed) throw new Unsupported("계산된 키");
        let key: string;
        if (property.key.type === "Identifier") key = property.key.name;
        else if (property.key.type === "Literal" && typeof property.key.value !== "object")
          key = String(property.key.value);
        else throw new Unsupported(`지원하지 않는 키: ${property.key.type}`);
        // __proto__ 키가 객체 프로토타입을 바꾸지 않게 own property로 정의한다.
        Object.defineProperty(result, key, {
          value: evaluate(property.value as Expression),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    }
    case "ArrayExpression":
      return node.elements.map((element) => {
        if (!element) throw new Unsupported("배열의 빈 칸");
        if (element.type === "SpreadElement") throw new Unsupported("전개(...) 구문");
        return evaluate(element);
      });
    case "Literal":
      if (node.value instanceof RegExp || typeof node.value === "bigint") {
        throw new Unsupported("정규식·BigInt 리터럴");
      }
      return node.value ?? null;
    case "TemplateLiteral":
      if (node.expressions.length > 0) throw new Unsupported("식이 있는 템플릿 리터럴");
      return node.quasis[0]!.value.cooked ?? "";
    case "UnaryExpression":
      if (
        (node.operator === "-" || node.operator === "+") &&
        node.argument.type === "Literal" &&
        typeof node.argument.value === "number"
      ) {
        return node.operator === "-" ? -node.argument.value : node.argument.value;
      }
      throw new Unsupported(`지원하지 않는 식: 단항 ${node.operator}`);
    default:
      throw new Unsupported(`지원하지 않는 식: ${node.type}`);
  }
}
