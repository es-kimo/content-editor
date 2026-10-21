"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { PRIMARY_BUTTON_CLASS } from "@/app/_lib/ui";
import { useFormFlow } from "@/app/_lib/unsaved";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 폼 적용만 가져온다.
import {
  formDirty,
  formInitialValue,
  imageActionMessage,
  imageMoveNotice,
  insertEntries,
  insertFormDescription,
  insertFormLabels,
  insertFormMessage,
  insertFormNotice,
  insertItemName,
  insertLimitMessage,
  isImageInsert,
  isTextInsert,
  isTocInsert,
  TOC_NEEDS_HEADING,
  tocRemoveMessage,
  type FootnoteChoice,
  type ImageInsertItem,
  type ImageMoveProblem,
  type ImageMoves,
  type InsertFormInput,
  type InsertFormProblem,
  type InsertFormTarget,
  type RemovableInsertItem,
  type TextInsertItem,
} from "@/lib/content/insert-form";
import type { FormArea } from "@/lib/content/save-flow";
import type { InsertList, MoveDirection } from "@/lib/mdx-doc";

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
        description={insertFormDescription(opened.target)}
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
 * @param description 폼이 무엇을 바꾸는지 보일 설명.
 * @param notice 폼을 열 때부터 보일 안내. `blocking`이면 적용할 수 없다.
 */
