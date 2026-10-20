"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { PRIMARY_BUTTON_CLASS } from "@/app/_lib/ui";
import { useFormFlow } from "@/app/_lib/unsaved";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 폼 적용만 가져온다.
import {
  formDirty,
  formInitialValue,
  insertEntries,
  insertFormLabels,
  insertFormMessage,
  insertItemName,
  insertLimitMessage,
  isTextInsert,
  type InsertFormProblem,
  type InsertFormTarget,
  type TextInsertItem,
} from "@/lib/content/insert-form";
import type { FormArea } from "@/lib/content/save-flow";
import type { InsertKind, InsertList } from "@/lib/mdx-doc";

import { TOGGLE_BUTTON_CLASS } from "./editor-mode-switch";

type OpenedForm = { target: InsertFormTarget; value: string; problem: string | null };

/**
 * 편집 영역 하나의 넣기·수정 폼. 일반 편집과 원문 편집이 같은 폼을 쓰도록 편집기에 적용하는 방법만 영역이 정한다.
 * 폼은 적용할 때만 원문을 바꾸고, 바꾼 원문의 미저장 판정은 영역의 편집기가 한다.
 * @param apply 폼 입력을 그 영역의 편집기에 적용한다. 적용하지 못하면 원문을 그대로 두고 이유를 돌려준다.
 */
export function useInsertForm({
  area,
  apply,
}: {
  area: FormArea;
  apply: (target: InsertFormTarget, value: string) => InsertFormProblem | null;
}) {
  const flow = useFormFlow();
  const [opened, setOpened] = useState<OpenedForm | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (opened || !restoreFocus.current) return;
    restoreFocus.current = false;
    opener.current?.focus();
  }, [opened]);
  // 폼이 열린 채 영역이 사라지면 저장이 막힌 채 남지 않게 닫는다.
  const { close: closeFlow } = flow;
  const isOpen = opened !== null;
  useEffect(() => (isOpen ? closeFlow : undefined), [isOpen, closeFlow]);

  const close = () => {
    flow.close();
    restoreFocus.current = true;
    setOpened(null);
  };

  return {
    /** 폼을 열 수 있는지. 저장 중이거나 확인 중이거나 다른 폼이 열려 있으면 열 수 없다. */
    canOpen: flow.canOpen,
    /**
     * 폼을 연다. 열 수 없으면 false.
     * @param from 폼을 닫으면 초점을 돌려줄 요소(연 버튼이나 연 항목).
     */
    open(target: InsertFormTarget, from: HTMLElement | null): boolean {
      if (!flow.open(area)) return false;
      flow.edit(formDirty(target, formInitialValue(target)));
      opener.current = from;
      setOpened({ target, value: formInitialValue(target), problem: null });
      return true;
    },
    panel: opened && (
      <InsertFormPanel
        {...insertFormLabels(opened.target)}
        value={opened.value}
        problem={opened.problem}
        onInput={(value) => {
          setOpened({ ...opened, value, problem: null });
          flow.edit(formDirty(opened.target, value));
        }}
        onApply={() => {
          const problem = apply(opened.target, opened.value);
          if (problem) {
            setOpened({ ...opened, problem: insertFormMessage(opened.target, problem) });
            return;
          }
          close();
        }}
        onCancel={close}
      />
    ),
  };
}

/**
 * 적용·취소가 있는 폼. 편집 영역의 `<form>` 안에 놓이므로 `<form>`을 겹치지 않고,
 * Enter는 영역 저장 대신 적용, Esc는 취소로 받는다. 열리면 입력 칸으로 초점이 간다.
 */
function InsertFormPanel({
  title,
  field,
  value,
  problem,
  onInput,
  onApply,
  onCancel,
}: {
  title: string;
  field: string;
  value: string;
  problem: string | null;
  onInput: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  return (
    <div
      role="form"
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded border p-3"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      }}
    >
      <h3 id={titleId} className="font-medium">
        {title}
      </h3>
      <label className="flex flex-col gap-1 text-sm">
        {field}
        <input
          ref={input}
          value={value}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            onApply();
          }}
          className="rounded border px-2 py-1"
        />
      </label>
      {problem && <p className="text-sm text-red-600">{problem}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onApply} className={PRIMARY_BUTTON_CLASS}>
          적용
        </button>
        <button type="button" onClick={onCancel} className="rounded border px-4 py-2">
          취소
        </button>
      </div>
    </div>
  );
}

