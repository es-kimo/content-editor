"use client";

import dynamic from "next/dynamic";
import { startTransition, useActionState, useRef } from "react";

import type { Syntax } from "@/lib/mdx-doc";

import type { SaveState } from "./actions";

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
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded bg-black px-4 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {pending ? "저장 중…" : "원문 저장"}
        </button>
        {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
        {state.status === "unchanged" && <p className="text-sm text-zinc-500">바뀐 내용이 없어 커밋하지 않았다.</p>}
      </div>
    </form>
  );
}
