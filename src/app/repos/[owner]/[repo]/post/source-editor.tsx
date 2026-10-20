"use client";

import dynamic from "next/dynamic";
import { startTransition, useActionState, useRef, useState } from "react";

import { useReportUnsaved } from "@/app/_lib/unsaved";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 미리보기 메시지만 가져온다.
import { previewMessage } from "@/lib/content/preview";
import { sourceChanged } from "@/lib/content/unsaved";
import type { Syntax } from "@/lib/mdx-doc";

import type { SaveState } from "./actions";
import { BodyPreview } from "./body-preview";
import { SaveRow } from "./save-row";

const CodeMirrorSourceEditor = dynamic(() => import("./codemirror-source-editor"), {
  ssr: false,
  loading: () => <p className="text-zinc-500">불러오는 중…</p>,
});

/** 원문 모드. import·metadata를 포함한 파일 전체를 고쳐 저장한다. */
export function SourceEditor({
  source,
  syntax,
  components,
  preview,
  action,
}: {
  source: string;
  syntax: Syntax;
  /** 삽입 버튼으로 보일 컴포넌트. `sourceComponents`의 결과. */
  components: string[];
  /** config `preview`. 있으면 사이트 미리보기를 띄운다. */
  preview?: string;
  action: (state: SaveState, source: string) => Promise<SaveState>;
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  const edited = useRef(source);
  const [current, setCurrent] = useState(source);
  useReportUnsaved("source", sourceChanged(source, current));

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
        components={components}
        onChange={(next) => {
          edited.current = next;
          setCurrent(next);
        }}
      />
      <BodyPreview
        markdown={current}
        syntax={syntax}
        site={preview ? { url: preview, message: () => previewMessage(edited.current, []) } : undefined}
      />
      <SaveRow label="원문 저장" pending={pending} state={state} unchanged="바뀐 내용이 없어 커밋하지 않았다." />
    </form>
  );
}
