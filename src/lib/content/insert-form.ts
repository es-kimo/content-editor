// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import {
  addFootnote,
  setInsertText,
  type InsertEdit,
  type InsertItem,
  type InsertKind,
  type InsertSpan,
  type LimitedInsert,
  type Syntax,
} from "@/lib/mdx-doc";

/** 값 하나를 고치는 폼으로 다루는 기존 항목. 목차는 고칠 값이 없다. */
export type TextInsertItem = Exclude<InsertItem, { kind: "toc" }>;

/**
 * 폼이 고칠 대상. 폼을 연 영역의 원문(일반 편집은 본문, 원문 편집은 파일 전체)에서 읽은 위치다.
 * - edit: 기존 항목의 값(이미지 대체 텍스트, 각주·출처 내용)을 고친다
 * - footnote: `at`에 새 각주를 넣는다. `opened`는 폼을 연 때의 원문이다
 */
export type InsertFormTarget =
  { kind: "edit"; item: TextInsertItem } | { kind: "footnote"; at: InsertSpan; opened: string };

export type InsertFormProblem = Extract<InsertEdit, { ok: false }>["reason"];

/** 폼을 적용한 결과. 실패하면 원문을 바꾸지 않는다. `changed`가 false면 원문이 그대로라 편집기에 쓰지 않는다. */
export type InsertFormApply =
  { ok: true; source: string; cursor: number; changed: boolean } | { ok: false; reason: InsertFormProblem };

/** 폼을 열 때 입력 칸의 처음 값. */
export function formInitialValue(target: InsertFormTarget): string {
  if (target.kind === "footnote") return "";
  return target.item.kind === "image" ? target.item.alt : target.item.text;
}

/** 폼 안의 작성 중 입력이 처음 값과 다른지. 다르면 적용하지 않고 떠날 때 잃는 입력이다. */
export function formDirty(target: InsertFormTarget, value: string): boolean {
  return value !== formInitialValue(target);
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
  else if (source !== target.opened) return { ok: false, reason: "target-changed" };
  else edit = addFootnote(source, target.at, value, syntax);
  if (!edit.ok) return edit;
  return { ...edit, changed: edit.source !== source };
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
    default:
      return "이 항목은 폼으로 고칠 수 없어요. 원문에서 직접 고쳐 주세요.";
  }
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

/** 기존 항목 수정 폼의 입력 칸 이름. */
export function insertFieldLabel(item: TextInsertItem): string {
  return item.kind === "image" ? "대체 텍스트" : item.kind === "footnote" ? "각주 내용" : "출처 내용";
}