/** 일반 편집은 이미지만 폼으로 고치므로 목록도 이미지만 보인다. */
const ENTRY_LISTS: { [area in FormArea]: { label: string; empty: string; kinds?: InsertKind[] } } = {
  body: { label: "본문 이미지", empty: "본문에 이미지가 없어요.", kinds: ["image"] },
  source: { label: "삽입 항목", empty: "이 글에는 이미지·각주·각주 출처·목차가 없어요." },
};

/**
 * 원문의 이미지·각주·각주 출처·목차 목록. 고칠 값이 있는 항목은 ‘수정’으로 폼을 연다.
 * 폼으로 고칠 수 없는 항목도 숨기지 않고 구체적인 이유와 원문에서 고치는 방법을 알린다.
 */
export function InsertEntryList({
  area,
  list,
  disabled,
  onEdit,
}: {
  area: FormArea;
  list: InsertList;
  disabled: boolean;
  onEdit: (item: TextInsertItem, opener: HTMLElement) => void;
}) {
  const { label, empty, kinds } = ENTRY_LISTS[area];
  const entries = list.ok ? insertEntries(list, kinds) : [];
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">
        {label}
        {list.ok && ` ${entries.length}개`}
      </summary>
      {!list.ok ? (
        <p className="mt-2 text-amber-600">
          원문을 읽을 수 없어 {label} 목록을 보일 수 없어요. 원문의 오류를 고쳐 주세요.
        </p>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {/* 적용으로 위치가 바뀌어도 고친 항목의 수정 버튼이 남아 초점을 돌려받도록 순서로 key를 둔다. */}
          {entries.map((entry, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{insertItemName(entry)}</span>
              {isTextInsert(entry) ? (
                <>
                  <span className="break-all text-zinc-500">
                    {formInitialValue({ kind: "edit", item: entry }) || "(비어 있음)"}
                  </span>
                  <button
                    type="button"
                    aria-label={`${insertItemName(entry)} 수정`}
                    disabled={disabled}
                    onClick={(event) => onEdit(entry, event.currentTarget)}
                    className={TOGGLE_BUTTON_CLASS}
                  >
                    수정
                  </button>
                </>
              ) : (
                "reason" in entry && <span className="text-amber-600">{insertLimitMessage(entry.reason, area)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export type InsertMenuItem = { label: string; onSelect: (opener: HTMLElement) => void };

/**
 * ‘넣기’ 메뉴. 화살표·Home·End로 항목을 옮기고 Enter로 고르며 Esc로 닫는다.
 * 고른 항목이 연 폼을 닫으면 초점이 이 메뉴 버튼으로 돌아오도록 버튼을 `onSelect`에 넘긴다.
 */
export function InsertMenu({ items, disabled }: { items: InsertMenuItem[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const entries = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (open) entries()[0]?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const move = (event: KeyboardEvent) => {
    const all = entries();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next: { [key: string]: number } = {
      ArrowDown: (at + 1) % all.length,
      ArrowUp: (at - 1 + all.length) % all.length,
      Home: 0,
      End: all.length - 1,
    };
    if (event.key === "Escape") close();
    else if (event.key in next) all[next[event.key]!]?.focus();
    else return;
    event.preventDefault();
  };

  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
        className={`w-fit ${TOGGLE_BUTTON_CLASS}`}
      >
        넣기
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="넣기"
          onKeyDown={move}
          // Tab이나 바깥 클릭으로 초점이 메뉴를 벗어나면 닫는다.
          onBlur={(event) => {
            if (!menu.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
          className="flex w-fit flex-col rounded border py-1"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                item.onSelect(button.current!);
              }}
              className="px-3 py-1 text-left text-sm focus:bg-zinc-100 focus:outline-none dark:focus:bg-zinc-800"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
