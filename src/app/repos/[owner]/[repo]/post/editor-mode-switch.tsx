"use client";

import type { ReactNode } from "react";

import { TechDetails } from "@/app/_lib/ui";
import { FormBlockedNotice, useFormFlow, useImagePreparing, useSaveLocked } from "@/app/_lib/unsaved";
import type { EditorMode } from "@/lib/content";
import { MODE_SWITCH_MESSAGES } from "@/lib/content/mode-switch";

import { usePostEditor } from "./post-editor";

const LABELS: { [mode in EditorMode]: string } = { wysiwyg: "일반 편집", source: "원문 편집" };

/** 눌림 상태(`aria-pressed`)를 반전으로 보이는 버튼. */
export const TOGGLE_BUTTON_CLASS =
  "rounded border px-3 py-1 text-sm disabled:opacity-60 aria-pressed:bg-black aria-pressed:text-white dark:aria-pressed:bg-white dark:aria-pressed:text-black";

/**
 * WYSIWYG와 원문 모드를 오간다. 두 편집기를 모두 띄워 두고 숨기기만 한다. 모드는 `PostEditorProvider`가 둔다.
 * 바꾸면 지금 입력을 다른 모드로 이어받고, 이어받을 수 없으면 바꾸지 않고 이유를 보인다.
 */
export function EditorModeSwitch({ wysiwyg, source }: { wysiwyg: ReactNode; source: ReactNode }) {
  const { mode, switchMode, problem } = usePostEditor();
  // 저장 중에는 저장하는 편집기를 숨기지 않게 모드를 바꾸지 않는다.
  const locked = useSaveLocked();
  // 폼을 연 편집기를 숨기면 적용·취소할 수 없게 되므로 열린 폼이 있으면 바꾸지 않는다.
  const forms = useFormFlow();
  // 준비가 끝나면 이미지를 받은 편집기에 폼이 열리므로, 그 편집기를 숨겨 폼에 닿지 못하게 되지 않도록 바꾸지 않는다.
  const preparing = useImagePreparing();
  const editors: { [mode in EditorMode]: ReactNode } = { wysiwyg, source };
  const detail = problem && "message" in problem ? problem.message : null;

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
              if (m !== mode && !forms.blocks("mode")) switchMode(m);
            }}
            className={TOGGLE_BUTTON_CLASS}
          >
            {LABELS[m]}
          </button>
        ))}
        {forms.form?.blocked === "mode" && <FormBlockedNotice />}
        {problem && <p className="text-sm text-amber-600">{MODE_SWITCH_MESSAGES[problem.reason]}</p>}
        {preparing && (
          <p className="text-sm text-zinc-500">이미지를 준비하고 있어요. 대체 텍스트를 넣은 뒤 모드를 바꿔 주세요.</p>
        )}
      </div>
      {detail && <TechDetails items={[["오류 원문", detail]]} />}
      {(Object.keys(editors) as EditorMode[]).map((m) => (
        <div key={m} hidden={m !== mode}>
          {editors[m]}
        </div>
      ))}
    </>
  );
}
