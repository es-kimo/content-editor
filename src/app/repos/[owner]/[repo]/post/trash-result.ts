import type { SaveState, TrashResult } from "@/lib/content";

import { saveError, savedPostHref, saveResultState } from "./save-result";

/** 휴지통으로 옮기거나 휴지통에서 꺼내는 행동. */
export type TrashCommand = "trash" | "restore";

/** 같은 행동을 다시 했다. 다른 탭이나 다른 사람이 먼저 했으니 지금 상태를 보게 한다. */
const ALREADY_MESSAGES: { [command in TrashCommand]: string } = {
  trash: "이미 휴지통에 있는 글이에요. 글을 다시 열어 지금 상태를 확인해 주세요.",
  restore: "이미 휴지통에서 꺼낸 글이에요. 글을 다시 열어 지금 상태를 확인해 주세요.",
};

/**
 * 휴지통 이동·복구는 화면의 입력을 담지 않으므로, 충돌 안내에 입력을 따로 보관하라는 말을 넣지 않는다.
 * 다른 곳에서 바뀐 글을 덮어쓰지 않았다는 것과 다시 열어 볼 것을 알린다.
 */
const CHANGED_MESSAGE = "화면을 연 뒤 다른 곳에서 글이 바뀌었어요. 글을 다시 열어 바뀐 내용을 확인해 주세요.";

/**
 * 휴지통 이동·복구 결과를 화면 상태로. 성공하면 그 글 화면(`postHref`)을 행동과 함께 다시 연다.
 * 그 밖의 실패(글 없음, 상태를 다룰 수 없음, 컴파일 오류)는 저장과 같은 안내다.
 */
export function trashResultState(result: TrashResult, command: TrashCommand, postHref: string): SaveState {
  if (result.ok) return { status: "saved", href: savedPostHref(postHref, result.commit, command) };
  switch (result.reason) {
    case "unchanged":
      return saveError(ALREADY_MESSAGES[command]);
    case "changed":
    case "not-fast-forward":
      return saveError(CHANGED_MESSAGE);
    default:
      return saveResultState(result, () => postHref);
  }
}
