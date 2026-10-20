import type { MdxJsxTextElement } from "mdast-util-mdx";

import { setBody } from "./body";
import {
  addImage,
  addImageAs,
  escapeJsxAttribute,
  isImageFile,
  readImageImports,
  type AddImageOptions,
} from "./images";
import { arrayAttribute, attributeValue, expressionAttribute, jsxElements, type JsxElement } from "./jsx";
import {
  componentSnippet,
  insertSnippet,
  leadingNewlines,
  nextFootnoteId,
  numericId,
  trailingNewlines,
  type ComponentSnippet,
} from "./snippet";
import { parseMarkdown, parseMdx, printMdx, type Syntax } from "./split";

/** 원문에서의 위치. `from`부터 `to` 앞까지다. */
export type InsertSpan = { from: number; to: number };

export type InsertKind = "image" | "footnote" | "footnote-ref" | "toc";

/** 폼으로 읽고 고칠 수 있는 삽입 항목. 위치는 요소 전체(여는 태그부터 닫는 태그까지)다. */
export type InsertItem =
  | (InsertSpan & { kind: "image"; component: string; name: string; path: string; alt: string })
  | (InsertSpan & { kind: "footnote"; id: number; text: string })
  | (InsertSpan & { kind: "footnote-ref"; ids: number[]; text: string })
  | (InsertSpan & { kind: "toc" });

/**
 * 폼으로 고칠 수 없는 이유.
 * - expression: 속성이나 내용이 `{식}`이다
 * - nested: 내용에 컴포넌트나 링크·강조 같은 서식이 있다
 * - empty: 내용이 없다
 * - not-image-import: `src`가 이미지 import를 가리키지 않는다
 * - non-numeric-id: 각주 번호가 숫자가 아니다
 * - duplicate-id: 같은 번호의 각주가 둘 이상이다
 * - missing-footnote: 없는 각주 번호를 가리킨다
 * - ambiguous-link: 번호가 겹친 각주를 가리키거나, 같은 각주를 출처 둘 이상이 가리킨다
 * - custom-toc: `<TOC items={toc} />`가 아닌 목차
 */
export type InsertLimit =
  | "expression"
  | "nested"
  | "empty"
  | "not-image-import"
  | "non-numeric-id"
  | "duplicate-id"
  | "missing-footnote"
  | "ambiguous-link"
  | "custom-toc";

export type LimitedInsert = InsertSpan & { kind: InsertKind; reason: InsertLimit };

export type InsertList =
  { ok: true; items: InsertItem[]; limited: LimitedInsert[] } | { ok: false; reason: "parse-error" };

/**
 * 고친 결과. 실패하면 원문을 바꾸지 않는다.
 * - target-changed: 읽었을 때의 항목이 그 위치에 없다
 * - outside-body: 넣을 위치가 본문 밖이다
 * - invalid-text: 입력이 그대로 다시 읽히지 않는다 (줄바꿈, 앞뒤 공백, 빈 값 등)
 * - invalid-position: 그 위치에 넣으면 항목으로 읽히지 않는다 (코드 블록 안 등)
 * - toc-exists: 이미 목차가 있다
 * - name-taken: 넣을 이미지의 파일 이름이나 변수명을 원문이 이미 쓴다
 */
export type InsertEdit =
  | { ok: true; source: string; cursor: number }
  | {
      ok: false;
      reason:
        | InsertLimit
        | "parse-error"
        | "target-changed"
        | "outside-body"
        | "invalid-text"
        | "invalid-position"
        | "toc-exists"
        | "name-taken";
    };

/** `file`은 글 폴더에 저장할 이미지 파일 이름이다. */
export type ImageInsertEdit =
  { ok: true; source: string; cursor: number; file: string } | Extract<InsertEdit, { ok: false }>;

/** 원문에서 고칠 구간과, 새 값을 그 구간에 쓸 원문으로 바꾸는 함수. */
type Field = InsertSpan & { write: (value: string) => string };

type Entry = { item: InsertItem; field: Field | null } | { limited: LimitedInsert };

type Scan = {
  entries: Entry[];
  /** 숫자 번호별 `Footnote` 수 */
  footnotes: Map<number, number>;
  /** 숫자 번호별 그 번호를 가리키는 `FootnoteRef` 수 */
  links: Map<number, number>;
  /** 원문 순서의 숫자 번호 각주와 그 보이는 글자 */
  numbered: FootnoteRefChoice[];
};

