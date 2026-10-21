// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import {
  addFootnote,
  addFootnoteRef,
  addImageAt,
  addToc,
  footnoteRefChoices,
  hasToc,
  hasTocHeading,
  imageTag,
  moveImage,
  parseMdx,
  printJsxTag,
  printMdx,
  readInserts,
  readJsxTags,
  removeImage,
  removeToc,
  removeUnusedImageImport,
  replaceImage,
  setBody,
  setInsertText,
  type FootnoteRefChoice,
  type InsertEdit,
  type InsertItem,
  type InsertKind,
  type InsertLimit,
  type InsertList,
  type InsertSpan,
  type JsxElement,
  type LimitedInsert,
  type MdxDoc,
  type MoveDirection,
  type MoveLimit,
  type Syntax,
} from "@/lib/mdx-doc";

import type { FormArea } from "./save-flow";
import { IMAGE_COMPONENT } from "./upload";
import type { AddedUpload } from "./upload-session";

/** 값 하나를 고치는 폼으로 다루는 기존 항목. 목차는 고칠 값이 없다. */
export type TextInsertItem = Exclude<InsertItem, { kind: "toc" }>;

export type TocInsertItem = Extract<InsertItem, { kind: "toc" }>;

export type ImageInsertItem = Extract<InsertItem, { kind: "image" }>;

export type FootnoteInsertItem = Extract<InsertItem, { kind: "footnote" | "footnote-ref" }>;

/** 삽입 항목 목록에서 지울 수 있는 항목. 자동 목차와, 선택한 본문 참조 한 곳만 지우는 이미지다. */
export type RemovableInsertItem = TocInsertItem | ImageInsertItem;

/**
 * 파일을 바꿀 이미지. `opened`는 그 이미지를 읽은 원문이다(일반 편집은 import·metadata를 붙인 원문).
 * 새 파일을 첨부에 더하는 동안 일반 편집의 import가 늘어 위치가 밀리므로, 적용할 때 원문 끝에서 센 위치로 다시 찾는다.
 */
export type ImageReplace = { item: ImageInsertItem; opened: string };

/**
 * 원문 편집에서 새 항목을 넣을 곳. `at`은 폼을 연 때의 선택 영역, `opened`는 그때의 원문이다.
 * 일반 편집은 편집기가 커서 자리에 넣으므로 넣을 곳이 없다(null).
 */
export type InsertPlace = { at: InsertSpan; opened: string };

/** 출처 폼에서 고를 수 있는 각주. */
export type FootnoteChoice = FootnoteRefChoice;

/**
 * 폼이 고칠 대상. 폼을 연 영역의 원문(일반 편집은 본문 앞에 import·metadata를 붙인 원문, 원문 편집은 파일 전체)에서 읽은 위치다.
 * - edit: 기존 항목의 값(이미지 대체 텍스트, 각주·출처 내용)을 고친다
 * - footnote·footnote-ref·toc: 새 각주·각주 출처·자동 목차를 넣는다. `newInsertTarget`으로 만든다
 * - image: 첨부에 더한 새 이미지를 대체 텍스트와 함께 넣는다. 원문 편집은 `place`의 위치에 import와 함께 넣고,
 *   일반 편집은 `place` 없이 편집기가 커서 자리에 태그를 넣는다(import는 저장할 때 서버가 더한다)
 * - replace: 기존 이미지 한 곳의 파일을 첨부에 더한 새 이미지로 바꾸고 대체 텍스트를 고친다
 */
export type InsertFormTarget =
  | { kind: "edit"; item: TextInsertItem }
  | ({ kind: "replace"; image: AddedUpload } & ImageReplace)
  | { kind: "footnote"; place: InsertPlace | null }
  | { kind: "footnote-ref"; place: InsertPlace | null; choices: FootnoteChoice[] }
  | { kind: "toc"; place: InsertPlace | null; exists: boolean; heading: boolean }
  | { kind: "image"; image: AddedUpload; place: InsertPlace | null };

/** 넣기 메뉴에서 폼으로 새로 넣는 항목. 이미지는 파일을 고른 뒤 폼을 연다. */
export type NewInsertKind = Extract<InsertFormTarget["kind"], "footnote" | "footnote-ref" | "toc">;

/** 폼 입력. `ids`는 새 출처에 연결할 각주 번호이고, 다른 폼에서는 비어 있다. */
export type InsertFormInput = { text: string; ids: number[] };

export type InsertFormProblem = Extract<InsertEdit, { ok: false }>["reason"];

