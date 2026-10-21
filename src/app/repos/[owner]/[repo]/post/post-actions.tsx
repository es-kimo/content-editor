"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/app/_lib/confirm-dialog";
import { useAbandon } from "@/app/_lib/leave";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/app/_lib/ui";
import { FormBlockedNotice, useImagePreparing, useLeavingAreas, useSave, useUnsavedChanged } from "@/app/_lib/unsaved";
import type { EditorMode } from "@/lib/content/editor-modes";
import { removeConfirm, type RemoveConfirm } from "@/lib/content/remove-confirm";
import {
  BODY_FIELD,
  newPostRequest,
  SUBMENU_FIELD,
  type PostActions,
  type RemoveAction,
  type SaveRequest,
  type SaveState,
  type SaveTarget,
} from "@/lib/content/save-flow";
import { unsavedAreas } from "@/lib/content/unsaved";
import { fieldLabel, type PostAction } from "@/lib/metadata-form";

import type { PostSaveInput } from "./actions";
import { AutosaveNotice, useDrafts } from "./drafts";
import { usePostEditor } from "./post-editor";
import { SaveResultNotice } from "./save-row";

const LABELS: { [action in PostAction]: string } = {
  "save-draft": "임시저장",
  publish: "게시",
  update: "수정 반영",
  unpublish: "게시 내리기",
};

const REMOVE_LABELS: { [action in RemoveAction]: string } = { trash: "삭제", cancel: "작성 취소" };

const TRASH: SaveRequest = { target: "post", action: "trash" };

const isPostAction = (value: string | null): value is PostAction => value !== null && Object.hasOwn(LABELS, value);

/** 누른 행동의 저장 요청. 새 글이 할 수 없는 행동이면 null. */
function saveRequest(target: SaveTarget, action: PostAction, mode: EditorMode): SaveRequest | null {
  if (target === "new") return newPostRequest(action, mode);
  return action === "unpublish" ? { target, action } : { target, action, mode };
}

/**
 * 글 상태별 저장 버튼 한 줄. 누른 행동으로 지금 모드의 글 전체를 한 번에 저장한다.
 * 게시 내리기는 확인한 뒤에 하고, 저장하지 않은 변경이 있으면 버려진다고 먼저 알린다.
 * ‘삭제’는 미저장 변경을 먼저 저장하거나 버리게 한 뒤 확인하고 휴지통으로 옮긴다.
 * 새 글 화면(`target` "new")은 ‘임시저장’·‘게시’로 처음 저장하고, ‘작성 취소’를 확인하면 입력을 버리고 `cancelHref`로 간다.
 */
export function PostActionBar({
  actions,
  title,
  target = "post",
  save,
  trash,
  cancelHref,
}: {
  actions: PostActions;
  /** 확인 대화상자에 적을 글 제목. */
  title: string;
  target?: SaveTarget;
  save: (input: PostSaveInput, data: FormData) => Promise<SaveState>;
  /** 저장된 글을 휴지통으로 옮긴다. */
  trash?: () => Promise<SaveState>;
  /** 새 글 작성을 취소하면 갈 글 목록. */
  cancelHref?: string;
}) {
  const flow = useSave(target);
  const { mode, collect } = usePostEditor();
  const changed = unsavedAreas(useUnsavedChanged());
  const lost = useLeavingAreas();
  const preparing = useImagePreparing();
  const abandon = useAbandon();
  const drafts = useDrafts();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState<RemoveConfirm | null>(null);

  if (!actions.ok) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-amber-600">{actions.notice}</p>
        <AutosaveNotice />
      </div>
    );
  }

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
    const submit = () => save({ action, mode, text: input.text }, input.data);
    // 저장하는 동안 입력이 막히므로 보관할 입력도 지금 모은 것이 저장한 내용이다.
    const saved = drafts?.collect() ?? null;
    flow.request(request, drafts ? () => drafts.autosave.saving(saved, submit) : submit, input.unchanged);
  };

  const removal = (discarded: boolean) =>
    removeConfirm({ action: actions.remove, title, status: actions.status, lost: discarded ? [] : lost });

  const remove = () => {
    if (actions.remove === "trash" && flow.blocks(TRASH)) return;
    setRemoving(removal(false));
  };

  const confirmRemove = () => {
    setRemoving(null);
    if (actions.remove === "cancel" && cancelHref) return abandon(cancelHref);
    if (trash) flow.request(TRASH, trash);
  };

  const removable = actions.remove === "trash" ? trash !== undefined : cancelHref !== undefined;
  const pending = flow.pending ? flow.pending.action : null;
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
        {removable && (
          <button
            type="button"
            // 작성 취소는 준비 중인 이미지도 함께 버리므로 저장 중일 때만 막는다.
            disabled={flow.locked || (actions.remove === "trash" && preparing)}
            onClick={remove}
            className={SECONDARY_BUTTON_CLASS}
          >
            {pending === "trash" ? "옮기는 중…" : REMOVE_LABELS[actions.remove]}
          </button>
        )}
      </div>
      {(isPostAction(flow.formBlocked) || flow.formBlocked === "trash") && <FormBlockedNotice />}
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
      <AutosaveNotice />
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
      {/* 버리기를 고르면 이 대화상자가 닫히며 초점을 ‘삭제’로 돌린 뒤 아래 확인이 열리도록 확인보다 앞에 둔다. */}
      <ConfirmDialog
        open={removing?.kind === "unsaved"}
        title={removing?.title ?? ""}
        confirmLabel="변경 버리기"
        alternate={
          removing?.kind === "unsaved"
            ? {
                label: LABELS[removing.save],
                onClick: () => {
                  setRemoving(null);
                  run(removing.save);
                },
              }
            : undefined
        }
        onKeep={() => setRemoving(null)}
        onConfirm={() => setRemoving(removal(true))}
      >
        <p className="text-sm text-amber-600">{removing?.message}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={removing?.kind === "confirm"}
        title={removing?.title ?? ""}
        confirmLabel={removing?.kind === "confirm" ? removing.confirmLabel : ""}
        onKeep={() => setRemoving(null)}
        onConfirm={confirmRemove}
      >
        <p className="text-sm">{removing?.message}</p>
      </ConfirmDialog>
    </div>
  );
}
