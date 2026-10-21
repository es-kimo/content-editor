import { STATUS_PROBLEM_MESSAGES, TRASHED_MESSAGE, type SaveEditResult, type SaveState } from "@/lib/content";
import type { PostAction } from "@/lib/metadata-form";

import { uploadMessage } from "./upload-message";

export const saveError = (
  message: string,
  { detail, fields }: { detail?: string; fields?: { [key: string]: string } } = {},
): SaveState => ({ status: "error", message, detail, fields });

/** 행동별 저장 성공 문구. 저장 성공은 사이트 반영이 아니므로 게시·게시 내리기는 반영이 늦을 수 있다고 알린다. */
const SAVED_MESSAGES: { [action in PostAction]: string } = {
  "save-draft": "임시저장했어요. 게시하기 전에는 사이트에 보이지 않아요.",
  publish: "게시 대상으로 저장했어요. 사이트에 반영되기까지 시간이 걸릴 수 있어요.",
  update: "게시 대상으로 저장했어요. 사이트에 반영되기까지 시간이 걸릴 수 있어요.",
  unpublish: "초안으로 바꿨어요. 사이트에서 사라지기까지 시간이 걸릴 수 있어요.",
};

/**
 * 저장한 글 화면 주소. 새 커밋과 한 행동을 담는다.
 * 저장 결과 문구는 다시 열린 화면이 보이므로, 화면이 이 주소에서 행동을 읽어 `savedMessage`로 보인다.
 */
export function savedPostHref(postHref: string, commit: string, action: PostAction): string {
  return `${postHref}&${new URLSearchParams({ saved: commit, action })}`;
}

/** 저장한 글 화면이 보일 성공 문구. 주소의 행동을 알 수 없으면 행동을 말하지 않는다. */
export function savedMessage(action: string | undefined): string {
  return action !== undefined && Object.hasOwn(SAVED_MESSAGES, action)
    ? SAVED_MESSAGES[action as PostAction]
    : "저장했어요.";
}

/**
 * 글 저장 결과를 화면 상태로. 성공하면 화면이 저장한 글 화면(`savedHref`)으로 간다.
 * 서버에서 이동하지 않고 화면에 맡겨, 화면이 저장 성공에 따른 이동을 다른 이동과 구분하게 한다.
 * 실패는 모두 오류 상태라 화면의 입력과 첨부가 그대로 남는다.
 */
export function saveResultState(result: SaveEditResult, savedHref: (commit: string) => string): SaveState {
  if (result.ok) return { status: "saved", href: savedHref(result.commit) };
  switch (result.reason) {
    case "unchanged":
      return { status: "unchanged" };
    case "invalid":
      return saveError("입력한 값을 확인해 주세요. 표시된 항목을 고친 뒤 다시 저장해 주세요.", {
        fields: Object.fromEntries(result.errors.map((e) => [e.key, e.message])),
      });
    case "changed":
    case "not-fast-forward":
      return saveError("글을 연 뒤 다른 곳에서 글이 바뀌었어요. 입력한 내용을 따로 보관한 뒤 글을 다시 열어 주세요.");
    case "compile":
      return saveError(
        "이대로 저장하면 사이트에서 글을 보여 줄 수 없어요. 원문 편집에서 오류 표시가 있는 줄을 고친 뒤 다시 저장해 주세요.",
        { detail: `${result.error.line ?? "?"}행: ${result.error.message}` },
      );
    case "not-editable":
      return saveError("이 글은 일반 편집으로 저장할 수 없어요. 원문 편집을 이용해 주세요.", {
        detail: result.message,
      });
    case "not-found":
      return saveError("글을 찾을 수 없어요. 글 목록에서 글을 다시 열어 주세요.");
    case "image":
      return saveError(uploadMessage(result.file, result.problem));
    case "status-field":
    case "status-options":
    case "status-value":
    case "action":
      return saveError(STATUS_PROBLEM_MESSAGES[result.reason]);
    case "source-status":
      return saveError(
        "원문의 글 설정을 읽을 수 없어 게시 상태를 맞출 수 없어요. 원문 편집에서 글 설정을 고친 뒤 다시 저장해 주세요.",
      );
    case "trashed":
      return saveError(TRASHED_MESSAGE);
    case "trash-edit":
      return saveError(
        "휴지통 표시는 저장으로 더할 수 없어요. 원문 편집에서 글 설정의 휴지통 표시를 지운 뒤 다시 저장해 주세요.",
      );
  }
}