/** 폼을 적용한 결과. 실패하면 원문을 바꾸지 않는다. `changed`가 false면 원문이 그대로라 편집기에 쓰지 않는다. */
export type InsertFormApply =
  { ok: true; source: string; cursor: number; changed: boolean } | { ok: false; reason: InsertFormProblem };

/**
 * 넣기 메뉴로 고른 항목의 폼 대상. 출처 폼에서 고를 각주와 목차 안내를 `source`(폼을 연 영역의 원문)에서 정한다.
 * 출처는 `footnoteRefChoices`가 연결할 수 있다고 한 각주만 고르고, 목차가 있는지는 `addToc`과 같은 `hasToc`으로 정한다.
 */
export function newInsertTarget<K extends NewInsertKind>(
  kind: K,
  source: string,
  place: InsertPlace | null,
  syntax: Syntax = {},
): Extract<InsertFormTarget, { kind: K }> {
  return newTarget(kind, source, place, syntax) as Extract<InsertFormTarget, { kind: K }>;
}

function newTarget(kind: NewInsertKind, source: string, place: InsertPlace | null, syntax: Syntax): InsertFormTarget {
  if (kind === "footnote") return { kind, place };
  if (kind === "footnote-ref") return { kind, place, choices: footnoteRefChoices(source, syntax) };
  return { kind, place, exists: hasToc(source, syntax), heading: hasTocHeading(source, syntax) };
}

/** 폼을 열 때 입력의 처음 값. */
export function formInitialValue(target: InsertFormTarget): InsertFormInput {
  if (target.kind === "replace") return { text: target.item.alt, ids: [] };
  if (target.kind !== "edit") return { text: "", ids: [] };
  return { text: target.item.kind === "image" ? target.item.alt : target.item.text, ids: [] };
}

/**
 * 폼 안의 작성 중 입력이 처음 값과 다른지. 다르면 적용하지 않고 떠날 때 잃는 입력이다.
 * 새 이미지·교체 폼은 준비한 첨부를 들고 있어 입력이 없어도 떠나면 그 첨부를 잃는다.
 */
export function formDirty(target: InsertFormTarget, input: InsertFormInput): boolean {
  return (
    target.kind === "image" ||
    target.kind === "replace" ||
    input.text !== formInitialValue(target).text ||
    input.ids.length > 0
  );
}

/**
 * 폼 입력을 지금 원문에 적용한다. 기존 항목의 값이 같으면 원문을 그대로 돌려준다.
 * 폼을 연 뒤 대상 항목이 바뀌거나 사라졌으면, 새로 넣을 위치의 원문이 바뀌었으면 다른 곳을 덮어쓰지 않고 `target-changed`다.
 * 출처는 연결할 각주가 없으면 `missing-footnote`, 각주·출처 내용이 비었으면 `empty`다.
 */
export function applyInsertForm(
  source: string,
  target: InsertFormTarget,
  input: InsertFormInput,
  syntax: Syntax = {},
): InsertFormApply {
  const edit = formEdit(source, target, input, syntax);
  if (!edit.ok) return edit;
  return { ...edit, changed: edit.source !== source };
}

function formEdit(source: string, target: InsertFormTarget, input: InsertFormInput, syntax: Syntax): InsertEdit {
  const { text, ids } = input;
  if (target.kind === "edit") {
    if (target.item.kind !== "image" && text.trim() === "") return { ok: false, reason: "empty" };
    return setInsertText(source, target.item, text, syntax);
  }
  if (target.kind === "replace") return replaceEdit(source, target, text, syntax);
  if (target.kind === "footnote-ref") {
    if (ids.length === 0) return { ok: false, reason: "missing-footnote" };
    if (text.trim() === "") return { ok: false, reason: "empty" };
  }
  if (!target.place) return { ok: false, reason: "invalid-position" };
  if (source !== target.place.opened) return { ok: false, reason: "target-changed" };
  const { at } = target.place;
  switch (target.kind) {
    case "image":
      return addImageAt(source, at, { file: target.image.file, component: IMAGE_COMPONENT, alt: text }, syntax);
    case "footnote":
      return addFootnote(source, at, text, syntax);
    case "footnote-ref":
      return addFootnoteRef(source, at, ids, text, syntax);
    case "toc":
      return addToc(source, at, syntax);
  }
}

/**
 * 이미지 한 곳의 파일을 바꾸고, 대체 텍스트가 처음 값과 다르면 함께 고친다.
 * 이미지는 원문 끝에서 센 위치로 다시 찾으므로, 폼을 연 뒤 이미지보다 앞의 import가 늘어도 같은 이미지를 고친다.
 */
