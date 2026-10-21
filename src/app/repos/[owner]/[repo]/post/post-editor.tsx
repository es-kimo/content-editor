"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { EditorMode } from "@/lib/content/read";

/**
 * 저장할 때 편집 영역이 내는 입력. `text`는 본문이나 원문, `data`는 설정 폼 값과 첨부 이미지다.
 * `unchanged`는 서버가 변경 없음으로 답했을 때 낸 입력을 그 영역의 저장 기준으로 삼게 한다.
 */
export type PostInput = { text: string; data: FormData; unchanged: () => void };

/** 저장할 때 입력을 내는 영역. 낼 수 없으면 null을 돌려주고 이유는 그 영역 옆에 보인다. */
type Collectors = {
  /** 제목을 포함한 글 설정 폼. 일반 편집에서만 함께 저장한다. */
  settings?: () => Omit<PostInput, "text"> | null;
  wysiwyg?: () => PostInput | null;
  source?: () => PostInput | null;
};

type PostEditorValue = {
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;
  /** 영역의 입력을 등록하고, 등록을 거두는 함수를 돌려준다. */
  register: <K extends keyof Collectors>(kind: K, collect: NonNullable<Collectors[K]>) => () => void;
  /** 지금 모드로 저장할 글 전체 입력. `collectPostInput`. */
  collect: () => PostInput | null;
};

const PostEditorContext = createContext<PostEditorValue | null>(null);

/** 글 화면의 지금 편집 모드와, 글 하나를 한 번에 저장하려고 모드의 편집 영역들에서 입력을 모으는 곳. */
export function PostEditorProvider({ initial, children }: { initial: EditorMode; children: ReactNode }) {
  const [mode, setMode] = useState(initial);
  const collectors = useRef<Collectors>({});
  const value = useMemo<PostEditorValue>(
    () => ({
      mode,
      setMode,
      register: (kind, collect) => {
        collectors.current[kind] = collect;
        return () => {
          if (collectors.current[kind] === collect) delete collectors.current[kind];
        };
      },
      collect: () => collectPostInput(collectors.current, mode),
    }),
    [mode],
  );
  return <PostEditorContext value={value}>{children}</PostEditorContext>;
}

export function usePostEditor(): PostEditorValue {
  const value = useContext(PostEditorContext);
  if (!value) throw new Error("PostEditorProvider 안에서만 쓴다.");
  return value;
}

/** 편집 영역이 저장할 때 낼 입력을 등록한다. 저장할 때 마지막으로 그린 상태의 입력을 읽는다. */
export function usePostInput<K extends keyof Collectors>(kind: K, collect: NonNullable<Collectors[K]>) {
  const { register } = usePostEditor();
  useEffect(() => register(kind, collect), [register, kind, collect]);
}

/**
 * 지금 모드로 저장할 글 전체 입력을 모은다. 일반 편집은 설정 폼과 본문·첨부를, 원문 편집은 원문과 첨부를 한 요청에 담는다.
 * 어느 영역이든 낼 수 없으면 null.
 */
function collectPostInput(collectors: Collectors, mode: EditorMode): PostInput | null {
  if (mode === "source") return collectors.source?.() ?? null;
  // 설정 폼을 먼저 검사해, 빠진 필수 값이 있으면 본문보다 먼저 그 칸을 알린다.
  const settings = collectors.settings?.();
  if (settings === null) return null;
  const editor = collectors.wysiwyg?.() ?? null;
  if (!editor || !settings) return editor;
  const data = new FormData();
  for (const [name, value] of [...settings.data, ...editor.data]) data.append(name, value);
  return {
    text: editor.text,
    data,
    unchanged: () => {
      settings.unchanged();
      editor.unchanged();
    },
  };
}
