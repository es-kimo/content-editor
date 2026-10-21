"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/app/_lib/ui";

/**
 * 입력을 잃을 수 있는 조작 전에 묻는다. `계속 편집`이 기본 선택이고, Esc로 닫아도 계속 편집과 같다.
 * 닫히면 열릴 때 초점이 있던 곳(누른 버튼·링크, 입력하던 칸)으로 초점을 돌린다.
 * `alternate`는 계속 편집과 실행 사이의 다른 선택(예: 먼저 저장)이다.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  alternate,
  onKeep,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  alternate?: { label: string; onClick: () => void };
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
      keep.current?.focus();
    } else if (!open && element.open) {
      element.close();
      opener.current?.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      // 닫기는 상태가 바뀐 뒤 effect가 한다.
      onCancel={(event) => {
        event.preventDefault();
        onKeep();
      }}
      className="m-auto max-w-md flex-col gap-2 rounded border bg-background p-4 text-foreground open:flex"
    >
      {open && (
        <>
          <h2 id={titleId} className="font-medium">
            {title}
          </h2>
          {children}
          <div className="flex flex-wrap gap-3">
            <button ref={keep} type="button" onClick={onKeep} className={PRIMARY_BUTTON_CLASS}>
              계속 편집
            </button>
            {alternate && (
              <button type="button" onClick={alternate.onClick} className={SECONDARY_BUTTON_CLASS}>
                {alternate.label}
              </button>
            )}
            <button type="button" onClick={onConfirm} className={SECONDARY_BUTTON_CLASS}>
              {confirmLabel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