function replaceEdit(
  source: string,
  target: Extract<InsertFormTarget, { kind: "replace" }>,
  alt: string,
  syntax: Syntax,
): InsertEdit {
  const { item, opened } = target;
  const from = source.length - (opened.length - item.from);
  const replaced = replaceImage(
    source,
    { ...item, from, to: from + item.to - item.from },
    { file: target.image.file },
    syntax,
  );
  if (!replaced.ok || alt === item.alt) return replaced;
  const list = readInserts(replaced.source, syntax);
  const found = list.ok
    ? list.items.find((other): other is ImageInsertItem => other.kind === "image" && other.to === replaced.cursor)
    : null;
  if (!found) return { ok: false, reason: "invalid-position" };
  return setInsertText(replaced.source, found, alt, syntax);
}

/**
 * 자동 목차나 이미지 한 곳을 지운다. 원문을 읽은 뒤 항목이 바뀌었으면 지우지 않는다.
 * 이미지는 태그만 지우고, 그 import는 다른 곳에서 쓰면 남긴다. 레포의 이미지 파일은 다루지 않는다.
 */
export function removeInsert(source: string, item: RemovableInsertItem, syntax: Syntax = {}): InsertFormApply {
  const edit = item.kind === "toc" ? removeToc(source, item, syntax) : removeImage(source, item, syntax);
  if (!edit.ok) return edit;
  return { ...edit, changed: edit.source !== source };
}

/** 이미지를 옮기지 못한 이유. 옮길 자리가 없거나(`MoveLimit`) 원문에서 이미지를 다시 찾지 못했다. */
export type ImageMoveProblem = InsertFormProblem | MoveLimit;

/** 옮긴 결과. `index`는 옮긴 이미지가 삽입 항목 목록(`insertEntries`)에서 몇 번째인지다. */
export type ImageMoveApply =
  (Extract<InsertFormApply, { ok: true }> & { index: number }) | { ok: false; reason: ImageMoveProblem };

/**
 * 이미지만 있는 블록을 인접한 본문 블록 앞이나 뒤로 한 칸 옮긴다. `cursor`는 옮긴 이미지 끝이다.
 * 옮길 수 없으면 원문을 그대로 두고 이유를 돌려준다.
 */
export function moveInsert(
  source: string,
  item: ImageInsertItem,
  direction: MoveDirection,
  syntax: Syntax = {},
): ImageMoveApply {
  const edit = moveImage(source, item, direction, syntax);
  if (!edit.ok) return edit;
  const list = readInserts(edit.source, syntax);
  const index = list.ok ? insertEntries(list).findIndex((entry) => entry.to === edit.cursor) : -1;
  return { ...edit, changed: edit.source !== source, index };
}

/** 이미지를 앞(`before`)·뒤(`after`)로 옮길 수 없는 이유. 옮길 수 있으면 null이다. */
export type ImageMoves = { [direction in MoveDirection]: ImageMoveProblem | null };

/** 고른 이미지를 앞뒤로 옮길 수 있는지. 맨 앞 블록은 앞으로, 맨 뒤 블록은 뒤로 옮길 수 없다. */
export function imageMoves(source: string, item: ImageInsertItem, syntax: Syntax = {}): ImageMoves {
  const check = (direction: MoveDirection) => {
    const moved = moveImage(source, item, direction, syntax);
    return moved.ok ? null : moved.reason;
  };
  return { before: check("before"), after: check("after") };
}

/** 일반 편집에서 새 이미지 폼을 적용할 때 커서 자리에 넣을 태그. */
export function imageFormTag(target: Extract<InsertFormTarget, { kind: "image" }>, value: string): string {
  return imageTag(IMAGE_COMPONENT, target.image.name, value);
}

/**
 * 일반 편집기가 커서 자리에 넣을 새 항목. 각주는 문장 안에 넣어야 하므로 컴포넌트로, 출처·목차는 문단 사이에 넣을 원문으로 준다.
 * `text`는 이스케이프하기 전의 글자다.
 */
export type BodyInsert =
  { kind: "inline"; name: "Footnote"; id: number; text: string } | { kind: "block"; markdown: string };

/**
 * 일반 편집에서 새 각주·출처·목차 폼을 적용할 때 넣을 것. 원문 편집과 같은 규칙(번호, 연결, 중복 목차, 입력 검사)으로
 * import·metadata를 붙인 원문 끝에 넣어 보고, 그대로 다시 읽힌 항목만 돌려준다.
 */