function InsertFormPanel({
  title,
  field,
  description,
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
  description: string | null;
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
      {description && <p className="text-sm break-all text-zinc-500">{description}</p>}
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

/** 삽입 항목 목록에서 고른 이미지를 다루는 방법. 편집 영역이 그 영역의 편집기에 적용한다. */
export type ImageEntryActions = {
  /** 고른 이미지를 앞뒤로 옮길 수 있는지. */
  moves: (item: ImageInsertItem) => ImageMoves;
  /** 새 파일을 골라 교체 폼을 연다. 이미지를 넣을 수 없는 글이면 null. */
  replace: ((item: ImageInsertItem, opener: HTMLElement) => void) | null;
  /** 옮긴다. 옮기면 옮긴 이미지가 목록에서 몇 번째인지, 옮기지 못하면 이유를 돌려준다. */
  move: (
    item: ImageInsertItem,
    direction: MoveDirection,
  ) => { ok: true; index: number } | { ok: false; reason: ImageMoveProblem };
};

const MOVE_LABELS: { [direction in MoveDirection]: string } = { before: "앞으로", after: "뒤로" };

/**
 * 본문의 이미지·각주·각주 출처·목차 목록. 고칠 값이 있는 항목은 ‘수정’으로 폼을 열고, 자동 목차는 ‘제거’로 지운다.
 * 이미지는 ‘선택’하면 ‘교체’·‘제거’·‘앞으로’·‘뒤로’를 보인다. 옮길 수 없는 쪽의 버튼은 막고, 어느 쪽으로도 못 옮기는 이유는 함께 보인다.
 * 폼으로 고칠 수 없는 항목도 숨기지 않고 구체적인 이유와 원문에서 고치는 방법을 알린다.
 * @param tocHeading 목차를 채울 제목이 글에 있는지. 없으면 목차 옆에 제목을 추가하라고 안내한다.
 * @param onRemove 자동 목차나 이미지 한 곳을 지운다. 지우지 못하면 이유를 돌려준다.
 */
export function InsertEntryList({
  area,
  list,
  tocHeading,
  disabled,
  onEdit,
  onRemove,
  images,
}: {
  area: FormArea;
  list: InsertList;
  tocHeading: boolean;
  disabled: boolean;
  onEdit: (item: TextInsertItem, opener: HTMLElement) => void;
  onRemove: (item: RemovableInsertItem) => InsertFormProblem | null;
  images: ImageEntryActions;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const entries = list.ok ? insertEntries(list) : [];
  const [selected, setSelected] = useState<number | null>(null);
  const picked = selected === null ? undefined : entries[selected];
  const image = picked && isImageInsert(picked) ? picked : null;
  // 이동 가능 여부는 원문을 여러 번 읽으므로 모든 이미지가 아니라 고른 이미지 하나만 따진다.
  const moves = image && images.moves(image);
  // 옮기면 목록을 다시 그려 누른 버튼이 사라질 수 있어, 다시 그린 뒤 같은 쪽 버튼에 초점을 돌려준다.
  // 그쪽으로 더 못 옮기면 반대쪽, 그것도 막히면 ‘선택’ 버튼으로 간다.
  const refocus = useRef<MoveDirection | null>(null);
  useEffect(() => {
    const direction = refocus.current;
    if (!direction) return;
    refocus.current = null;
    const order = [direction, direction === "before" ? "after" : "before", "select"];
    const find = (name: string) =>
      details.current?.querySelector<HTMLButtonElement>(`[data-image-action="${name}"]:enabled`);
    order.map(find).find(Boolean)?.focus();
  });

  const remove = (item: RemovableInsertItem) => {
    const reason = onRemove(item);
    if (reason) {
      setProblem(item.kind === "toc" ? tocRemoveMessage(reason, area) : imageActionMessage(reason, area));
      return;
    }
    setProblem(null);
    setSelected(null);
    // 지운 항목의 제거 버튼이 사라지므로 초점을 목록 제목으로 옮긴다.
    summary.current?.focus();
  };
  const move = (item: ImageInsertItem, direction: MoveDirection) => {
    const result = images.move(item, direction);
    if (!result.ok) {
      setProblem(imageActionMessage(result.reason, area));
      return;
    }
    setProblem(null);
    setSelected(result.index);
    refocus.current = direction;
  };
  return (
    <details ref={details} className="text-sm">
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
                  {isImageInsert(entry) && (
                    <button
                      type="button"
                      aria-label={`${insertItemName(entry)} 선택`}
                      aria-pressed={entry === image}
                      data-image-action={entry === image ? "select" : undefined}
                      disabled={disabled}
                      onClick={() => {
                        setProblem(null);
                        setSelected(entry === image ? null : index);
                      }}
                      className={TOGGLE_BUTTON_CLASS}
                    >
                      선택
                    </button>
                  )}
                  {entry === image && moves && (
                    <ImageActions
                      name={insertItemName(entry)}
                      moves={moves}
                      notice={imageMoveNotice(moves, area)}
                      disabled={disabled}
                      onReplace={images.replace && ((opener) => images.replace?.(entry, opener))}
                      onRemove={() => remove(entry)}
                      onMove={(direction) => move(entry, direction)}
                    />
                  )}
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

/**
 * 고른 이미지 한 곳의 ‘교체’·‘제거’·‘앞으로’·‘뒤로’. 옮길 수 없는 쪽의 버튼은 막는다.
 * @param notice 어느 쪽으로도 옮길 수 없는 이유와 원문으로 가는 방법.
 * @param onReplace 이미지를 넣을 수 없는 글이면 null이고 ‘교체’를 두지 않는다.
 */
function ImageActions({
  name,
  moves,
  notice,
  disabled,
  onReplace,
  onRemove,
  onMove,
}: {
  name: string;
  moves: ImageMoves;
  notice: string | null;
  disabled: boolean;
  onReplace: ((opener: HTMLElement) => void) | null;
  onRemove: () => void;
  onMove: (direction: MoveDirection) => void;
}) {
  return (
    <div role="group" aria-label={`${name} 관리`} className="flex w-full flex-wrap items-center gap-2 pl-4">
      {onReplace && (
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => onReplace(event.currentTarget)}
          className={TOGGLE_BUTTON_CLASS}
        >
          교체
        </button>
      )}
      <button type="button" disabled={disabled} onClick={onRemove} className={TOGGLE_BUTTON_CLASS}>
        제거
      </button>
      {(["before", "after"] as const).map((direction) => (
        <button
          key={direction}
          type="button"
          data-image-action={direction}
          disabled={disabled || moves[direction] !== null}
          onClick={() => onMove(direction)}
          className={TOGGLE_BUTTON_CLASS}
        >
          {MOVE_LABELS[direction]}
        </button>
      ))}
      {notice && <span className="text-amber-600">{notice}</span>}
    </div>
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
