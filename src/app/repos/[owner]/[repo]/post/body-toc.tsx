"use client";

import { useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { TOC_NEEDS_HEADING, tocRemoveMessage, type BodyToc } from "@/lib/content/insert-form";
import { printJsxTag, type JsxElement, type TocHeading } from "@/lib/mdx-doc";

import { BodyItemsContext, ItemMark, LimitedBodyItem, SELECTED_ITEM_CLASS, useKeepKeys } from "./body-items";
import { TOGGLE_BUTTON_CLASS } from "./editor-mode-switch";

/**
 * 일반 편집 본문의 목차 한 곳. 사이트 컴포넌트를 실행하지 않는 편집용 표현이다.
 * 자동 목차는 ‘목차’와 지금 본문의 소제목을 깊이대로 들여 보인다. 사용자 정의 목차는 제목 목록으로 바꾸지 않고
 * 이름과 속성(`children`)을 그대로 두고 이유와 원문 편집 안내를 붙인다.
 * @param children 편집기가 이름과 속성으로 그린 요소.
 */
export function BodyTocItem({
  toc,
  element,
  inline,
  children,
}: {
  toc: BodyToc;
  element: JsxElement;
  inline: boolean;
  children: ReactNode;
}) {
  if ("headings" in toc) return <AutoToc headings={toc.headings} element={element} />;
  return (
    <LimitedBodyItem limit={toc.limit} inline={inline}>
      {children}
    </LimitedBodyItem>
  );
}

/** 클릭·탭하거나 Enter·Space로 고르면 바로 아래에 ‘제거’를 보인다. */
function AutoToc({ headings, element }: { headings: TocHeading[]; element: JsxElement }) {
  const items = useContext(BodyItemsContext);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const tag = useMemo(() => printJsxTag(element), [element]);
  const selected = items?.selected?.id === id;
  useKeepKeys(box);

  const toggle = () => {
    if (!items || !mark.current) return;
    setProblem(null);
    items.select(selected ? null : { id, nth: items.nthOf(mark.current) });
  };
  // 고른 뒤 본문이 바뀌었을 수 있어 고를 때의 차례를 쓰지 않고 자리 표시로 다시 센다.
  const remove = () => {
    if (!items || !mark.current) return;
    const item = items.actions.toc(element, items.nthOf(mark.current));
    if (!item) return setProblem(tocRemoveMessage("target-changed", "body"));
    const refocus = items.focusBefore(mark.current);
    const reason = items.actions.remove(item);
    if (reason) return setProblem(tocRemoveMessage(reason, "body"));
    items.select(null);
    refocus();
  };

  return (
    <div ref={box} className="flex flex-col items-start gap-1 text-sm">
      <ItemMark ref={mark} id={id} tag={tag} />
      <button
        type="button"
        data-image-action="select"
        aria-pressed={selected}
        aria-label={["목차", ...(headings.length > 0 ? headings.map(({ text }) => text) : [TOC_NEEDS_HEADING])].join(
          ", ",
        )}
        onClick={toggle}
        className={`flex max-w-full flex-col items-start gap-1 text-left ${SELECTED_ITEM_CLASS}`}
      >
        <span className="font-medium">목차</span>
        {headings.length === 0 ? (
          <span className="text-amber-600">{TOC_NEEDS_HEADING}</span>
        ) : (
          <span className="flex flex-col gap-1">
            {headings.map(({ depth, text }, index) => (
              <span key={index} className="break-all" style={{ marginInlineStart: `${depth - 2}rem` }}>
                {text}
              </span>
            ))}
          </span>
        )}
      </button>
      {selected && items && (
        <span role="group" aria-label="목차 관리" className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={items.actions.disabled} onClick={remove} className={TOGGLE_BUTTON_CLASS}>
            제거
          </button>
        </span>
      )}
      {problem && <span className="text-red-600">{problem}</span>}
    </div>
  );
}
