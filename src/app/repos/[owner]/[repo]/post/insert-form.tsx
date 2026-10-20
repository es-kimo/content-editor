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
  insertFormNotice,
  insertItemName,
  insertLimitMessage,
  isTextInsert,
  isTocInsert,
  TOC_NEEDS_HEADING,
  tocRemoveMessage,
  type FootnoteChoice,
  type InsertFormInput,
  type InsertFormProblem,
  type InsertFormTarget,
  type TextInsertItem,
  type TocInsertItem,
} from "@/lib/content/insert-form";
import type { FormArea } from "@/lib/content/save-flow";
import type { InsertList } from "@/lib/mdx-doc";

import { TOGGLE_BUTTON_CLASS } from "./editor-mode-switch";

type OpenedForm = { target: InsertFormTarget; input: InsertFormInput; problem: string | null };

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
  apply: (target: InsertFormTarget, input: InsertFormInput) => InsertFormProblem | null;
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
      setOpened({ target, input: formInitialValue(target), problem: null });
      return true;
    },
    panel: opened && (
      <InsertFormPanel
        {...insertFormLabels(opened.target)}
        notice={insertFormNotice(opened.target)}
        choices={opened.target.kind === "footnote-ref" ? opened.target.choices : null}
        input={opened.input}
        problem={opened.problem}
        onInput={(input) => {
          setOpened({ ...opened, input, problem: null });
          flow.edit(formDirty(opened.target, input));
        }}
        onApply={() => {
          const problem = apply(opened.target, opened.input);
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
 * 입력 칸·선택 칸의 Enter는 영역 저장 대신 적용, Esc는 취소로 받는다. 열리면 첫 조작 요소로 초점이 간다.
 * @param field 입력 칸 이름. 목차처럼 입력이 없는 폼은 null이다.
 * @param choices 새 출처에 연결할 각주. 출처 넣기 폼에서만 있다.
 * @param notice 폼을 열 때부터 보일 안내. `blocking`이면 적용할 수 없다.
 */
function InsertFormPanel({
  title,
  field,
  notice,
  choices,
  input,
  problem,
  onInput,
  onApply,
  onCancel,
}: {
  title: string;
  field: string | null;
  notice: { text: string; blocking: boolean } | null;
  choices: FootnoteChoice[] | null;
  input: InsertFormInput;
  problem: string | null;
  onInput: (input: InsertFormInput) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.querySelector<HTMLElement>("input, button:enabled")?.focus(), []);
  const toggle = (id: number, checked: boolean) => {
    const ids = checked ? [...input.ids, id].sort((a, b) => a - b) : input.ids.filter((other) => other !== id);
    onInput({ ...input, ids });
  };

  return (
    <div
      ref={panel}
      role="form"
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded border p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        // 입력 칸·선택 칸의 Enter가 바깥 편집 영역의 저장으로 넘어가지 않게 막는다.
        if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement) || event.nativeEvent.isComposing) {
          return;
        }
        event.preventDefault();
        if (!notice?.blocking) onApply();
      }}
    >
      <h3 id={titleId} className="font-medium">
        {title}
      </h3>
      {notice && <p className="text-sm text-amber-600">{notice.text}</p>}
      {choices && choices.length > 0 && (
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend>연결할 각주</legend>
          {choices.map((choice) => (
            <label key={choice.id} className="flex items-start gap-2 break-all">
              <input
                type="checkbox"
                checked={input.ids.includes(choice.id)}
                onChange={(event) => toggle(choice.id, event.target.checked)}
                className="mt-1"
              />
              <span>
                각주 {choice.id} <span className="text-zinc-500">{choice.text}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {field && (
        <label className="flex flex-col gap-1 text-sm">
          {field}
          <input
            value={input.text}
            onChange={(event) => onInput({ ...input, text: event.target.value })}
            className="rounded border px-2 py-1"
          />
        </label>
      )}
      {problem && <p className="text-sm text-red-600">{problem}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onApply} disabled={notice?.blocking} className={PRIMARY_BUTTON_CLASS}>
          적용
        </button>
        <button type="button" onClick={onCancel} className="rounded border px-4 py-2">
          취소
        </button>
      </div>
    </div>
  );
}

/**
 * 본문의 이미지·각주·각주 출처·목차 목록. 고칠 값이 있는 항목은 ‘수정’으로 폼을 열고, 자동 목차는 ‘제거’로 지운다.
 * 폼으로 고칠 수 없는 항목도 숨기지 않고 구체적인 이유와 원문에서 고치는 방법을 알린다.
 * @param tocHeading 목차를 채울 제목이 글에 있는지. 없으면 목차 옆에 제목을 추가하라고 안내한다.
 * @param onRemove 자동 목차를 지운다. 지우지 못하면 이유를 돌려준다.
 */
export function InsertEntryList({
  area,
  list,
  tocHeading,
  disabled,
  onEdit,
  onRemove,
}: {
  area: FormArea;
  list: InsertList;
  tocHeading: boolean;
  disabled: boolean;
  onEdit: (item: TextInsertItem, opener: HTMLElement) => void;
  onRemove: (item: TocInsertItem) => InsertFormProblem | null;
}) {
  const summary = useRef<HTMLElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const entries = list.ok ? insertEntries(list) : [];
  const remove = (item: TocInsertItem) => {
    const reason = onRemove(item);
    if (reason) {
      setProblem(tocRemoveMessage(reason, area));
      return;
    }
    setProblem(null);
    // 지운 목차의 제거 버튼이 사라지므로 초점을 목록 제목으로 옮긴다.
    summary.current?.focus();
  };
  return (
    <details className="text-sm">
      <summary ref={summary} className="cursor-pointer">
        삽입 항목{list.ok && ` ${entries.length}개`}
      </summary>
      {problem && <p className="mt-2 text-red-600">{problem}</p>}
      {!list.ok ? (
        <p className="mt-2 text-amber-600">
          원문을 읽을 수 없어 삽입 항목 목록을 보일 수 없어요. 원문의 오류를 고쳐 주세요.
        </p>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-zinc-500">이 글에는 이미지·각주·각주 출처·목차가 없어요.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {/* 적용으로 위치가 바뀌어도 고친 항목의 수정 버튼이 남아 초점을 돌려받도록 순서로 key를 둔다. */}
          {entries.map((entry, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{insertItemName(entry)}</span>
              {isTextInsert(entry) ? (
                <>
                  <span className="break-all text-zinc-500">
                    {formInitialValue({ kind: "edit", item: entry }).text || "(비어 있음)"}
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
              ) : isTocInsert(entry) ? (
                <>
                  <span className="text-zinc-500">글의 제목으로 자동으로 채워요.</span>
                  <button
                    type="button"
                    aria-label="목차 제거"
                    disabled={disabled}
                    onClick={() => remove(entry)}
                    className={TOGGLE_BUTTON_CLASS}
                  >
                    제거
                  </button>
                  {!tocHeading && <span className="text-amber-600">{TOC_NEEDS_HEADING}</span>}
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
