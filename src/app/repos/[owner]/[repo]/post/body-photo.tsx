"use client";

import { useContext, useId, useMemo, useRef, useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/app/_lib/ui";
import type { BodyImagePhoto } from "@/lib/content/body-image";
import { imageActionMessage, imageMoveNotice, insertItemName, type ImageInsertItem } from "@/lib/content/insert-form";
import { printJsxTag, type JsxElement } from "@/lib/mdx-doc";

import { BodyItemsContext, ItemMark, reopener, SELECTED_ITEM_CLASS, useKeepKeys, type BodyItems } from "./body-items";
import { ImageActions } from "./insert-form";

/**
 * 일반 편집 본문의 이미지 한 곳을 사진으로 그린다. 사이트 컴포넌트를 실행하지 않는 편집용 표현이다.
 * 사진을 클릭·탭하거나 Enter·Space로 고르면 바로 아래에 ‘수정’·‘교체’·‘제거’·‘앞으로’·‘뒤로’를 보인다.
 * 주소가 바뀌면 처음부터 다시 불러오도록 부르는 쪽이 주소를 key로 둔다.
 * @param element 편집기가 넘긴 요소. 고르면 이 요소로 삽입 항목을 찾는다.
 * @param inline 문장 안의 이미지. 문단 안에 블록 요소를 둘 수 없어 span으로 그린다.
 */
export function BodyPhoto({ photo, element, inline }: { photo: BodyImagePhoto; element: JsxElement; inline: boolean }) {
  const photos = useContext(BodyItemsContext);
  const id = useId();
  const box = useRef<HTMLDivElement & HTMLSpanElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  // 다시 불러오면 img를 새로 만들어 브라우저가 다시 요청하게 한다.
  const [attempt, setAttempt] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const Box = inline ? "span" : "div";
  const alt = photo.alt === "" ? "대체 텍스트 없음" : `대체 텍스트: ${photo.alt}`;
  const tag = useMemo(() => printJsxTag(element), [element]);
  const selected = photos?.selected?.id === id ? photos.selected : null;
  const item = selected && photos ? photos.actions.image(element, selected.nth) : null;
  const moves = item && photos?.actions.moves(item);
  useKeepKeys(box);

  const toggle = () => {
    if (!photos || !mark.current) return;
    setProblem(null);
    photos.select(selected ? null : { id, nth: photos.nthOf(mark.current) });
  };
  /**
   * 누른 때 이 사진의 항목. 고른 뒤 본문이 바뀌었을 수 있어 고를 때의 차례를 쓰지 않고 자리 표시로 다시 센다.
   * 찾지 못하면 다른 이미지를 고치지 않고 선택을 푼다.
   */
  const current = (run: (photos: BodyItems, item: ImageInsertItem, mark: Element) => void) => {
    if (!photos || !mark.current) return;
    const found = photos.actions.image(element, photos.nthOf(mark.current));
    if (!found) return photos.select(null);
    run(photos, found, mark.current);
  };

  const actions = photos && selected && item && moves && (
    <ImageActions
      name={insertItemName(item)}
      moves={moves}
      notice={imageMoveNotice(moves, "body")}
      disabled={photos.actions.disabled}
      onEdit={() => current((photos, item, mark) => photos.actions.edit(item, reopener(photos, mark)))}
      onReplace={
        photos.actions.replace &&
        ((button) => current((photos, item, mark) => photos.actions.replace?.(item, button, reopener(photos, mark))))
      }
      onRemove={() =>
        current((photos, item, mark) => {
          const refocus = photos.focusBefore(mark);
          const reason = photos.actions.remove(item);
          if (reason) return setProblem(imageActionMessage(reason, "body"));
          photos.select(null);
          refocus();
        })
      }
      onMove={(direction) =>
        current((photos, item) => {
          const result = photos.actions.move(item, direction);
          if (!result.ok) return setProblem(imageActionMessage(result.reason, "body"));
          if (result.at) photos.reselect(result.at, direction);
        })
      }
    />
  );

  return (
    <Box ref={box} className="inline-flex max-w-full flex-col gap-1 align-top">
      <ItemMark ref={mark} id={id} tag={tag} />
      <button
        type="button"
        data-image-action="select"
        aria-pressed={selected !== null}
        aria-label={`사진, ${alt}`}
        onClick={toggle}
        className={`inline-flex max-w-full flex-col text-left ${SELECTED_ITEM_CLASS}`}
      >
        {state !== "failed" && (
          // eslint-disable-next-line @next/next/no-img-element -- 세션 쿠키로 읽는 라우트와 blob 주소라 이미지 최적화를 거칠 수 없다
          <img
            key={attempt}
            src={photo.src}
            alt={photo.alt}
            className={`h-auto max-w-full ${state === "loading" ? "hidden" : ""}`}
            onLoad={() => setState("loaded")}
            onError={() => setState("failed")}
          />
        )}
        {state === "loading" && <span className="text-sm text-zinc-500">사진을 불러오는 중…</span>}
        {state === "failed" && <span className="text-sm text-amber-600">사진을 불러오지 못했어요. {alt}</span>}
      </button>
      {state === "failed" && (
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={() => {
            setState("loading");
            setAttempt(attempt + 1);
          }}
        >
          다시 불러오기
        </button>
      )}
      {actions}
      {problem && <span className="text-sm text-red-600">{problem}</span>}
    </Box>
  );
}
