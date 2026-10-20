import type { SaveBodyResult, SaveMetadataResult, SaveSourceResult, SaveState } from "@/lib/content";

import { uploadMessage } from "./upload-message";

export type SaveResult = SaveMetadataResult | SaveBodyResult | SaveSourceResult;

export const saveError = (message: string, fields?: { [key: string]: string }): SaveState => ({
  status: "error",
  message,
  fields,
});

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
      return saveError("입력을 확인한다.", Object.fromEntries(result.errors.map((e) => [e.key, e.message])));
    case "changed":
    case "not-fast-forward":
      return saveError("글을 연 뒤 다른 곳에서 바뀌었다. 입력을 따로 적어 두고 새로고침한 뒤 다시 저장한다.");
    case "compile":
      return saveError(`저장하면 사이트 빌드가 깨진다 (${result.error.line ?? "?"}행): ${result.error.message}`);
    case "not-editable":
      return saveError(`원문 모드에서만 고칠 수 있는 글이다: ${result.message}`);
    case "not-found":
      return saveError("글을 찾을 수 없다.");
    case "image":
      return saveError(uploadMessage(result.file, result.problem));
  }
}