/** 새 각주 출처가 연결할 수 있는 각주. `text`는 각주에 보이는 글자다. */
export type FootnoteRefChoice = { id: number; text: string };

type Phrasing = MdxJsxTextElement["children"][number];

const TEXT_PUNCTUATION = /[\\*_{}[\]<>&~|!#]/g;
/** `split`으로 URL을 홀수 번째 조각으로 남기려고 캡처 그룹 하나로 감싼다. */
const URL = /((?:https?:\/\/|www\.)[^\s<>{}\\]+)/;

/**
 * 원문의 이미지·각주·각주 출처·목차를 읽는다. 폼으로 고칠 수 없는 항목도 위치와 이유를 돌려준다.
 * 이미지는 `src`가 `{식}`이거나 이미지 파일 경로인 컴포넌트다. `<Video src="https://...">`처럼 `src`가 이미지가 아닌
 * 주소인 컴포넌트는 돌려주지 않는다. 각주는 `Footnote`, 출처는 `FootnoteRef`, 목차는 `TOC`다.
 */
export function readInserts(source: string, syntax: Syntax = {}): InsertList {
  const scanned = scan(source, syntax);
  if (!scanned) return { ok: false, reason: "parse-error" };
  const items: InsertItem[] = [];
  const limited: LimitedInsert[] = [];
  for (const entry of scanned.entries) {
    if ("limited" in entry) limited.push(entry.limited);
    else items.push(entry.item);
  }
  return { ok: true, items, limited };
}

/**
 * `readInserts`로 읽은 항목의 값(이미지는 대체 텍스트, 각주·출처는 내용)만 바꾼다. 번호와 연결은 그대로다.
 * 값이 같으면 원문을 그대로 돌려준다. 그 사이 원문이 바뀌어 같은 위치에 같은 항목이 없으면 고치지 않는다.
 * 각주·출처 내용은 마크다운·JSX로 해석되지 않게 이스케이프해 글자 그대로 남긴다.
 */
export function setInsertText(
  source: string,
  target: Exclude<InsertItem, { kind: "toc" }>,
  value: string,
  syntax: Syntax = {},
): InsertEdit {
  const current = target.kind === "image" ? target.alt : target.text;
  if (current === value) return { ok: true, source, cursor: target.to };
  const found = locate(source, target, syntax);
  if (!found.ok) return found;
  if (!found.field) return { ok: false, reason: "invalid-text" };

  const { from, to, write } = found.field;
  const edited = source.slice(0, from) + write(value) + source.slice(to);
  const end = target.to + edited.length - source.length;
  const expected: InsertItem =
    target.kind === "image" ? { ...target, to: end, alt: value } : { ...target, to: end, text: value };
  return verify(edited, expected, syntax, "invalid-text");
}

/** 선택 영역을 새 각주로 바꾼다. 번호는 가장 큰 숫자 각주 번호 다음이고, 내용을 비우면 번호를 내용으로 쓴다. */
export function addFootnote(source: string, at: InsertSpan, text?: string, syntax: Syntax = {}): InsertEdit {
  const checked = checkPosition(source, at, syntax);
  if (!checked.ok) return checked;
  const id = nextFootnoteId(source, syntax);
  const content = text || String(id);
  const snippet: ComponentSnippet = {
    kind: "inline",
    text: `<Footnote id="${id}">${escapeText(content, "")}</Footnote>`,
  };
  return insertAndVerify(source, at, snippet, { kind: "footnote", id, text: content }, syntax);
}

/**
 * 선택 영역에 각주 출처를 block으로 넣는다. `ids`는 지금 원문에 하나씩만 있고 아직 출처가 없는 각주 번호여야 한다.
 * 없는 번호나 겹친 번호를 고쳐 주지 않고 실패로 돌려준다.
 */
export function addFootnoteRef(
  source: string,
  at: InsertSpan,
  ids: number[],
  text: string,
  syntax: Syntax = {},
): InsertEdit {
  const checked = checkPosition(source, at, syntax);
  if (!checked.ok) return checked;
  const { footnotes, links } = checked.scan;
  if (ids.length === 0 || ids.some((id) => !footnotes.has(id))) return { ok: false, reason: "missing-footnote" };
  if (new Set(ids).size !== ids.length || ids.some((id) => footnotes.get(id)! > 1 || links.has(id))) {
    return { ok: false, reason: "ambiguous-link" };
  }
  const list = ids.map((id) => `"${id}"`).join(", ");
  const snippet: ComponentSnippet = {
    kind: "block",
    text: `<FootnoteRef ids={[${list}]}>\n  ${escapeText(text, "  ")}\n</FootnoteRef>`,
  };
  return insertAndVerify(source, at, snippet, { kind: "footnote-ref", ids, text }, syntax);
}

/**
 * `addFootnoteRef`가 연결할 수 있는 각주. 번호가 하나뿐이고 어느 출처도 가리키지 않는 숫자 번호 각주를 원문 순서로 준다.
 * 내용에 서식이 있어 폼으로 고칠 수 없는 각주도 연결할 수 있고, 폼으로 고칠 수 없는 출처가 가리키는 각주는 연결할 수 없다.
 * 읽을 수 없는 원문은 빈 목록이다.
 */
export function footnoteRefChoices(source: string, syntax: Syntax = {}): FootnoteRefChoice[] {
  const scanned = scan(source, syntax);
  if (!scanned) return [];
  const { footnotes, links, numbered } = scanned;
  return numbered.filter(({ id }) => footnotes.get(id) === 1 && !links.has(id));
}

/** 선택 영역에 자동 목차를 넣는다. 자동이든 사용자 정의든 목차가 이미 있으면 넣지 않는다. */
export function addToc(source: string, at: InsertSpan, syntax: Syntax = {}): InsertEdit {
  const checked = checkPosition(source, at, syntax);
  if (!checked.ok) return checked;
  if (tocIn(checked.scan)) return { ok: false, reason: "toc-exists" };
  return insertAndVerify(source, at, componentSnippet("TOC", ""), { kind: "toc" }, syntax);
}

/** 자동이든 사용자 정의든 목차가 이미 있는지. `addToc`이 `toc-exists`로 막는 조건과 같다. 읽을 수 없는 원문은 false다. */
export function hasToc(source: string, syntax: Syntax = {}): boolean {
  const scanned = scan(source, syntax);
  return scanned !== null && tocIn(scanned);
}

function tocIn({ entries }: Scan): boolean {
  return entries.some((entry) => ("limited" in entry ? entry.limited : entry.item).kind === "toc");
}

/** 자동 목차를 지운다. 목차만 있던 줄은 앞뒤 빈 줄이 겹치지 않게 함께 정리한다. */
export function removeToc(
  source: string,
  target: Extract<InsertItem, { kind: "toc" }>,
  syntax: Syntax = {},
): InsertEdit {
  const found = locate(source, target, syntax);
  if (!found.ok) return found;
  const before = source.slice(0, target.from);
  const after = source.slice(target.to);
  const ownLines = (before === "" || before.endsWith("\n")) && (after === "" || after.startsWith("\n"));
  if (!ownLines) return { ok: true, source: before + after, cursor: target.from };
  const head = before.slice(0, before.length - trailingNewlines(before));
  const rest = after.slice(leadingNewlines(after));
  const gap =
    head === "" ? "" : rest === "" ? "\n" : "\n".repeat(Math.max(trailingNewlines(before), leadingNewlines(after)));
  return { ok: true, source: head + gap + rest, cursor: head.length + gap.length };
}

/**
 * 자동 목차를 채울 소제목(`##`부터)이 있는지. `#`은 글 제목으로 쓰여 목차에 들지 않는다고 본다.
 * 코드 블록 안의 `##` 줄은 제목이 아니다. 읽을 수 없는 원문은 false다.
 */
export function hasTocHeading(source: string, syntax: Syntax = {}): boolean {
  let root;
  try {
    root = parseMarkdown(source, syntax);
  } catch {
    return false;
  }
  const visit = (node: { type: string; depth?: number; children?: unknown[] }): boolean =>
    (node.type === "heading" && (node.depth ?? 1) >= 2) ||
    (node.children ?? []).some((child) => visit(child as typeof node));
  return visit(root);
}

/** `file`을 주면 그 파일 이름(`N.ext`)으로 넣는다. 없으면 `addImage`가 고른다. */
export type ImageAtOptions = AddImageOptions | (Omit<AddImageOptions, "extension"> & { file: string });

/**
 * 선택 영역에 새 이미지를 block으로 넣고 그 이미지의 import를 더한다. 원문의 다른 곳은 바꾸지 않는다.
 * 미리 고른 파일 이름의 번호를 원문이 이미 쓰고 있으면 넣지 않고 `name-taken`이다.
 */
export function addImageAt(
  source: string,
  at: InsertSpan,
  options: ImageAtOptions,
  syntax: Syntax = {},
): ImageInsertEdit {
  const checked = checkPosition(source, at, syntax);
  if (!checked.ok) return checked;
  const { doc } = checked;
  const bodyStart = source.length - doc.body.length;
  const added = "file" in options ? addImageAs(doc, options.file, options) : addImage(doc, options);
  if (!added) return { ok: false, reason: "name-taken" };
  const inserted = insertSnippet(doc.body, at.from - bodyStart, at.to - bodyStart, { kind: "block", text: added.tag });
  const edited = printMdx(setBody(added.doc, inserted.source));
  const cursor = edited.length - inserted.source.length + inserted.cursor;
  const expected: InsertItem = {
    kind: "image",
    from: cursor - added.tag.length,
    to: cursor,
    component: options.component,
    name: added.name,
    path: `./${added.file}`,
    alt: options.alt ?? "",
  };
  const result = verify(edited, expected, syntax, "invalid-position");
  return result.ok ? { ...result, file: added.file } : result;
}

function scan(source: string, syntax: Syntax): Scan | null {
  let root;
  try {
    root = parseMarkdown(source, syntax);
  } catch {
    return null;
  }
  const imports = new Map(readImageImports(parseMdx(source, syntax)).map((image) => [image.name, image.path]));
  const elements = jsxElements(root);

  const footnotes = new Map<number, number>();
  const links = new Map<number, number>();
  const numbered: FootnoteRefChoice[] = [];
  for (const element of elements) {
    if (element.name === "Footnote") {
      const id = footnoteId(element);
      if (typeof id === "number") {
        footnotes.set(id, (footnotes.get(id) ?? 0) + 1);
        numbered.push({ id, text: visibleText(element) });
      }
    } else if (element.name === "FootnoteRef") {
      const ids = refIds(element);
      if (Array.isArray(ids)) for (const id of ids) links.set(id, (links.get(id) ?? 0) + 1);
    }
  }

  const entries = elements.flatMap((element): Entry[] => {
    const span = { from: element.position!.start.offset!, to: element.position!.end.offset! };
    if (element.name === "Footnote") return [footnoteEntry(source, element, span, footnotes)];
    if (element.name === "FootnoteRef") return [refEntry(source, element, span, footnotes, links)];
    if (element.name === "TOC") return [tocEntry(element, span)];
    if (isImageSource(element)) return [imageEntry(element, span, imports)];
    return [];
  });
  return { entries, footnotes, links, numbered };
}

/** 서식이 있는 내용도 고를 때 알아볼 수 있게 글자만 이어 붙인다. 코드로 된 값은 뺀다. */
function visibleText(node: { type: string; value?: unknown; children?: unknown[] }): string {
  if (node.type === "text" || node.type === "inlineCode") return typeof node.value === "string" ? node.value : "";
  return (node.children ?? []).map((child) => visibleText(child as typeof node)).join("");
}

function footnoteEntry(source: string, element: JsxElement, span: InsertSpan, footnotes: Map<number, number>): Entry {
  const limit = (reason: InsertLimit): Entry => ({ limited: { ...span, kind: "footnote", reason } });
  const id = footnoteId(element);
  if (typeof id !== "number") return limit(id);
  if (footnotes.get(id)! > 1) return limit("duplicate-id");
  const content = plainText(source, element);
  if (!("text" in content)) return limit(content.reason);
  return { item: { ...span, kind: "footnote", id, text: content.text }, field: content.field };
}

function refEntry(
  source: string,
  element: JsxElement,
  span: InsertSpan,
  footnotes: Map<number, number>,
  links: Map<number, number>,
): Entry {
  const limit = (reason: InsertLimit): Entry => ({ limited: { ...span, kind: "footnote-ref", reason } });
  const ids = refIds(element);
  if (!Array.isArray(ids)) return limit(ids);
  if (ids.length === 0 || ids.some((id) => !footnotes.has(id))) return limit("missing-footnote");
  if (new Set(ids).size !== ids.length || ids.some((id) => footnotes.get(id)! > 1 || links.get(id)! > 1)) {
    return limit("ambiguous-link");
  }
  const content = plainText(source, element);
  if (!("text" in content)) return limit(content.reason);
  return { item: { ...span, kind: "footnote-ref", ids, text: content.text }, field: content.field };
}

function tocEntry(element: JsxElement, span: InsertSpan): Entry {
  const items = expressionAttribute(element, "items");
  const auto =
    element.attributes.length === 1 &&
    items?.type === "Identifier" &&
    items.name === "toc" &&
    element.children.length === 0;
  return auto
    ? { item: { ...span, kind: "toc" }, field: null }
    : { limited: { ...span, kind: "toc", reason: "custom-toc" } };
}

/** 이미지 컴포넌트 이름은 레포마다 달라서 이름 대신 `src`의 모양으로 가린다. */
function isImageSource(element: JsxElement): boolean {
  const value = attributeValue(element, "src");
  if (typeof value === "string") return isImageFile(value);
  return typeof value === "object" && value !== null;
}

function imageEntry(element: JsxElement, span: InsertSpan, imports: Map<string, string>): Entry {
  const limit = (reason: InsertLimit): Entry => ({ limited: { ...span, kind: "image", reason } });
  if (element.attributes.some((attribute) => attribute.type === "mdxJsxExpressionAttribute"))
    return limit("expression");
  const src = expressionAttribute(element, "src");
  if (src?.type !== "Identifier") {
    const value = attributeValue(element, "src");
    return limit(
      typeof value === "object" && value !== null && src?.type !== "Literal" ? "expression" : "not-image-import",
    );
  }
  const path = imports.get(src.name);
  if (path === undefined) return limit("not-image-import");
  const alt = attributeValue(element, "alt");
  if (alt !== undefined && typeof alt !== "string") return limit("expression");

  const write = (value: string) => `alt="${escapeJsxAttribute(value)}"`;
  const altAttribute = element.attributes.find((a) => a.type === "mdxJsxAttribute" && a.name === "alt");
  const srcAttribute = element.attributes.find((a) => a.type === "mdxJsxAttribute" && a.name === "src")!;
  // alt가 없으면 src 바로 뒤에 새 속성으로 넣는다.
  const field: Field = altAttribute
    ? { ...offsets(altAttribute), write }
    : { from: offsets(srcAttribute).to, to: offsets(srcAttribute).to, write: (value) => ` ${write(value)}` };
  const item: InsertItem = { ...span, kind: "image", component: element.name!, name: src.name, path, alt: alt ?? "" };
  return { item, field };
}

function footnoteId(element: JsxElement): number | InsertLimit {
  const value = attributeValue(element, "id");
  if (typeof value === "object" && value !== null) return "expression";
  return numericId(value ?? undefined) ?? "non-numeric-id";
}

function refIds(element: JsxElement): number[] | InsertLimit {
  const items = arrayAttribute(element, "ids");
  if (!items) {
    const value = attributeValue(element, "ids");
    return typeof value === "object" && value !== null ? "expression" : "non-numeric-id";
  }
  const ids: number[] = [];
  for (const item of items) {
    if (item?.type !== "Literal" || typeof item.value !== "string") return "expression";
    const id = numericId(item.value);
    if (id === null) return "non-numeric-id";
    ids.push(id);
  }
  return ids;
}

/**
 * 요소의 내용이 글자뿐이면 그 글자와 원문 구간. block 요소의 내용은 문단 하나여야 한다.
 * gfm이 글 속 URL을 링크로 읽은 것(원문이 링크 글자와 같은 것)은 글자로 본다.
 */
function plainText(source: string, element: JsxElement): { text: string; field: Field } | { reason: InsertLimit } {
  const only = element.children.length === 1 ? element.children[0]! : null;
  const children = (only?.type === "paragraph" ? only.children : element.children) as Phrasing[];
  if (children.length === 0) return { reason: "empty" };
  let text = "";
  for (const child of children) {
    if (child.type === "text") text += child.value;
    else if (child.type === "link" && isLiteralUrl(source, child)) text += sourceOf(source, child);
    else if (child.type === "mdxTextExpression" || (child.type as string) === "mdxFlowExpression") {
      return { reason: "expression" };
    } else return { reason: "nested" };
  }
  const from = offsets(children[0]!).from;
  const to = offsets(children.at(-1)!).to;
  // 여러 줄 내용은 첫 줄과 같은 들여쓰기로 이어 쓴다. 첫 줄이 태그 뒤에 이어지면 들여쓰지 않는다.
  const lead = source.slice(source.lastIndexOf("\n", from - 1) + 1, from);
  const indent = /^[ \t]*$/.test(lead) ? lead : "";
  return { text, field: { from, to, write: (value) => escapeText(value, indent) } };
}

function isLiteralUrl(source: string, link: Extract<Phrasing, { type: "link" }>): boolean {
  const child = link.children.length === 1 ? link.children[0] : null;
  return child?.type === "text" && child.value === sourceOf(source, link);
}

/**
 * 글자가 마크다운·MDX 문법으로 읽히지 않게 백슬래시로 이스케이프한다. 줄 맨 앞에서 목록·제목으로 읽힐 글자도 이스케이프한다.
 * URL은 그대로 둔다. gfm은 URL 안의 백슬래시까지 링크 주소로 읽으므로 이스케이프하면 글자가 달라진다.
 * `` ` ``와 `$`는 문자 참조로 쓴다. 앞 문장에 닫히지 않은 코드·수식이 있으면 그 안에서는 백슬래시가 이스케이프가 아니어서
 * `` \` ``·`\$`가 그 코드·수식을 닫아 버린다.
 */
function escapeText(value: string, indent: string): string {
  return value
    .split(URL)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(TEXT_PUNCTUATION, "\\$&").replaceAll("`", "&#96;").replaceAll("$", "&#36;"),
    )
    .join("")
    .replace(/^[-+=]/gm, "\\$&")
    .replace(/^(\d+)([.)])/gm, "$1\\$2")
    .replaceAll("\n", `\n${indent}`);
}

