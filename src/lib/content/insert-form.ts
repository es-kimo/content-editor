// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import {
  addFootnote,
  addImageAt,
  imageTag,
  printMdx,
  readInserts,
  setBody,
  setInsertText,
  type InsertEdit,
  type InsertItem,
  type InsertKind,
  type InsertLimit,
  type InsertList,
  type InsertSpan,
  type LimitedInsert,
  type MdxDoc,
  type Syntax,
} from "@/lib/mdx-doc";

import type { FormArea } from "./save-flow";
import { IMAGE_COMPONENT } from "./upload";
import type { AddedUpload } from "./upload-session";

/** 값 하나를 고치는 폼으로 다루는 기존 항목. 목차는 고칠 값이 없다. */
export type TextInsertItem = Exclude<InsertItem, { kind: "toc" }>;

/**
 * 폼이 고칠 대상. 폼을 연 영역의 원문(일반 편집은 본문 앞에 import·metadata를 붙인 원문, 원문 편집은 파일 전체)에서 읽은 위치다.
 * - edit: 기존 항목의 값(이미지 대체 텍스트, 각주·출처 내용)을 고친다
 * - footnote: `at`에 새 각주를 넣는다. `opened`는 폼을 연 때의 원문이다
 * - image: 첨부에 더한 새 이미지를 대체 텍스트와 함께 넣는다. 원문 편집은 `place`의 위치에 import와 함께 넣고,
 *   일반 편집은 `place` 없이 편집기가 커서 자리에 태그를 넣는다(import는 저장할 때 서버가 더한다)
 */
export type InsertFormTarget =
  | { kind: "edit"; item: TextInsertItem }
  | { kind: "footnote"; at: InsertSpan; opened: string }
  | { kind: "image"; image: AddedUpload; place: { at: InsertSpan; opened: string } | null };

export type InsertFormProblem = Extract<InsertEdit, { ok: false }>["reason"];

/** 폼을 적용한 결과. 실패하면 원문을 바꾸지 않는다. `changed`가 false면 원문이 그대로라 편집기에 쓰지 않는다. */
export type InsertFormApply =
  { ok: true; source: string; cursor: number; changed: boolean } | { ok: false; reason: InsertFormProblem };

/** 폼을 열 때 입력 칸의 처음 값. */
export function formInitialValue(target: InsertFormTarget): string {
  if (target.kind !== "edit") return "";
  return target.item.kind === "image" ? target.item.alt : target.item.text;
}

/**
 * 폼 안의 작성 중 입력이 처음 값과 다른지. 다르면 적용하지 않고 떠날 때 잃는 입력이다.
 * 새 이미지 폼은 준비한 첨부를 들고 있어 입력이 없어도 떠나면 그 첨부를 잃는다.
 */
export function formDirty(target: InsertFormTarget, value: string): boolean {
  return target.kind === "image" || value !== formInitialValue(target);
}

/**
 * 폼 입력을 지금 원문에 적용한다. 기존 항목의 값이 같으면 원문을 그대로 돌려준다.
 * 폼을 연 뒤 대상 항목이 바뀌거나 사라졌으면, 새로 넣을 위치의 원문이 바뀌었으면 다른 곳을 덮어쓰지 않고 `target-changed`다.
 */
export function applyInsertForm(
  source: string,
  target: InsertFormTarget,
  value: string,
  syntax: Syntax = {},
): InsertFormApply {
  let edit: InsertEdit;
  if (target.kind === "edit") edit = setInsertText(source, target.item, value, syntax);
  else if (target.kind === "image") {
    if (!target.place) return { ok: false, reason: "invalid-position" };
    if (source !== target.place.opened) return { ok: false, reason: "target-changed" };
    edit = addImageAt(
      source,
      target.place.at,
      { file: target.image.file, component: IMAGE_COMPONENT, alt: value },
      syntax,
    );
  } else if (source !== target.opened) return { ok: false, reason: "target-changed" };
  else edit = addFootnote(source, target.at, value, syntax);
  if (!edit.ok) return edit;
  return { ...edit, changed: edit.source !== source };
}

/** 일반 편집에서 새 이미지 폼을 적용할 때 커서 자리에 넣을 태그. */
export function imageFormTag(target: Extract<InsertFormTarget, { kind: "image" }>, value: string): string {
  return imageTag(IMAGE_COMPONENT, target.image.name, value);
}

