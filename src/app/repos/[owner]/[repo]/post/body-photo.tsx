"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

import { SECONDARY_BUTTON_CLASS } from "@/app/_lib/ui";
import type { BodyImagePhoto } from "@/lib/content/body-image";
import {
  imageActionMessage,
  imageMoveNotice,
  insertItemName,
  type BodyElementAt,
  type ImageInsertItem,
  type ImageMoveProblem,
  type ImageMoves,
  type InsertFormProblem,
} from "@/lib/content/insert-form";
import { printJsxTag, type JsxElement, type MoveDirection } from "@/lib/mdx-doc";

import { focusImageAction, ImageActions, type FormOpener } from "./insert-form";

/**
 * 본문 사진을 골라 하는 조작. 일반 편집 본문이 그 편집기에 적용한다.
 * 편집기는 요소의 원문 위치를 주지 않아 사진을 본문에서 태그가 같은 요소 중 몇 번째인지(`nth`)로 가리킨다.
 */
export type BodyPhotoActions = {
  /** 그 요소가 교체·제거·이동할 수 있는 이미지면 그 항목. */
  image: (element: JsxElement, nth: number) => ImageInsertItem | null;
  moves: (item: ImageInsertItem) => ImageMoves;
  /** 저장 중이거나 폼이 열려 있으면 조작을 막는다. */
  disabled: boolean;
  edit: (item: ImageInsertItem, opener: FormOpener) => void;
  /** 누른 버튼으로 파일 선택 창을 열고, 고르면 교체 폼을 연다. 이미지를 넣을 수 없는 글이면 null. */
  replace: ((item: ImageInsertItem, button: HTMLElement, opener: FormOpener) => void) | null;
  /** 지우지 못하면 이유를 돌려준다. */
  remove: (item: ImageInsertItem) => InsertFormProblem | null;
  /** 옮기면 옮긴 이미지가 본문의 어느 요소가 됐는지 돌려준다. */
  move: (
    item: ImageInsertItem,
    direction: MoveDirection,
  ) => { ok: true; at: BodyElementAt | null } | { ok: false; reason: ImageMoveProblem };
};

/**
 * 고른 사진. `id`는 그 사진의 자리 표시 값이고 `nth`는 고를 때 태그가 같은 사진 중 몇 번째였는지다.
 * 본문이 바뀌면 `nth`가 달라질 수 있어 선택을 푼다(`select(null)`).
 */
type Selected = { id: string; nth: number };

/** 다시 그린 본문에서 찾을 사진. 모든 사진 중 몇 번째인지(`photo`)거나 태그가 같은 사진 중 몇 번째인지다. */
type PhotoAt = { photo: number } | BodyElementAt;

type BodyPhotos = {
  actions: BodyPhotoActions;
  selected: Selected | null;
  select: (selected: Selected | null) => void;
  /** 자리 표시의 사진이 본문에서 태그가 같은 사진 중 몇 번째인지. */
  nthOf: (mark: Element) => number;
  /** 자리 표시의 사진이 본문의 모든 사진 중 몇 번째인지. */
  photoOf: (mark: Element) => number;
  /** 편집기가 본문을 다시 그린 뒤 `at`의 사진을 고르고 `focus` 쪽 버튼에 초점을 둔다. */
  reselect: (at: PhotoAt, focus: MoveDirection | "select") => void;
  /** 지금 자리 표시가 든 블록을 기억해 두고, 돌려준 함수를 부르면 다시 그린 본문에서 그 앞 블록으로 초점을 옮긴다. */
  focusBefore: (mark: Element) => () => void;
};

/**
 * 사진마다 맨 앞에 두는 자리 표시. 값으로 사진을 구별하고, 태그(`printJsxTag`)를 함께 둬 태그가 같은 사진끼리 센다.
 * 편집기는 `<p>`·`<br />` 같은 HTML 요소를 JSX 요소로 그리지 않아 모든 요소의 순서로는 원문과 어긋난다.
 */
const MARK = "data-body-photo";
const TAG = "data-body-photo-tag";

// 편집기는 처음 만든 플러그인으로 요소를 그리므로, 본문이 바뀔 때마다 달라지는 조작은 context로 넘긴다.
export const BodyPhotosContext = createContext<BodyPhotos | null>(null);

