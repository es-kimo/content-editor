"use client";

import { useState, type ReactNode } from "react";

import type { EditorMode } from "@/lib/content";

const LABELS: { [mode in EditorMode]: string } = { wysiwyg: "WYSIWYG", source: "원문" };

/** 눌림 상태(`aria-pressed`)를 반전으로 보이는 버튼. */
export const TOGGLE_BUTTON_CLASS =
  "rounded border px-3 py-1 text-sm aria-pressed:bg-black aria-pressed:text-white dark:aria-pressed:bg-white dark:aria-pressed:text-black";

/** WYSIWYG와 원문 모드를 오간다. 두 편집기를 모두 띄워 두고 숨기기만 해서, 모드를 바꿔도 저장하지 않은 입력이 남는다. */
export function EditorModeSwitch({
  initial,
  wysiwyg,
  source,
}: {
  initial: EditorMode;
  wysiwyg: ReactNode;
  source: ReactNode;
}) {
  const [mode, setMode] = useState(initial);
  const editors: { [mode in EditorMode]: ReactNode } = { wysiwyg, source };

  return (
    <>
      <div className="flex gap-2" role="group" aria-label="본문 편집 모드">
        {(Object.keys(LABELS) as EditorMode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={m === mode}
            onClick={() => setMode(m)}
            className={TOGGLE_BUTTON_CLASS}
          >
            {LABELS[m]}
          </button>
        ))}
      </div>
      {(Object.keys(editors) as EditorMode[]).map((m) => (
        <div key={m} hidden={m !== mode}>
          {editors[m]}
        </div>
      ))}
    </>
  );
}
