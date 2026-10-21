"use client";

import { createContext, useEffect, useState, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";

import {
  insertLimitMessage,
  type BodyElementAt,
  type ImageInsertItem,
  type ImageMoveProblem,
  type ImageMoves,
  type InsertFormProblem,
  type RemovableInsertItem,
  type TextInsertItem,
  type TocInsertItem,
} from "@/lib/content/insert-form";
import type { InsertLimit, JsxElement, MoveDirection } from "@/lib/mdx-doc";

import { focusImageAction, type FormOpener } from "./insert-form";

/**
 * 본문 안 항목(사진·각주·출처·목차)을 골라 하는 조작. 일반 편집 본문이 그 편집기에 적용한다.
 * 편집기는 요소의 원문 위치를 주지 않아 사진·목차를 본문에서 태그가 같은 요소 중 몇 번째인지(`nth`)로 가리킨다.
 */
export type BodyItemActions = {
  /** 그 요소가 교체·제거·이동할 수 있는 이미지면 그 항목. */
  image: (element: JsxElement, nth: number) => ImageInsertItem | null;
  /** 그 요소가 지울 수 있는 자동 목차면 그 항목. */
  toc: (element: JsxElement, nth: number) => TocInsertItem | null;
  moves: (item: ImageInsertItem) => ImageMoves;
  /** 저장 중이거나 폼이 열려 있으면 조작을 막는다. */
  disabled: boolean;
  /** 대체 텍스트나 각주·출처 내용을 고치는 폼을 연다. */
  edit: (item: TextInsertItem, opener: FormOpener) => void;
  /** 누른 버튼으로 파일 선택 창을 열고, 고르면 교체 폼을 연다. 이미지를 넣을 수 없는 글이면 null. */
  replace: ((item: ImageInsertItem, button: HTMLElement, opener: FormOpener) => void) | null;
  /** 지우지 못하면 이유를 돌려준다. */
  remove: (item: RemovableInsertItem) => InsertFormProblem | null;
  /** 옮기면 옮긴 이미지가 본문의 어느 요소가 됐는지 돌려준다. */
  move: (
    item: ImageInsertItem,
    direction: MoveDirection,
  ) => { ok: true; at: BodyElementAt | null } | { ok: false; reason: ImageMoveProblem };
};

/**
 * 고른 항목. `id`는 그 항목의 자리 표시 값이고 `nth`는 고를 때 태그가 같은 항목 중 몇 번째였는지다.
 * 본문이 바뀌면 `nth`가 달라질 수 있어 선택을 푼다(`select(null)`).
 */
type Selected = { id: string; nth: number };

/** 다시 그린 본문에서 찾을 항목. 모든 항목 중 몇 번째인지(`item`)거나 태그가 같은 항목 중 몇 번째인지다. */
type ItemAt = { item: number } | BodyElementAt;

export type BodyItems = {
  actions: BodyItemActions;
  selected: Selected | null;
  select: (selected: Selected | null) => void;
  /** 자리 표시의 항목이 본문에서 태그가 같은 항목 중 몇 번째인지. */
  nthOf: (mark: Element) => number;
  /** 자리 표시의 항목이 본문의 모든 항목 중 몇 번째인지. */
  indexOf: (mark: Element) => number;
  /** 편집기가 본문을 다시 그린 뒤 `at`의 항목을 고르고 `focus` 쪽 버튼에 초점을 둔다. */
  reselect: (at: ItemAt, focus: MoveDirection | "select") => void;
  /** 지금 자리 표시가 든 블록을 기억해 두고, 돌려준 함수를 부르면 다시 그린 본문에서 그 앞 블록으로 초점을 옮긴다. */
  focusBefore: (mark: Element) => () => void;
};

/**
 * 항목마다 맨 앞에 두는 자리 표시. 값으로 항목을 구별하고, 태그(`printJsxTag`)를 함께 둬 태그가 같은 항목끼리 센다.
 * 편집기는 `<p>`·`<br />` 같은 HTML 요소를 JSX 요소로 그리지 않아 모든 요소의 순서로는 원문과 어긋난다.
 */
const MARK = "data-body-item";
const TAG = "data-body-item-tag";

/** 항목의 자리 표시. 같은 부모 안에 항목을 고르는 버튼(`data-image-action="select"`)을 둬 다시 고를 때 초점을 받게 한다. */
export function ItemMark({ ref, id, tag }: { ref: RefObject<HTMLSpanElement | null>; id: string; tag: string }) {
  return <span ref={ref} {...{ [MARK]: id, [TAG]: tag }} hidden />;
}

/** 항목을 고르는 버튼이 눌린 동안의 테두리. */
export const SELECTED_ITEM_CLASS =
  "aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-black dark:aria-pressed:outline-white";

/**
 * 폼으로 고칠 수 없는 본문 항목. 편집기가 그린 이름과 속성(`children`)을 그대로 두고 이유와 원문 편집 안내를 붙인다.
 * @param inline 문장 안의 요소. 문단 안에 블록 요소를 둘 수 없어 span으로 그린다.
 */
export function LimitedBodyItem({
  limit,
  inline,
  children,
}: {
  limit: InsertLimit;
  inline: boolean;
  children: ReactNode;
}) {
  const Box = inline ? "span" : "div";
  return (
    <Box className={inline ? undefined : "flex flex-col gap-1"}>
      {children}
      <span className="text-sm text-amber-600">{insertLimitMessage(limit, "body")}</span>
    </Box>
  );
}

// 편집기는 처음 만든 플러그인으로 요소를 그리므로, 본문이 바뀔 때마다 달라지는 조작은 context로 넘긴다.
export const BodyItemsContext = createContext<BodyItems | null>(null);

/** 본문의 코드로 바꾼 내용은 편집기가 다음 틱에 다시 그리므로 그다음 프레임에 새 요소를 찾는다. */
const afterRedraw = (run: () => void) => requestAnimationFrame(run);

/**
 * 일반 편집 본문의 항목 선택과 초점 복귀. 한 번에 한 항목만 고른다. 폼을 닫거나 사진을 옮기면 다시 그린 본문에서
 * 그 항목을 다시 고르고, 사진·목차를 지우면 바로 앞 블록으로, 앞 블록이 없으면 본문 처음으로 초점을 옮긴다.
 * @param box 편집기를 감싼 요소. 도구 막대 다음의 첫 편집 영역이 본문이다.
 */
export function useBodyItems(box: RefObject<HTMLElement | null>, actions: BodyItemActions): BodyItems {
  const [selected, setSelected] = useState<Selected | null>(null);
  const marks = () => [...(box.current?.querySelectorAll(`[${MARK}]`) ?? [])];
  const sameTag = (tag: string | null) => marks().filter((mark) => mark.getAttribute(TAG) === tag);
  const editable = () => box.current?.querySelector<HTMLElement>('[contenteditable="true"]') ?? null;

  return {
    actions,
    selected,
    select: setSelected,
    nthOf: (mark) => sameTag(mark.getAttribute(TAG)).indexOf(mark),
    indexOf: (mark) => marks().indexOf(mark),
    reselect: (at, focus) =>
      afterRedraw(() => {
        const mark = "item" in at ? marks()[at.item] : sameTag(at.tag)[at.nth];
        const id = mark?.getAttribute(MARK);
        if (!mark?.parentElement || !id) return;
        const nth = sameTag(mark.getAttribute(TAG)).indexOf(mark);
        flushSync(() => setSelected({ id, nth }));
        focusImageAction(mark.parentElement, focus);
      }),
    focusBefore: (mark) => {
      const root = editable();
      let block: Element = mark;
      while (block.parentElement && block.parentElement !== root) block = block.parentElement;
      const at = root ? [...root.children].indexOf(block) : -1;
      return () =>
        afterRedraw(() => {
          if (!root) return;
          const before = at > 0 ? root.children[at - 1] : undefined;
          const item = before?.querySelector<HTMLElement>('[data-image-action="select"]');
          if (item) return item.focus();
          root.focus();
          const range = document.createRange();
          range.selectNodeContents(before ?? root);
          range.collapse(before === undefined);
          document.getSelection()?.removeAllRanges();
          document.getSelection()?.addRange(range);
        });
    },
  };
}

/**
 * 폼을 닫으면 그 항목으로 초점을 돌려줄 곳. 폼을 적용하면 본문을 다시 그렸을 수 있다. 값만 바꿔 항목 수는 그대로라
 * 같은 차례의 항목을 다시 고른다.
 */
export function reopener(items: BodyItems, mark: Element): FormOpener {
  const item = items.indexOf(mark);
  return { focus: () => items.reselect({ item }, "select") };
}

/** 편집기는 본문의 키 입력을 받아 Enter로 문단을 나누는 등 본문을 고치므로, 항목과 그 버튼의 키 입력은 올려 보내지 않는다. */
export function useKeepKeys(box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    element.addEventListener("keydown", stop);
    return () => element.removeEventListener("keydown", stop);
  }, [box]);
}
