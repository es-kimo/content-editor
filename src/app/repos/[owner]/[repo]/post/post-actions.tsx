"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/app/_lib/confirm-dialog";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/app/_lib/ui";
import { FormBlockedNotice, useImagePreparing, useSave, useUnsavedChanged } from "@/app/_lib/unsaved";
import type { EditorMode } from "@/lib/content/editor-modes";
import {
  BODY_FIELD,
  newPostRequest,
  SUBMENU_FIELD,
  type PostActions,
  type SaveRequest,
  type SaveState,
  type SaveTarget,
} from "@/lib/content/save-flow";
import { unsavedAreas } from "@/lib/content/unsaved";
import { fieldLabel, type PostAction } from "@/lib/metadata-form";

import type { PostSaveInput } from "./actions";
import { usePostEditor } from "./post-editor";
import { SaveResultNotice } from "./save-row";

const LABELS: { [action in PostAction]: string } = {
  "save-draft": "임시저장",
  publish: "게시",
  update: "수정 반영",
  unpublish: "게시 내리기",
};

const isPostAction = (value: string | null): value is PostAction => value !== null && Object.hasOwn(LABELS, value);

/** 누른 행동의 저장 요청. 새 글이 할 수 없는 행동이면 null. */
function saveRequest(target: SaveTarget, action: PostAction, mode: EditorMode): SaveRequest | null {
  if (target === "new") return newPostRequest(action, mode);
  return action === "unpublish" ? { target, action } : { target, action, mode };
}

/**
 * 글 상태별 저장 버튼 한 줄. 누른 행동으로 지금 모드의 글 전체를 한 번에 저장한다.
 * 게시 내리기는 확인한 뒤에 하고, 저장하지 않은 변경이 있으면 버려진다고 먼저 알린다.
 * 새 글 화면(`target` "new")은 ‘임시저장’·‘게시’로 처음 저장한다.
 */
export function PostActionBar({
  actions,
  title,
  target = "post",
  save,
}: {
  actions: PostActions;
  /** 확인 대화상자에 적을 글 제목. */
  title: string;
  target?: SaveTarget;
  save: (input: PostSaveInput, data: FormData) => Promise<SaveState>;
}) {
  const flow = useSave(target);
  const { mode, collect } = usePostEditor();
  const changed = unsavedAreas(useUnsavedChanged());
  const preparing = useImagePreparing();
  const [confirming, setConfirming] = useState(false);

  if (!actions.ok) return <p className="text-sm text-amber-600">{actions.notice}</p>;

  const unpublish = () => {
    setConfirming(false);
    flow.request({ target: "post", action: "unpublish" }, () =>
      save({ action: "unpublish", mode, text: "" }, new FormData()),
    );
  };

  const run = (action: PostAction) => {
    const request = saveRequest(target, action, mode);
    if (!request || flow.blocks(request)) return;
    if (action === "unpublish") return setConfirming(true);
    const input = collect();
    if (!input) return;
    flow.request(request, () => save({ action, mode, text: input.text }, input.data), input.unchanged);
  };

  const pending = flow.pending && "action" in flow.pending ? flow.pending.action : null;
  // 일반 편집의 설정 필드와 새 글의 하위 메뉴 오류는 그 필드 옆에 보이므로, 여기에는 화면에 자리가 없는 필드의 오류만 둔다.
  const fields = flow.state.status === "error" ? Object.entries(flow.state.fields ?? {}) : [];
  const unplaced = fields.filter(([key]) => key !== SUBMENU_FIELD && (mode === "source" || key === BODY_FIELD));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {[actions.primary, ...actions.secondary].map((action) => (
          <button
            key={action}
            type="button"
            disabled={flow.locked || preparing}
            onClick={() => run(action)}
            className={action === actions.primary ? PRIMARY_BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
          >
            {pending === action ? "저장 중…" : LABELS[action]}
          </button>
        ))}
      </div>
      {isPostAction(flow.formBlocked) && <FormBlockedNotice />}
      {preparing && (
        <p className="text-sm text-zinc-500">이미지를 준비하고 있어요. 대체 텍스트를 넣은 뒤 저장해 주세요.</p>
      )}
      {unplaced.length > 0 && (
        <ul className="text-xs text-red-600">
          {unplaced.map(([key, message]) => (
            <li key={key}>
              {key === BODY_FIELD ? "본문" : fieldLabel(key)}: {message}
            </li>
          ))}
        </ul>
      )}
      <SaveResultNotice state={flow.state} />
      <ConfirmDialog
        open={confirming}
        title={`‘${title}’의 게시를 내릴까요?`}
        confirmLabel={LABELS.unpublish}
        onKeep={() => setConfirming(false)}
        onConfirm={unpublish}
      >
        <p className="text-sm">게시를 내리면 초안이 돼요. 사이트에서 사라지기까지 시간이 걸릴 수 있어요.</p>
        {changed.length > 0 && (
          <p className="text-sm text-amber-600">
            저장하지 않은 변경은 버려져요. 바뀐 곳: {changed.join(", ")}. 반영하려면 ‘계속 편집’을 누른 뒤 ‘수정 반영’을
            먼저 해 주세요.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
