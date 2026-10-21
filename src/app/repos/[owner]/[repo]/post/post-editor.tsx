"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { DraftAttachment } from "@/lib/content/draft";
import type { EditorMode } from "@/lib/content/editor-modes";
import {
  formToSource,
  sourceToForm,
  type FormModeInput,
  type ModeSwitchProblem,
  type SourceModeInput,
  type SwitchPost,
} from "@/lib/content/mode-switch";
import { collectPostInput, type PostInput, type PostInputCollectors } from "@/lib/content/save-flow";
import type { MdxDoc } from "@/lib/mdx-doc";
import { readFormData } from "@/lib/metadata-form";

/**
 * 일반 편집에 이어받은 입력. `doc`은 연 원문에 새 이미지 import를 더한 것이다.
 * `restored`는 전환을 되돌려 다시 연 바꾸기 전 입력이다. 편집기가 읽지 못해도 다시 되돌리지 않고 이유를 보인다.
 */
export type CarriedForm = { key: string; input: FormModeInput<DraftAttachment>; doc: MdxDoc; restored?: true };

/** 원문 편집에 이어받은 입력. */
export type CarriedSource = { key: string; input: SourceModeInput<DraftAttachment> };

/** 모드를 바꿀 때 편집기가 낼 지금 입력. 일반 편집의 설정 폼 값은 저장할 때와 같이 `settings`에서 읽는다. */
export type ModeInputCollectors = {
  wysiwyg?: () => { body: string; images: DraftAttachment[]; doc: MdxDoc } | null;
  source?: () => SourceModeInput<DraftAttachment> | null;
};

type PostEditorValue = {
  mode: EditorMode;
  /**
   * 지금 입력을 이어받아 `next` 모드로 바꾼다. 이어받을 수 없으면 바꾸지 않고 두 모드의 입력도 그대로 둔다.
   * 이유는 `problem`에 남는다.
   */
  switchMode: (next: EditorMode) => void;
  /** 마지막 전환에 실패한 이유. 다음 전환에 성공하면 사라진다. */
  problem: ModeSwitchProblem | null;
  /** 다른 모드에서 이어받아 다시 연 입력. 없으면 편집기는 글을 연 그대로다. */
  carried: { wysiwyg: CarriedForm | null; source: CarriedSource | null };
  /**
   * 이어받은 본문을 일반 편집기가 열어 보니 구조가 바뀌었다. 편집기가 열어 봐야 알 수 있어 바꾼 뒤에 알린다.
   * 원문 편집으로 되돌리고 일반 편집을 바꾸기 전 입력으로 다시 연다.
   */
  rejectCarried: (key: string) => void;
  /** 영역의 입력을 등록하고, 등록을 거두는 함수를 돌려준다. */
  register: <K extends keyof PostInputCollectors>(kind: K, collect: NonNullable<PostInputCollectors[K]>) => () => void;
  registerMode: <K extends keyof ModeInputCollectors>(
    kind: K,
    collect: NonNullable<ModeInputCollectors[K]>,
  ) => () => void;
  /** 지금 모드로 저장할 글 전체 입력. `collectPostInput`. */
  collect: () => PostInput | null;
};

const PostEditorContext = createContext<PostEditorValue | null>(null);

/** 전환의 결과. 저장해 원문이 바뀌면 모두 버린다. */
type Switched = PostEditorValue["carried"] & {
  /** 이어받은 일반 편집 입력을 열지 못하면 되돌릴, 바꾸기 전 일반 편집 입력. 글을 연 그대로였으면 null. */
  previous: Pick<CarriedForm, "input" | "doc"> | null;
  problem: ModeSwitchProblem | null;
};

const NOT_SWITCHED: Switched = { wysiwyg: null, source: null, previous: null, problem: null };

/**
 * 글 화면의 지금 편집 모드와, 글 하나를 한 번에 저장하려고 모드의 편집 영역들에서 입력을 모으는 곳.
 * 모드를 바꾸면 지금 모드의 입력을 다른 모드로 바꿔 그 편집기를 다시 연다. 숨은 편집기에 남은 이전 입력은 쓰지 않는다.
 * @param post 글을 연 시점의 원문. 저장해 원문이 바뀌면 이어받은 입력을 버리고 저장한 글로 다시 연다.
 */
export function PostEditorProvider({
  initial,
  post,
  children,
}: {
  initial: EditorMode;
  post: SwitchPost;
  children: ReactNode;
}) {
  const [mode, setMode] = useState(initial);
  const [switchedAt, setSwitched] = useState({ source: post.source, switched: NOT_SWITCHED });
  const switched = switchedAt.source === post.source ? switchedAt.switched : NOT_SWITCHED;
  const opened = useRef(0);
  const collectors = useRef<PostInputCollectors>({});
  const modeInputs = useRef<ModeInputCollectors>({});

  const value = useMemo<PostEditorValue>(() => {
    const nextKey = () => `carried-${(opened.current += 1)}`;
    const update = (next: Partial<Switched>) =>
      setSwitched({ source: post.source, switched: { ...switched, problem: null, ...next } });

    /** 설정 폼에 확인할 칸이 있으면 저장할 때처럼 폼이 그 칸을 알리고, 전환은 막는다. */
    const toSource = (): ModeSwitchProblem | null => {
      const settings = collectors.current.settings?.();
      if (settings === null) return { ok: false, reason: "invalid", errors: [] };
      const editor = modeInputs.current.wysiwyg?.();
      if (!editor) return null;
      const { doc, ...form } = { values: settings ? readFormData(post.collection, settings.data) : {}, ...editor };
      const result = formToSource(post, form);
      if (!result.ok) return result;
      update({ source: { key: nextKey(), input: result.input }, previous: { input: form, doc } });
      return null;
    };

    const toForm = (): ModeSwitchProblem | null => {
      const input = modeInputs.current.source?.();
      if (!input) return null;
      const result = sourceToForm(post, input);
      if (!result.ok) return result;
      update({ wysiwyg: { key: nextKey(), input: result.input, doc: result.doc } });
      return null;
    };

    return {
      mode,
      problem: switched.problem,
      carried: { wysiwyg: switched.wysiwyg, source: switched.source },
      switchMode(next) {
        if (next === mode) return;
        const problem = next === "source" ? toSource() : toForm();
        if (problem) return update({ problem });
        setMode(next);
      },
      rejectCarried(key) {
        if (switched.wysiwyg?.key !== key) return;
        const { previous } = switched;
        update({
          wysiwyg: previous && { ...previous, key: nextKey(), restored: true },
          problem: { ok: false, reason: "structure" },
        });
        setMode("source");
      },
      register: (kind, collect) => {
        collectors.current[kind] = collect;
        return () => {
          if (collectors.current[kind] === collect) delete collectors.current[kind];
        };
      },
      registerMode: (kind, collect) => {
        modeInputs.current[kind] = collect;
        return () => {
          if (modeInputs.current[kind] === collect) delete modeInputs.current[kind];
        };
      },
      collect: () => collectPostInput(collectors.current, mode),
    };
  }, [mode, switched, post]);
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

/** 편집기가 모드를 바꿀 때 낼 지금 입력을 등록한다. */
export function useModeInput<K extends keyof ModeInputCollectors>(
  kind: K,
  collect: NonNullable<ModeInputCollectors[K]>,
) {
  const { registerMode } = usePostEditor();
  useEffect(() => registerMode(kind, collect), [registerMode, kind, collect]);
}
