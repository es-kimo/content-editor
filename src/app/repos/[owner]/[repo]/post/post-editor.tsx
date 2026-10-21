"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { EditorMode } from "@/lib/content/read";
import { collectPostInput, type PostInput, type PostInputCollectors } from "@/lib/content/save-flow";

type PostEditorValue = {
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;
  /** 영역의 입력을 등록하고, 등록을 거두는 함수를 돌려준다. */
  register: <K extends keyof PostInputCollectors>(kind: K, collect: NonNullable<PostInputCollectors[K]>) => () => void;
  /** 지금 모드로 저장할 글 전체 입력. `collectPostInput`. */
  collect: () => PostInput | null;
};

const PostEditorContext = createContext<PostEditorValue | null>(null);

/** 글 화면의 지금 편집 모드와, 글 하나를 한 번에 저장하려고 모드의 편집 영역들에서 입력을 모으는 곳. */
export function PostEditorProvider({ initial, children }: { initial: EditorMode; children: ReactNode }) {
  const [mode, setMode] = useState(initial);
  const collectors = useRef<PostInputCollectors>({});
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
export function usePostInput<K extends keyof PostInputCollectors>(
  kind: K,
  collect: NonNullable<PostInputCollectors[K]>,
) {
  const { register } = usePostEditor();
  useEffect(() => register(kind, collect), [register, kind, collect]);
}