/** 본문의 코드로 바꾼 내용은 편집기가 다음 틱에 다시 그리므로 그다음 프레임에 새 요소를 찾는다. */
const afterRedraw = (run: () => void) => requestAnimationFrame(run);

/**
 * 일반 편집 본문의 사진 선택과 초점 복귀. 폼을 닫거나 사진을 옮기면 다시 그린 본문에서 그 사진을 다시 고르고,
 * 지우면 바로 앞 블록으로, 앞 블록이 없으면 본문 처음으로 초점을 옮긴다.
 * @param box 편집기를 감싼 요소. 도구 막대 다음의 첫 편집 영역이 본문이다.
 */
export function useBodyPhotos(box: RefObject<HTMLElement | null>, actions: BodyPhotoActions): BodyPhotos {
  const [selected, setSelected] = useState<Selected | null>(null);
  const marks = () => [...(box.current?.querySelectorAll(`[${MARK}]`) ?? [])];
  const sameTag = (tag: string | null) => marks().filter((mark) => mark.getAttribute(TAG) === tag);
  const editable = () => box.current?.querySelector<HTMLElement>('[contenteditable="true"]') ?? null;

  return {
    actions,
    selected,
    select: setSelected,
    nthOf: (mark) => sameTag(mark.getAttribute(TAG)).indexOf(mark),
    photoOf: (mark) => marks().indexOf(mark),
    reselect: (at, focus) =>
      afterRedraw(() => {
        const mark = "photo" in at ? marks()[at.photo] : sameTag(at.tag)[at.nth];
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
          const photo = before?.querySelector<HTMLElement>('[data-image-action="select"]');
          if (photo) return photo.focus();
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
 * 일반 편집 본문의 이미지 한 곳을 사진으로 그린다. 사이트 컴포넌트를 실행하지 않는 편집용 표현이다.
 * 사진을 클릭·탭하거나 Enter·Space로 고르면 바로 아래에 ‘수정’·‘교체’·‘제거’·‘앞으로’·‘뒤로’를 보인다.
 * 주소가 바뀌면 처음부터 다시 불러오도록 부르는 쪽이 주소를 key로 둔다.
 * @param element 편집기가 넘긴 요소. 고르면 이 요소로 삽입 항목을 찾는다.
 * @param inline 문장 안의 이미지. 문단 안에 블록 요소를 둘 수 없어 span으로 그린다.
 */
export function BodyPhoto({ photo, element, inline }: { photo: BodyImagePhoto; element: JsxElement; inline: boolean }) {
  const photos = useContext(BodyPhotosContext);
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

  // 편집기는 본문의 키 입력을 받아 Enter로 문단을 나누는 등 본문을 고치므로, 사진과 그 버튼의 키 입력은 올려 보내지 않는다.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    element.addEventListener("keydown", stop);
    return () => element.removeEventListener("keydown", stop);
  }, []);

  const toggle = () => {
    if (!photos || !mark.current) return;
    setProblem(null);
    photos.select(selected ? null : { id, nth: photos.nthOf(mark.current) });
  };
  /**
   * 누른 때 이 사진의 항목. 고른 뒤 본문이 바뀌었을 수 있어 고를 때의 차례를 쓰지 않고 자리 표시로 다시 센다.
   * 찾지 못하면 다른 이미지를 고치지 않고 선택을 푼다.
   */
  const current = (run: (photos: BodyPhotos, item: ImageInsertItem, mark: Element) => void) => {
    if (!photos || !mark.current) return;
    const found = photos.actions.image(element, photos.nthOf(mark.current));
    if (!found) return photos.select(null);
    run(photos, found, mark.current);
  };
  // 폼을 닫으면 본문을 다시 그렸을 수 있다. 대체 텍스트나 파일을 바꿔도 사진 수는 그대로라 같은 차례의 사진에 초점을 둔다.
  const reopener = (photos: BodyPhotos, mark: Element): FormOpener => {
    const photo = photos.photoOf(mark);
    return { focus: () => photos.reselect({ photo }, "select") };
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
      <span ref={mark} {...{ [MARK]: id, [TAG]: tag }} hidden />
      <button
        type="button"
        data-image-action="select"
        aria-pressed={selected !== null}
        aria-label={`사진, ${alt}`}
        onClick={toggle}
        className="inline-flex max-w-full flex-col text-left aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-black dark:aria-pressed:outline-white"
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
