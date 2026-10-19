"use client";

import dynamic from "next/dynamic";
import { startTransition, useActionState, useRef, useState } from "react";

import { editedBody, sameBodyStructure, type Syntax } from "@/lib/mdx-doc";

import type { SaveState } from "./actions";
import { SaveRow } from "./save-row";

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
      <SaveRow label="본문 저장" pending={pending} state={state} unchanged="바뀐 내용이 없어 커밋하지 않았다." />
    </form>
  );
}