export function bodyInsert(
  doc: MdxDoc,
  body: string,
  target: Extract<InsertFormTarget, { kind: NewInsertKind }>,
  input: InsertFormInput,
  syntax: Syntax = {},
): { ok: true; insert: BodyInsert } | { ok: false; reason: InsertFormProblem } {
  if (!doc.ok) return { ok: false, reason: "parse-error" };
  const source = bodySource(doc, body);
  const end = { from: source.length, to: source.length };
  const result = applyInsertForm(source, { ...target, place: { at: end, opened: source } }, input, syntax);
  if (!result.ok) return result;
  const list = readInserts(result.source, syntax);
  const item = list.ok ? list.items.find((found) => found.to === result.cursor) : undefined;
  if (!item) return { ok: false, reason: "invalid-position" };
  if (item.kind === "footnote")
    return { ok: true, insert: { kind: "inline", name: "Footnote", id: item.id, text: item.text } };
  return { ok: true, insert: { kind: "block", markdown: result.source.slice(item.from, item.to) } };
}

/** 일반 편집에서 넣기 메뉴로 고른 항목의 폼 대상. 편집기가 커서 자리에 넣으므로 넣을 곳은 없다. */
export function newBodyInsertTarget<K extends NewInsertKind>(
  kind: K,
  doc: MdxDoc,
  body: string,
  syntax: Syntax = {},
): Extract<InsertFormTarget, { kind: K }> {
  return newInsertTarget(kind, doc.ok ? bodySource(doc, body) : body, null, syntax);
}

/** 일반 편집의 import·metadata를 붙인 원문. 삽입 항목의 위치는 이 원문에서 센다. */
function bodySource(doc: Extract<MdxDoc, { ok: true }>, body: string): string {
  return printMdx(setBody(doc, body));
}

/**
 * 일반 편집의 삽입 항목. 본문 이미지의 `src`가 가리키는 import는 본문 밖에 있으므로 import·metadata를 붙인 원문에서 읽는다.
 * @param doc 넣은 이미지의 import까지 더한 doc(`UploadPlan.doc`). 넣은 이미지도 대체 텍스트를 고칠 수 있다.
 */
export function bodyInserts(doc: MdxDoc, body: string, syntax: Syntax = {}): InsertList {
  if (!doc.ok) return { ok: false, reason: "parse-error" };
  return readInserts(bodySource(doc, body), syntax);
}

type BodyEdit<R = InsertFormProblem> = { ok: true; body: string; changed: boolean } | { ok: false; reason: R };

/**
 * 일반 편집에서 기존 항목을 고치거나 이미지 파일을 바꾸는 폼을 적용한다. `bodyInserts`와 같은 원문에서 고치고 본문만 돌려준다.
 * 저장할 때 import·metadata는 서버가 다시 읽은 글의 것을 쓰므로 본문 밖의 변경은 버린다.
 * @param doc 교체 폼이면 새 파일의 import까지 더한 doc(`UploadPlan.doc`).
 */
export function applyBodyInsertForm(
  doc: MdxDoc,
  body: string,
  target: Extract<InsertFormTarget, { kind: "edit" | "replace" }>,
  input: InsertFormInput,
  syntax: Syntax = {},
): BodyEdit {
  // 교체는 새 파일의 import를 원문에 더하며 바꾸므로, 첨부할 때 미리 더해 둔 같은 import는 빼고 시작한다.
  const base = target.kind === "replace" ? removeUnusedImageImport(doc, target.image.name) : doc;
  return editBody(base, body, (source) => applyInsertForm(source, target, input, syntax), syntax);
}

/** 일반 편집에서 자동 목차나 이미지 한 곳을 지운다. `bodyInserts`로 읽은 항목이어야 한다. */
export function removeBodyInsert(doc: MdxDoc, body: string, item: RemovableInsertItem, syntax: Syntax = {}): BodyEdit {
  return editBody(doc, body, (source) => removeInsert(source, item, syntax), syntax);
}

/**
 * 일반 편집에서 이미지를 앞뒤 본문 블록으로 옮긴다. `bodyInserts`로 읽은 이미지여야 한다.
 * `index`는 옮긴 이미지가 `bodyInserts` 목록에서 몇 번째인지다.
 */
export function moveBodyInsert(
  doc: MdxDoc,
  body: string,
  item: ImageInsertItem,
  direction: MoveDirection,
  syntax: Syntax = {},
): (Extract<BodyEdit, { ok: true }> & { index: number }) | { ok: false; reason: ImageMoveProblem } {
  let index = -1;
  const result = editBody(
    doc,
    body,
    (source) => {
      const moved = moveInsert(source, item, direction, syntax);
      if (moved.ok) index = moved.index;
      return moved;
    },
    syntax,
  );
  return result.ok ? { ...result, index } : result;
}

