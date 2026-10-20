import type { CreatePostResult, SaveState } from "@/lib/content";

import { uploadMessage } from "../post/upload-message";

/** 새 글 만들기에는 바뀐 것이 없어 커밋하지 않는 결과가 없다. */
export type CreateState = Exclude<SaveState, { status: "unchanged" }>;

export const createError = (
  message: string,
  { detail, fields }: { detail?: string; fields?: { [key: string]: string } } = {},
): CreateState => ({ status: "error", message, detail, fields });

/**
 * 새 글 만들기 결과를 화면 상태로. 만들면 화면이 그 글의 편집 화면(`savedHref`)으로 간다.
 * 서버에서 이동하지 않고 화면에 맡겨, 화면이 만들기 성공에 따른 이동을 다른 이동과 구분하게 한다.
 */
export function createResultState(
  result: CreatePostResult,
  savedHref: (path: string, commit: string) => string,
): CreateState {
  if (result.ok) return { status: "saved", href: savedHref(result.path, result.commit) };
  switch (result.reason) {
    case "invalid":
      // 컬렉션은 화면이 bind한 값이라 입력 칸이 없다. config가 바뀐 경우라 목록에서 다시 고르게 한다.
      if (result.errors.some((e) => e.key === "collection")) {
        return createError("고른 글 분류가 레포의 편집 설정에 없어요. 글 목록에서 글 분류를 다시 골라 주세요.");
      }
      return createError("입력한 값을 확인해 주세요. 표시된 항목을 고친 뒤 다시 만들어 주세요.", {
        fields: Object.fromEntries(result.errors.map((e) => [e.key, e.message])),
      });
    case "exists":
      return createError("입력한 값을 확인해 주세요. 표시된 항목을 고친 뒤 다시 만들어 주세요.", {
        fields: { title: "같은 이름의 글 폴더가 이미 있어요. 제목을 바꿔 주세요." },
      });
    case "not-fast-forward":
      return createError("만드는 사이 다른 곳에서 레포가 바뀌었어요. 다시 만들어 주세요.");
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
      return createError(
        "이 글 분류는 편집 설정에 초안·게시 상태가 없어 저장할 수 없어요. 레포 관리자에게 편집 설정을 확인해 달라고 해 주세요.",
      );
  }
}
