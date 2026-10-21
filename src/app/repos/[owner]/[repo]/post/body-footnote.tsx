"use client";

import { useContext, useId, useMemo, useRef, type ReactNode } from "react";

import {
  insertItemName,
  insertLimitMessage,
  type BodyFootnote,
  type FootnoteInsertItem,
} from "@/lib/content/insert-form";
import { printJsxTag, type JsxElement } from "@/lib/mdx-doc";

import { BodyItemsContext, ItemMark, reopener, useKeepKeys } from "./body-items";
import { TOGGLE_BUTTON_CLASS } from "./editor-mode-switch";

/**
 * 일반 편집 본문의 각주·출처 한 곳. 사이트 컴포넌트를 실행하지 않는 편집용 표현이다.
 * 각주는 문장 안 그 자리에 번호를 위첨자로, 출처는 ‘출처’·연결한 각주 번호·내용을 한 블록으로 보인다.
 * 폼으로 고칠 수 없으면 이름과 속성(`children`)을 그대로 두고 이유와 원문 편집 안내를 붙인다.
 * @param inline 문장 안의 요소. 문단 안에 블록 요소를 둘 수 없어 span으로 그린다.
 * @param children 편집기가 이름과 속성으로 그린 요소.
 */
export function BodyFootnoteItem({
  footnote,
  element,
  inline,
  children,
}: {
  footnote: BodyFootnote;
  element: JsxElement;
  inline: boolean;
  children: ReactNode;
}) {
  const Box = inline ? "span" : "div";
  if ("item" in footnote) return <Footnote {...footnote} element={element} inline={inline} />;
  return (
    <Box className={inline ? undefined : "flex flex-col gap-1"}>
      {children}
      <span className="text-sm text-amber-600">{insertLimitMessage(footnote.limit, "body")}</span>
    </Box>
  );
}

/** 클릭·탭하거나 Enter·Space로 고르면 바로 아래에 내용과 ‘수정’을 보인다. ‘수정’은 기존 수정 폼을 연다. */
function Footnote({
  item,
  numbers,
  element,
  inline,
}: {
  item: FootnoteInsertItem;
  numbers: string[];
  element: JsxElement;
  inline: boolean;
}) {
  const items = useContext(BodyItemsContext);
  const id = useId();
  const box = useRef<HTMLDivElement & HTMLSpanElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const tag = useMemo(() => printJsxTag(element), [element]);
  const selected = items?.selected?.id === id;
  const name = insertItemName(item);
  const Box = inline ? "span" : "div";
  useKeepKeys(box);

  const toggle = () => {
    if (!items || !mark.current) return;
    items.select(selected ? null : { id, nth: items.nthOf(mark.current) });
  };
  const select = {
    type: "button",
    "data-image-action": "select",
    "aria-pressed": selected,
    onClick: toggle,
  } as const;
  const pressed =
    "aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-black dark:aria-pressed:outline-white";

  // 위첨자(`sup`)는 줄 높이가 0이라 flex 항목으로 두면 높이가 없어 누를 수 없으므로 버튼 안 글자 흐름에 둔다.
  // 문장 안 각주는 사진처럼 세로 inline-flex로 묶어 내용과 ‘수정’을 번호 아래에 두고, 번호는 문장 기준선에 맞춘다.
  return (
    <Box
      ref={box}
      className={
        inline
          ? "inline-flex max-w-full flex-col items-start gap-1 align-baseline"
          : "flex flex-col items-start gap-1 text-sm"
      }
    >
      <ItemMark ref={mark} id={id} tag={tag} />
      {item.kind === "footnote" ? (
        <button {...select} aria-label={name} className={`px-0.5 ${pressed}`}>
          <sup>{numbers[0]}</sup>
        </button>
      ) : (
        <button {...select} aria-label={`${name}, ${item.text}`} className={`text-left break-all ${pressed}`}>
          <span className="font-medium">출처</span> <sup>{numbers.join(", ")}</sup> {item.text}
        </button>
      )}
      {selected && items && (
        <span role="group" aria-label={`${name} 관리`} className="inline-flex flex-wrap items-center gap-2 text-sm">
          {item.kind === "footnote" && <span className="break-all">{item.text}</span>}
          <button
            type="button"
            disabled={items.actions.disabled}
            onClick={() => mark.current && items.actions.edit(item, reopener(items, mark.current))}
            className={TOGGLE_BUTTON_CLASS}
          >
            수정
          </button>
        </span>
      )}
    </Box>
  );
}