/** 일반 편집에서 고른 이미지를 앞뒤로 옮길 수 있는지. */
export function bodyImageMoves(doc: MdxDoc, body: string, item: ImageInsertItem, syntax: Syntax = {}): ImageMoves {
  if (!doc.ok) return { before: "parse-error", after: "parse-error" };
  return imageMoves(bodySource(doc, body), item, syntax);
}

/**
 * 일반 편집기가 그린 본문 요소 하나가 삽입 항목 목록(`insertEntries(bodyInserts(...))`)의 어느 항목인지.
 * 편집기는 요소의 원문 위치를 주지 않으므로 본문에서 태그(`printJsxTag`)가 같은 요소 중 몇 번째인지(`nth`,
 * 문서 순서로 바깥 요소가 안쪽보다 먼저)로 찾는다. 편집기는 `<p>`·`<br />` 같은 HTML 요소를 JSX 요소로 그리지 않아
 * 모든 요소의 순서로는 원문과 어긋나지만, 같은 태그끼리의 순서는 어긋나지 않는다.
 * 같은 이미지를 여러 곳에서 써도 자리가 다르므로 각각 다른 항목이다. 그 태그가 `nth`번째까지 없거나 삽입 항목이 아니면 null이다.
 */
export function bodyEntryAt(
  doc: MdxDoc,
  body: string,
  element: JsxElement,
  nth: number,
  syntax: Syntax = {},
): InsertItem | LimitedInsert | null {
  if (!doc.ok) return null;
  const source = bodySource(doc, body);
  const tag = printJsxTag(element);
  const found = readJsxTags(source, syntax)?.filter((jsx) => jsx.tag === tag)[nth];
  if (!found) return null;
  const list = readInserts(source, syntax);
  if (!list.ok) return null;
  return insertEntries(list).find((entry) => entry.from === found.from && entry.to === found.to) ?? null;
}

/** 본문 요소의 태그와, 본문에서 그 태그가 같은 요소 중 몇 번째인지. `bodyEntryAt`이 이 값으로 찾는다. */
export type BodyElementAt = { tag: string; nth: number };

/** 삽입 항목 목록의 `entryIndex`번째 항목이 본문의 어느 요소인지. `bodyEntryAt`의 반대이고, 없으면 null이다. */
export function bodyEntryElementAt(
  doc: MdxDoc,
  body: string,
  entryIndex: number,
  syntax: Syntax = {},
): BodyElementAt | null {
  if (!doc.ok) return null;
  const source = bodySource(doc, body);
  const list = readInserts(source, syntax);
  const entry = list.ok ? insertEntries(list)[entryIndex] : undefined;
  const tags = readJsxTags(source, syntax);
  const found = entry && tags?.find(({ from, to }) => from === entry.from && to === entry.to);
  if (!found || !tags) return null;
  return { tag: found.tag, nth: tags.filter((jsx) => jsx.tag === found.tag).indexOf(found) };
}

/**
 * 일반 편집 본문에 보일 각주·출처. `numbers`는 각주의 번호, 출처는 연결한 각주 번호이고 원문 순서로 다시 매기지 않는다.
 * 폼으로 고칠 수 없으면 그 이유(`limit`)만 있다. 번호가 겹친 각주는 어느 자리인지 정할 수 없어 위치를 두지 않는다.
 */
export type BodyFootnote = { item: FootnoteInsertItem; numbers: string[] } | { limit: InsertLimit };

/**
 * 일반 편집기가 그린 요소가 어느 각주·출처인지 찾는 함수를 만든다. 각주·출처가 아닌 요소는 null이다.
 * 편집기는 요소의 원문 위치를 주지 않아 태그(`printJsxTag`)로 찾는다. 태그가 같은 각주·출처는 번호나 연결이 겹쳐
 * 모두 같은 이유로 폼으로 고칠 수 없으므로, 차례를 몰라도 태그만으로 어느 항목인지 또는 왜 고칠 수 없는지가 정해진다.
 * 본문의 각주마다 원문을 다시 읽지 않도록 본문 하나에 한 번만, 처음 찾을 때 읽는다.
 */
export function bodyFootnotes(
  doc: MdxDoc,
  body: string,
  syntax: Syntax = {},
): (element: JsxElement) => BodyFootnote | null {
  let byTag: Map<string, BodyFootnote> | undefined;
  return (element) => {
    byTag ??= footnotesByTag(doc, body, syntax);
    return byTag.get(printJsxTag(element)) ?? null;
  };
}

