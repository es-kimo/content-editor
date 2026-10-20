import type { SaveBodyResult, SaveMetadataResult, SaveSourceResult, SaveState } from "@/lib/content";

import { uploadMessage } from "./upload-message";

export type SaveResult = SaveMetadataResult | SaveBodyResult | SaveSourceResult;

export const saveError = (
  message: string,
  { detail, fields }: { detail?: string; fields?: { [key: string]: string } } = {},
): SaveState => ({ status: "error", message, detail, fields });

/**
 * 글 화면 편집 영역의 저장 결과를 화면 상태로. 성공하면 화면이 저장한 글 화면(`savedHref`)으로 간다.
 * 서버에서 이동하지 않고 화면에 맡겨, 화면이 저장 성공에 따른 이동을 다른 이동과 구분하게 한다.
 */
export function saveResultState(result: SaveResult, savedHref: (commit: string) => string): SaveState {
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
  }
}
