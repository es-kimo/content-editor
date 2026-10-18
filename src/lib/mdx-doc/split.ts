import type { ModuleDeclaration, Program, Statement } from "estree";
import type { Options } from "mdast-util-from-markdown";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import { mdxjs } from "micromark-extension-mdxjs";

/** 사이트가 쓰는 remark 문법. blog는 remark-gfm·remark-math를 쓴다. */
export type Syntax = { gfm?: boolean; math?: boolean };

/**
 * 파일 맨 앞 ESM 구간의 조각. text는 원본 문자열 그대로다.
 * - import: import 문 하나
 * - metadata: `export const metadata = ...` 하나
 * - export: 그 밖의 export 문
 * - gap: 문장 사이의 공백·줄바꿈 (주석이 있으면 주석 포함)
 */
export type HeadSegment = { kind: "import" | "metadata" | "export" | "gap"; text: string };

export type MdxDoc =
  | { ok: true; head: HeadSegment[]; body: string }
  /** 구간으로 나눌 수 없는 파일. 원문 모드에서만 편집한다. */
  | { ok: false; reason: "parse-error" | "esm-after-content"; message: string; source: string };

type MicromarkExtension = NonNullable<Options["extensions"]>[number];
type MdastExtension = NonNullable<Options["mdastExtensions"]>[number];
type EsmStatement = (Statement | ModuleDeclaration) & { start: number; end: number };

export function parseMdx(source: string, syntax: Syntax = {}): MdxDoc {
  const extensions: MicromarkExtension[] = [mdxjs()];
  const mdastExtensions: MdastExtension[] = [mdxFromMarkdown()];
  if (syntax.gfm) {
    extensions.push(gfm());
    mdastExtensions.push(gfmFromMarkdown());
  }
  if (syntax.math) {
    extensions.push(math());
    mdastExtensions.push(mathFromMarkdown());
  }

  let children;
  try {
    children = fromMarkdown(source, { extensions, mdastExtensions }).children;
  } catch (error) {
    return { ok: false, reason: "parse-error", message: (error as Error).message, source };
  }

  const firstContent = children.findIndex((node) => node.type !== "mdxjsEsm");
  const leading = firstContent === -1 ? children : children.slice(0, firstContent);
  if (firstContent !== -1 && children.slice(firstContent).some((node) => node.type === "mdxjsEsm")) {
    return { ok: false, reason: "esm-after-content", message: "본문 뒤에 import/export가 있다", source };
  }

  // estree 위치는 파일 전체 기준 offset이다.
  const statements = leading.flatMap(
    (node) => ((node.data as { estree?: Program } | undefined)?.estree?.body ?? []) as EsmStatement[],
  );
  const bodyStart = firstContent === -1 ? source.length : children[firstContent]!.position!.start.offset!;

  const head: HeadSegment[] = [];
  let cursor = 0;
  const pushGap = (end: number) => {
    if (end > cursor) head.push({ kind: "gap", text: source.slice(cursor, end) });
  };
  for (const statement of statements) {
    pushGap(statement.start);
    head.push({ kind: classify(statement), text: source.slice(statement.start, statement.end) });
    cursor = statement.end;
  }
  pushGap(bodyStart);

  return { ok: true, head, body: source.slice(bodyStart) };
}

export function printMdx(doc: MdxDoc): string {
  if (!doc.ok) return doc.source;
  return doc.head.map((segment) => segment.text).join("") + doc.body;
}

function classify(statement: EsmStatement): HeadSegment["kind"] {
  if (statement.type === "ImportDeclaration") return "import";
  const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : null;
  if (
    declaration?.type === "VariableDeclaration" &&
    declaration.declarations.length === 1 &&
    declaration.declarations[0]!.id.type === "Identifier" &&
    declaration.declarations[0]!.id.name === "metadata"
  ) {
    return "metadata";
  }
  return "export";
}
