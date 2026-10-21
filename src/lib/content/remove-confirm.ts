// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { PostAction, PostStatus } from "@/lib/metadata-form";

import type { RemoveAction } from "./save-flow";
import { areaNames, type EditArea } from "./unsaved";

/**
 * ‘삭제’·‘작성 취소’를 눌렀을 때 보일 확인.
 * `unsaved`는 휴지통으로 옮기면 잃을 미저장 입력이 있어 먼저 저장(`save`)하거나 버리게 하는 단계다.
 * `confirm`은 실행 전 마지막 확인이고, 실행 버튼 이름(`confirmLabel`)은 누른 버튼과 같다.
 */
export type RemoveConfirm =
  | { kind: "unsaved"; title: string; message: string; areas: string[]; save: PostAction }
  | { kind: "confirm"; action: RemoveAction; title: string; message: string; confirmLabel: string };

/** 저장된 글의 상태에서 휴지통으로 옮기기 전에 입력을 반영하는 저장. 상태는 그대로 둔다. */
const SAVE_BEFORE_TRASH: { [status in PostStatus]: PostAction } = { draft: "save-draft", ready: "update" };

/**
 * 글 없애기 확인 내용.
 * 저장된 글은 미저장 입력이 있으면 먼저 저장하거나 버리게 하고, 없으면(또는 버리기로 했으면) 휴지통 이동을 확인한다.
 * 휴지통 이동은 서버의 글에 휴지통 표시만 더해 화면의 입력이 담기지 않기 때문이다.
 * 저장한 적 없는 새 글은 작성 취소가 입력을 버리는 일 자체라 미저장 입력을 따로 묻지 않는다.
 * @param title 대상 글의 저장된 제목.
 * @param lost 지금 없애면 잃을 미저장 영역. 버리기로 했으면 빈 배열.
 */
export function removeConfirm({
  action,
  title,
  status,
  lost,
}: {
  action: RemoveAction;
  title: string;
  status: PostStatus;
  lost: EditArea[];
}): RemoveConfirm {
  if (action === "cancel") {
    return {
      kind: "confirm",
      action,
      title: "작성을 취소할까요?",
      message: "이 브라우저에 보관한 입력도 지워져요.",
      confirmLabel: "작성 취소",
    };
  }
  if (lost.length > 0) {
    const areas = areaNames(lost);
    return {
      kind: "unsaved",
      title: "저장하지 않은 변경이 있어요.",
      message: `바뀐 곳: ${areas.join(", ")}. 휴지통으로 옮기기 전에 변경을 저장하거나 버려 주세요.`,
      areas,
      save: SAVE_BEFORE_TRASH[status],
    };
  }
  return {
    kind: "confirm",
    action,
    title: `‘${title}’을 휴지통으로 옮길까요?`,
    message:
      "휴지통에서 초안으로 복구할 수 있어요. 첨부 이미지는 지우지 않아요. 사이트에서 사라지기까지 시간이 걸릴 수 있어요.",
    confirmLabel: "삭제",
  };
}