/**
 * 일반 편집의 삽입 항목. 본문 이미지의 `src`가 가리키는 import는 본문 밖에 있으므로 import·metadata를 붙인 원문에서 읽는다.
 * @param doc 넣은 이미지의 import까지 더한 doc(`UploadPlan.doc`). 넣은 이미지도 대체 텍스트를 고칠 수 있다.
 */
export function bodyInserts(doc: MdxDoc, body: string, syntax: Syntax = {}): InsertList {
  if (!doc.ok) return { ok: false, reason: "parse-error" };
  return readInserts(printMdx(setBody(doc, body)), syntax);
}

/**
 * 일반 편집에서 기존 항목을 고치는 폼을 적용한다. `bodyInserts`와 같은 원문에서 고치고 본문만 돌려준다.
 * 항목은 본문 안에 있어 import·metadata는 바뀌지 않는다.
 */
export function applyBodyInsertForm(
  doc: MdxDoc,
  body: string,
  target: Extract<InsertFormTarget, { kind: "edit" }>,
  value: string,
  syntax: Syntax = {},
): { ok: true; body: string; changed: boolean } | { ok: false; reason: InsertFormProblem } {
  if (!doc.ok) return { ok: false, reason: "parse-error" };
  const source = printMdx(setBody(doc, body));
  const result = applyInsertForm(source, target, value, syntax);
  if (!result.ok) return result;
  const edited = result.source.slice(source.length - body.length);
  return { ok: true, body: edited, changed: result.changed };
}

/** 적용하지 못한 이유와 다음 행동. 폼 안에 보인다. */
export function insertFormMessage(target: InsertFormTarget, reason: InsertFormProblem): string {
  switch (reason) {
    case "target-changed":
      return target.kind === "edit"
        ? "고치려던 항목이 바뀌었거나 없어졌어요. 폼을 취소하고 삽입 항목에서 다시 선택해 주세요."
        : "폼을 연 뒤 원문이 바뀌었어요. 폼을 취소하고 넣을 위치를 다시 선택해 주세요.";
    case "invalid-text":
      return "입력한 내용을 그대로 넣을 수 없어요. 줄바꿈이나 앞뒤 공백을 지우고 다시 적용해 주세요.";
    case "invalid-position":
    case "outside-body":
      return "이 위치에는 넣을 수 없어요. 폼을 취소하고 본문의 다른 곳을 선택해 주세요.";
    case "parse-error":
      return "원문을 읽을 수 없어 적용하지 못했어요. 원문의 오류를 고친 뒤 다시 열어 주세요.";
    case "name-taken":
      return "넣을 이미지의 이름을 원문이 이미 쓰고 있어요. 폼을 취소하고 이미지를 다시 넣어 주세요.";
    default:
      return "이 항목은 폼으로 고칠 수 없어요. 원문에서 직접 고쳐 주세요.";
  }
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

/** 폼의 이름과 입력 칸 이름. */
export function insertFormLabels(target: InsertFormTarget): { title: string; field: string } {
  if (target.kind === "footnote") return { title: "각주 넣기", field: "각주 내용" };
  if (target.kind === "image") return { title: "이미지 넣기", field: "대체 텍스트" };
  const { item } = target;
  const field = item.kind === "image" ? "대체 텍스트" : item.kind === "footnote" ? "각주 내용" : "출처 내용";
  return { title: `${insertItemName(item)} 수정`, field };
}

/** 넣기 메뉴로 새로 넣을 수 있는 항목과 그 항목을 쓰는 컴포넌트. */
const MENU_COMPONENTS: { [kind in Extract<InsertFormTarget["kind"], "image" | "footnote">]: string } = {
  image: IMAGE_COMPONENT,
  footnote: "Footnote",
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

/**
 * 삽입 항목 목록. 폼으로 고칠 수 없는 항목도 숨기지 않고 원문 순서로 함께 둔다.
 * @param kinds 주면 그 종류만 둔다. 일반 편집은 이미지만 폼으로 고친다.
 */
export function insertEntries(
  list: Extract<InsertList, { ok: true }>,
  kinds?: InsertKind[],
): (InsertItem | LimitedInsert)[] {
  return [...list.items, ...list.limited]
    .filter((entry) => !kinds || kinds.includes(entry.kind))
    .sort((a, b) => a.from - b.from);
}

/** 고칠 값이 있는 항목. 삽입 항목 목록에서 수정 폼을 열 수 있다. */
export function isTextInsert(entry: InsertItem | LimitedInsert): entry is TextInsertItem {
  return !("reason" in entry) && entry.kind !== "toc";
}
