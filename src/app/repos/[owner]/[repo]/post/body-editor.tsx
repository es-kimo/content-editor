"use client";

import dynamic from "next/dynamic";
import { startTransition, useActionState, useRef, useState } from "react";

import { editedBody, sameBodyStructure, type Syntax } from "@/lib/mdx-doc";

import type { SaveState } from "./actions";

const MdxBodyEditor = dynamic(() => import("./mdx-body-editor"), {
  ssr: false,
  loading: () => <p className="text-zinc-500">불러오는 중…</p>,
});

export function BodyEditor({
  body,
  syntax,
  components,
  action,
}: {
  body: string;
  syntax: Syntax;
  components: string[];
  action: (state: SaveState, body: string) => Promise<SaveState>;
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const normalized = useRef<string | null>(null);
  const edited = useRef<string | null>(null);

  if (problem) {
    return (
      <>
        <p className="text-sm text-amber-600">{problem}</p>
        <pre className="overflow-x-auto rounded border p-3 text-sm whitespace-pre-wrap">{body}</pre>
      </>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = editedBody(body, normalized.current, edited.current);
        startTransition(() => dispatch(next));
      }}
    >
      <MdxBodyEditor
        markdown={body}
        components={components}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (!initialMarkdownNormalize) {
            edited.current = markdown;
            return;
          }
          normalized.current = markdown;
          // 렌더링 구조까지 바뀌는 글은 고치지 않은 곳까지 바꿔 저장하게 되므로 WYSIWYG로 고치지 않는다.
          if (!sameBodyStructure(body, markdown, syntax)) {
            setProblem("WYSIWYG로 열면 글 구조가 바뀌는 글이라 원문 모드에서만 고친다.");
          }
        }}
        onError={(message) => setProblem(`WYSIWYG로 열 수 없는 글이라 원문 모드에서만 고친다: ${message}`)}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded bg-black px-4 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {pending ? "저장 중…" : "본문 저장"}
        </button>
        {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
        {state.status === "unchanged" && <p className="text-sm text-zinc-500">바뀐 내용이 없어 커밋하지 않았다.</p>}
      </div>
    </form>
  );
}