function locate(
  source: string,
  target: InsertItem,
  syntax: Syntax,
): { ok: true; field: Field | null } | Extract<InsertEdit, { ok: false }> {
  const scanned = scan(source, syntax);
  if (!scanned) return { ok: false, reason: "parse-error" };
  for (const entry of scanned.entries) {
    const found = "limited" in entry ? entry.limited : entry.item;
    if (found.from !== target.from || found.to !== target.to || found.kind !== target.kind) continue;
    if ("limited" in entry) return { ok: false, reason: entry.limited.reason };
    if (!sameItem(entry.item, target)) break;
    return { ok: true, field: entry.field };
  }
  return { ok: false, reason: "target-changed" };
}

/** 넣을 위치가 본문 안인지. 본문을 나눌 수 없는 글에는 넣지 않는다. */
function checkPosition(source: string, at: InsertSpan, syntax: Syntax) {
  const doc = parseMdx(source, syntax);
  const scanned = doc.ok ? scan(source, syntax) : null;
  if (!doc.ok || !scanned) return { ok: false, reason: "parse-error" } as const;
  if (at.from < source.length - doc.body.length || at.from > at.to || at.to > source.length) {
    return { ok: false, reason: "outside-body" } as const;
  }
  return { ok: true, doc, scan: scanned } as const;
}

