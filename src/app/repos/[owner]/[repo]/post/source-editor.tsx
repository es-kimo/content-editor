"use client";

import dynamic from "next/dynamic";
import { startTransition, useActionState, useRef } from "react";

import type { Syntax } from "@/lib/mdx-doc";

import type { SaveState } from "./actions";
import { SaveRow } from "./save-row";

const CodeMirrorSourceEditor = dynamic(() => import("./codemirror-source-editor"), {
  ssr: false,
  loading: () => <p className="text-zinc-500">불러오는 중…</p>,
});

/** 원문 모드. import·metadata를 포함한 파일 전체를 고쳐 저장한다. */
export function SourceEditor({
  source,
  syntax,
  action,
}: {
  source: string;
  syntax: Syntax;
  action: (state: SaveState, source: string) => Promise<SaveState>;
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  const edited = useRef(source);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = edited.current;
        startTransition(() => dispatch(next));
      }}
    >
      <p className="text-xs text-zinc-500">import·metadata를 포함한 파일 전체를 고친다.</p>
      <CodeMirrorSourceEditor
        source={source}
        syntax={syntax}
        onChange={(next) => {
          edited.current = next;
        }}
      />
      <SaveRow label="원문 저장" pending={pending} state={state} unchanged="바뀐 내용이 없어 커밋하지 않았다." />
    </form>
  );
}