function footnotesByTag(doc: MdxDoc, body: string, syntax: Syntax): Map<string, BodyFootnote> {
  const byTag = new Map<string, BodyFootnote>();
  if (!doc.ok) return byTag;
  const source = bodySource(doc, body);
  const list = readInserts(source, syntax);
  const tags = readJsxTags(source, syntax);
  if (!list.ok || !tags) return byTag;
  const at = new Map(insertEntries(list).map((entry) => [`${entry.from}-${entry.to}`, entry]));
  for (const { from, to, tag } of tags) {
    const entry = at.get(`${from}-${to}`);
    if (byTag.has(tag) || (entry?.kind !== "footnote" && entry?.kind !== "footnote-ref")) continue;
    if ("reason" in entry) byTag.set(tag, { limit: entry.reason });
    else byTag.set(tag, { item: entry, numbers: (entry.kind === "footnote" ? [entry.id] : entry.ids).map(String) });
  }
  return byTag;
}

/** 일반 편집에서 파일을 바꿀 이미지. `bodyInserts`로 읽은 그 원문을 함께 둔다. */
export function bodyImageReplace(doc: MdxDoc, body: string, item: ImageInsertItem): ImageReplace {
  return { item, opened: doc.ok ? bodySource(doc, body) : body };
}

function editBody<R>(
  doc: MdxDoc,
  body: string,
  edit: (source: string) => { ok: true; source: string; changed: boolean } | { ok: false; reason: R },
  syntax: Syntax,
): BodyEdit<R | "parse-error"> {
  if (!doc.ok) return { ok: false, reason: "parse-error" };
  const source = bodySource(doc, body);
  const result = edit(source);
  if (!result.ok) return result;
  if (!result.changed) return { ok: true, body, changed: false };
  // 이미지를 지우거나 바꾸면 import도 늘거나 빠져 본문 앞 길이가 달라지므로 고친 원문을 다시 나눠 본문을 얻는다.
  const edited = parseMdx(result.source, syntax);
  if (!edited.ok) return { ok: false, reason: "parse-error" };
  return { ok: true, body: edited.body, changed: result.changed };
}

/** 적용하지 못한 이유와 다음 행동. 폼 안에 보인다. */
export function insertFormMessage(target: InsertFormTarget, reason: InsertFormProblem): string {
  switch (reason) {
    case "target-changed":
      return target.kind === "edit" || target.kind === "replace"
        ? "고치려던 항목이 바뀌었거나 없어졌어요. 폼을 취소하고 삽입 항목에서 다시 선택해 주세요."
        : "폼을 연 뒤 원문이 바뀌었어요. 폼을 취소하고 넣을 위치를 다시 선택해 주세요.";
    case "invalid-text":
      return "입력한 내용을 그대로 넣을 수 없어요. 줄바꿈이나 앞뒤 공백을 지우고 다시 적용해 주세요.";
    case "empty":
      return "내용을 입력해 주세요.";
    case "invalid-position":
    case "outside-body":
      return "이 위치에는 넣을 수 없어요. 폼을 취소하고 본문의 다른 곳을 선택해 주세요.";
    case "parse-error":
      return "원문을 읽을 수 없어 적용하지 못했어요. 원문의 오류를 고친 뒤 다시 열어 주세요.";
    case "name-taken":
      return target.kind === "replace"
        ? "새 이미지의 이름을 원문이 이미 쓰고 있어요. 폼을 취소하고 다시 교체해 주세요."
        : "넣을 이미지의 이름을 원문이 이미 쓰고 있어요. 폼을 취소하고 이미지를 다시 넣어 주세요.";
    case "toc-exists":
      return TOC_EXISTS;
    default:
      if (target.kind !== "footnote-ref") return "이 항목은 폼으로 고칠 수 없어요. 원문에서 직접 고쳐 주세요.";
      return reason === "missing-footnote"
        ? "연결할 각주를 하나 이상 선택해 주세요."
        : "선택한 각주에 이미 출처가 있어요. 다른 각주를 선택해 주세요.";
  }
}

/** 자동 목차를 지우지 못한 이유와 다음 행동. 삽입 항목 목록에 보인다. */
export function tocRemoveMessage(reason: InsertFormProblem, area: FormArea): string {
  if (reason === "target-changed") return "목차가 바뀌었거나 없어졌어요. 삽입 항목을 다시 확인해 주세요.";
  return area === "body"
    ? "목차를 지우지 못했어요. 원문 편집에서 직접 지워 주세요."
    : "목차를 지우지 못했어요. 원문에서 직접 지워 주세요.";
}