function insertAndVerify(
  source: string,
  at: InsertSpan,
  snippet: ComponentSnippet,
  expected: DistributiveOmit<InsertItem, "from" | "to">,
  syntax: Syntax,
): InsertEdit {
  const inserted = insertSnippet(source, at.from, at.to, snippet);
  const span = { from: inserted.cursor - snippet.text.length, to: inserted.cursor };
  return verify(inserted.source, { ...expected, ...span } as InsertItem, syntax, "invalid-position");
}

/**
 * 고친 원문을 다시 읽어 기대한 항목이 그 자리에 그대로 있을 때만 성공으로 본다.
 * 읽을 수 없거나 그 자리에 항목이 없으면 `missing`, 항목은 있지만 값이 다르면 `invalid-text`다.
 */
function verify(
  edited: string,
  expected: InsertItem,
  syntax: Syntax,
  missing: "invalid-text" | "invalid-position",
): InsertEdit {
  const entry = scan(edited, syntax)?.entries.find((e) => {
    const found = "limited" in e ? e.limited : e.item;
    return found.from === expected.from && found.kind === expected.kind;
  });
  if (!entry) return { ok: false, reason: missing };
  if ("limited" in entry || !sameItem(entry.item, expected)) return { ok: false, reason: "invalid-text" };
  return { ok: true, source: edited, cursor: expected.to };
}

function sameItem(a: InsertItem, b: InsertItem): boolean {
  const keys = Object.keys(a) as (keyof InsertItem)[];
  return (
    keys.length === Object.keys(b).length && keys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
  );
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function offsets(node: { position?: { start: { offset?: number }; end: { offset?: number } } }): InsertSpan {
  return { from: node.position!.start.offset!, to: node.position!.end.offset! };
}

function sourceOf(source: string, node: Phrasing): string {
  const { from, to } = offsets(node);
  return source.slice(from, to);
}
