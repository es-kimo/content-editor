import {
  STATUS_PROBLEM_MESSAGES,
  type CreatePostResult,
  type ModeSwitchProblem,
  type NewPostAction,
  type SaveState,
} from "@/lib/content";

import { savedPostHref } from "../post/save-result";
import { uploadMessage } from "../post/upload-message";

/** 새 글 저장에는 바뀐 것이 없어 커밋하지 않는 결과가 없다. */
export type CreateState = Exclude<SaveState, { status: "unchanged" }>;

export const createError = (
  message: string,
  { detail, fields }: { detail?: string; fields?: { [key: string]: string } } = {},
): CreateState => ({ status: "error", message, detail, fields });

const CHECK_FIELDS = "입력한 값을 확인해 주세요. 표시된 항목을 고친 뒤 다시 저장해 주세요.";

/**
 * 새 글 저장 결과를 화면 상태로. 저장하면 화면이 그 글의 글 화면으로 간다.
 * 글 화면이 주소의 행동으로 임시저장·게시 성공 문구(`savedMessage`)를 보이므로, 주소에 한 행동을 담는다.
 * 서버에서 이동하지 않고 화면에 맡겨, 화면이 저장 성공에 따른 이동을 다른 이동과 구분하게 한다.
 * @param postHref 저장한 글 경로의 글 화면 주소.
 */
export function createResultState(
  result: CreatePostResult,
  action: NewPostAction,
  postHref: (path: string) => string,
): CreateState {
  if (result.ok) return { status: "saved", href: savedPostHref(postHref(result.path), result.commit, action) };
  switch (result.reason) {
    case "invalid":
      // 컬렉션은 화면이 bind한 값이라 입력 칸이 없다. config가 바뀐 경우라 목록에서 다시 고르게 한다.
      if (result.errors.some((e) => e.key === "collection")) {
        return createError("고른 글 분류가 레포의 편집 설정에 없어요. 글 목록에서 글 분류를 다시 골라 주세요.");
      }
      return createError(CHECK_FIELDS, { fields: Object.fromEntries(result.errors.map((e) => [e.key, e.message])) });
    case "exists":
      return createError(CHECK_FIELDS, {
        fields: { title: "같은 이름의 글 폴더가 이미 있어요. 제목을 바꿔 주세요." },
      });
    case "not-fast-forward":
      return createError("저장하는 사이 다른 곳에서 레포가 바뀌었어요. 다시 저장해 주세요.");
    case "compile":
      return createError(
        "이대로 저장하면 사이트에서 글을 보여 줄 수 없어요. 오류 표시가 있는 줄을 고친 뒤 다시 저장해 주세요.",
        { detail: `${result.error.line ?? "?"}행: ${result.error.message}` },
      );
    case "image":
      return createError(uploadMessage(result.file, result.problem));
    // 새 글은 초안에서 시작하므로 상태 문제는 설정이 초안·게시 상태를 다루지 못할 때뿐이다.
    case "status-field":
    case "status-options":
    case "status-value":
    case "action":
      return createError(STATUS_PROBLEM_MESSAGES["status-field"]);
  }
}

/**
 * 원문 편집으로 쓴 새 글을 저장할 입력으로 바꾸지 못한 이유(`newPostFromSource`)를 화면 상태로.
 * 새 글은 제목·설정으로 글 폴더를 정하므로 일반 편집이 담을 수 있는 원문만 저장한다.
 */
export function sourceProblemState(problem: ModeSwitchProblem): CreateState {
  switch (problem.reason) {
    case "invalid":
      return createError(CHECK_FIELDS, { fields: Object.fromEntries(problem.errors.map((e) => [e.key, e.message])) });
    case "image":
      return createError(uploadMessage(problem.file, problem.problem));
    case "doc":
    case "metadata":
      return createError(
        "원문의 글 설정을 읽을 수 없어 새 글을 저장할 수 없어요. 원문 편집에서 글 설정을 고친 뒤 다시 저장해 주세요.",
        { detail: problem.message },
      );
    case "lossy":
    case "structure":
      return createError(
        "원문에 새 글로 저장할 수 없는 것(가져오기, 편집 설정에 없는 글 설정 등)이 있어요. 그 부분을 지운 뒤 다시 저장해 주세요.",
      );
  }
}