const MOVE_LIMITS: { [reason in Exclude<MoveLimit, "first-block" | "last-block">]: string } = {
  "in-paragraph": "문단 안에 글자와 함께 있는 이미지예요.",
  "in-component": "다른 요소 안에 있는 이미지예요.",
  "in-container": "목록이나 인용 안에 있는 이미지예요.",
};

/** 이미지를 지우거나 옮기지 못한 이유와 다음 행동. 삽입 항목 목록에 보인다. */
export function imageActionMessage(reason: ImageMoveProblem, area: FormArea): string {
  const source = area === "body" ? "원문 편집에서" : "원문에서";
  switch (reason) {
    case "first-block":
      return "맨 앞 블록이라 앞으로 옮길 수 없어요.";
    case "last-block":
      return "맨 뒤 블록이라 뒤로 옮길 수 없어요.";
    case "in-paragraph":
    case "in-component":
    case "in-container":
      return `옮길 수 없어요. ${MOVE_LIMITS[reason]} ${source} 직접 옮겨 주세요.`;
    case "invalid-position":
      return `옮기면 글 구조가 바뀌어 옮길 수 없어요. ${source} 직접 옮겨 주세요.`;
    case "target-changed":
      return "이미지가 바뀌었거나 없어졌어요. 삽입 항목을 다시 확인해 주세요.";
    default:
      return `이미지를 바꾸지 못했어요. ${source} 직접 고쳐 주세요.`;
  }
}

/**
 * 고른 이미지를 옮길 수 없는 이유를 버튼 옆에 미리 보일 안내. 맨 앞·맨 뒤는 버튼을 막는 것으로 충분해 안내하지 않는다.
 * 문단 안 이미지처럼 어느 쪽으로도 옮길 수 없는 이유는 원문으로 가는 방법과 함께 알린다.
 */
export function imageMoveNotice(moves: ImageMoves, area: FormArea): string | null {
  const reason = [moves.before, moves.after].find(
    (found) => found !== null && found !== "first-block" && found !== "last-block",
  );
  return reason ? imageActionMessage(reason, area) : null;
}

