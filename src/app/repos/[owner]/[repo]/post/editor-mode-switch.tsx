"use client";

import { useState, type ReactNode } from "react";

import {
  FormBlockedNotice,
  useFormFlow,
  useImagePreparing,
  useSaveLocked,
  useUnsavedChanged,
} from "@/app/_lib/unsaved";
import type { EditorMode } from "@/lib/content";
import { modeHasUnsaved } from "@/lib/content/save-flow";

import { usePostEditor } from "./post-editor";

const LABELS: { [mode in EditorMode]: string } = { wysiwyg: "일반 편집", source: "원문 편집" };

/** 눌림 상태(`aria-pressed`)를 반전으로 보이는 버튼. */
export const TOGGLE_BUTTON_CLASS =
  "rounded border px-3 py-1 text-sm disabled:opacity-60 aria-pressed:bg-black aria-pressed:text-white dark:aria-pressed:bg-white dark:aria-pressed:text-black";

/**
 * WYSIWYG와 원문 모드를 오간다. 두 편집기를 모두 띄워 두고 숨기기만 한다. 모드는 `PostEditorProvider`가 둔다.
 * 다른 모드는 지금 입력을 이어받지 못하므로, 지금 모드에 저장하지 않은 입력이 있으면 바꾸지 않는다.
 */
export function EditorModeSwitch({ wysiwyg, source }: { wysiwyg: ReactNode; source: ReactNode }) {
  const { mode, setMode } = usePostEditor();
  // 저장 중에는 저장하는 편집기를 숨기지 않게 모드를 바꾸지 않는다.
  const locked = useSaveLocked();
  // 폼을 연 편집기를 숨기면 적용·취소할 수 없게 되므로 열린 폼이 있으면 바꾸지 않는다.
  const forms = useFormFlow();
  // 준비가 끝나면 이미지를 받은 편집기에 폼이 열리므로, 그 편집기를 숨겨 폼에 닿지 못하게 되지 않도록 바꾸지 않는다.
  const preparing = useImagePreparing();
  const unsaved = modeHasUnsaved(mode, useUnsavedChanged());
  // 미저장 입력 때문에 막았는지. 입력을 저장하거나 되돌려 미저장이 사라지면 안내도 사라진다.
  const [blocked, setBlocked] = useState(false);
  const editors: { [mode in EditorMode]: ReactNode } = { wysiwyg, source };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="본문 편집 모드">
        {(Object.keys(LABELS) as EditorMode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={m === mode}
            disabled={locked || preparing}
            onClick={() => {
              if (m === mode || forms.blocks("mode")) return;
              setBlocked(unsaved);
              if (!unsaved) setMode(m);
            }}
            className={TOGGLE_BUTTON_CLASS}
          >
            {LABELS[m]}
          </button>
        ))}
        {forms.form?.blocked === "mode" && <FormBlockedNotice />}
        {blocked && unsaved && (
          <p className="text-sm text-amber-600">
            {LABELS[mode]}에 저장하지 않은 변경이 있어 모드를 바꿀 수 없어요. 먼저 저장하거나 변경을 되돌려 주세요.
          </p>
        )}
        {preparing && (
          <p className="text-sm text-zinc-500">이미지를 준비하고 있어요. 대체 텍스트를 넣은 뒤 모드를 바꿔 주세요.</p>
        )}
      </div>
      {(Object.keys(editors) as EditorMode[]).map((m) => (
        <div key={m} hidden={m !== mode}>
          {editors[m]}
        </div>
      ))}
    </>
  );
}