/** 폼 위에 보일 설명. 교체 폼은 바꿀 이미지와 새 파일, 바꾸지 않는 것을 알린다. */
export function insertFormDescription(target: InsertFormTarget): string | null {
  if (target.kind !== "replace") return null;
  const file = target.item.path.replace(/^\.\//, "");
  return `이 자리의 이미지(${file})만 새 이미지(${target.image.file})로 바꿔요. 같은 이미지를 쓰는 다른 곳과 레포에 있는 기존 파일은 그대로 둬요.`;
}

const TOC_EXISTS = "이미 목차가 있어요. 삽입 항목에서 기존 목차를 확인해 주세요.";
/** 목차를 채울 제목이 없을 때의 안내. 목차 폼과 삽입 항목 목록이 같은 문구를 쓴다. */
export const TOC_NEEDS_HEADING = "글에 제목을 추가하면 목차가 채워져요.";

/**
 * 폼을 열 때부터 보일 안내. `blocking`이면 적용할 수 없는 상태라 적용 버튼을 막는다.
 * 목차가 이미 있으면 새로 넣지 않고 기존 항목으로, 출처를 연결할 각주가 없으면 각주 넣기로 안내한다.
 */
export function insertFormNotice(target: InsertFormTarget): { text: string; blocking: boolean } | null {
  if (target.kind === "toc") {
    if (target.exists) return { text: TOC_EXISTS, blocking: true };
    return target.heading ? null : { text: TOC_NEEDS_HEADING, blocking: false };
  }
  if (target.kind === "footnote-ref" && target.choices.length === 0) {
    return { text: "출처를 연결할 각주가 없어요. 먼저 각주를 넣어 주세요.", blocking: true };
  }
  return null;
}

const LIMIT_REASONS: { [reason in InsertLimit]: string } = {
  expression: "값이 코드로 되어 있어요.",
  nested: "내용에 서식이나 다른 요소가 들어 있어요.",
  empty: "내용이 비어 있어요.",
  "not-image-import": "글 폴더의 이미지를 가져와 쓰는 형태가 아니에요.",
  "non-numeric-id": "각주 번호가 숫자가 아니에요.",
  "duplicate-id": "같은 번호의 각주가 여러 개예요.",
  "missing-footnote": "없는 각주 번호를 가리켜요.",
  "ambiguous-link": "어느 각주의 출처인지 하나로 정할 수 없어요.",
  "custom-toc": "직접 만든 목차예요.",
};

/** 폼으로 고칠 수 없는 항목 옆에 보일 구체적인 이유와, 그 영역에서 원문으로 가는 방법. */
export function insertLimitMessage(reason: InsertLimit, area: FormArea): string {
  const fix = area === "body" ? "원문 편집에서 직접 고쳐 주세요." : "원문에서 직접 고쳐 주세요.";
  return `폼으로 고칠 수 없어요. ${LIMIT_REASONS[reason]} ${fix}`;
}

const KIND_NAMES: { [kind in InsertKind]: string } = {
  image: "이미지",
  footnote: "각주",
  "footnote-ref": "각주 출처",
  toc: "목차",
};

/** 삽입 항목 목록과 폼 제목에 보일 항목 이름. 컴포넌트 이름이 아니라 용도로 부른다. */
export function insertItemName(item: InsertItem | LimitedInsert): string {
  if ("reason" in item) return KIND_NAMES[item.kind];
  switch (item.kind) {
    case "footnote":
      return `각주 ${item.id}`;
    case "footnote-ref":
      return `각주 ${item.ids.join(", ")} 출처`;
    default:
      return KIND_NAMES[item.kind];
  }
}

/** 폼의 이름과 입력 칸 이름. 목차 폼은 입력 칸이 없다(null). */
export function insertFormLabels(target: InsertFormTarget): { title: string; field: string | null } {
  switch (target.kind) {
    case "footnote":
      return { title: "각주 넣기", field: "각주 내용" };
    case "footnote-ref":
      return { title: "각주 출처 넣기", field: "출처 내용" };
    case "toc":
      return { title: "목차 넣기", field: null };
    case "image":
      return { title: "이미지 넣기", field: "대체 텍스트" };
    case "replace":
      return { title: "이미지 교체", field: "대체 텍스트" };
  }
  const { item } = target;
  const field = item.kind === "image" ? "대체 텍스트" : item.kind === "footnote" ? "각주 내용" : "출처 내용";
  return { title: `${insertItemName(item)} 수정`, field };
}

/** 넣기 메뉴로 새로 넣을 수 있는 항목과 그 항목을 쓰는 컴포넌트. */
const MENU_COMPONENTS: { [kind in "image" | NewInsertKind]: string } = {
  image: IMAGE_COMPONENT,
  footnote: "Footnote",
  "footnote-ref": "FootnoteRef",
  toc: "TOC",
};

/**
 * 넣기 메뉴 항목. 글 분류 설정의 `components`가 허용한 것만, 용도 이름으로 둔다.
 * 이미지는 파일을 고른 뒤 폼을 연다.
 */
export function insertMenuItems(components: string[]): { kind: keyof typeof MENU_COMPONENTS; label: string }[] {
  return (Object.keys(MENU_COMPONENTS) as (keyof typeof MENU_COMPONENTS)[])
    .filter((kind) => components.includes(MENU_COMPONENTS[kind]))
    .map((kind) => ({ kind, label: KIND_NAMES[kind] }));
}

/** ‘고급 삽입’으로 템플릿을 넣는 컴포넌트. 넣기 메뉴가 폼으로 넣는 컴포넌트는 뺀다. 설정 순서를 따른다. */
export function advancedComponents(components: string[]): string[] {
  const forms = new Set(Object.values(MENU_COMPONENTS));
  return components.filter((name) => !forms.has(name));
}

/** 삽입 항목 목록. 폼으로 고칠 수 없는 항목도 숨기지 않고 원문 순서로 함께 둔다. */
export function insertEntries(list: Extract<InsertList, { ok: true }>): (InsertItem | LimitedInsert)[] {
  return [...list.items, ...list.limited].sort((a, b) => a.from - b.from);
}

/** 고칠 값이 있는 항목. 삽입 항목 목록에서 수정 폼을 열 수 있다. */
export function isTextInsert(entry: InsertItem | LimitedInsert): entry is TextInsertItem {
  return !("reason" in entry) && entry.kind !== "toc";
}

/** 지울 수 있는 자동 목차. 사용자 정의 목차는 지우지 않는다. */
export function isTocInsert(entry: InsertItem | LimitedInsert): entry is TocInsertItem {
  return !("reason" in entry) && entry.kind === "toc";
}

/** 교체·제거·이동할 수 있는 이미지. 폼으로 고칠 수 없는 이미지는 원문에서 다룬다. */
export function isImageInsert(entry: InsertItem | LimitedInsert): entry is ImageInsertItem {
  return !("reason" in entry) && entry.kind === "image";
}
