"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import type { Syntax } from "@/lib/mdx-doc";

import { compileDiagnostics, mdxLanguage } from "./mdx-source";

export type CodeMirrorSourceEditorProps = {
  source: string;
  syntax: Syntax;
  onChange: (source: string) => void;
};

const theme = EditorView.theme({
  "&": { maxHeight: "70vh", fontSize: "0.875rem" },
  ".cm-scroller": { overflow: "auto" },
});

/** next/dynamic으로 브라우저에서만 불러온다. CodeMirror는 DOM이 있어야 만들 수 있다. */
export default function CodeMirrorSourceEditor({ source, syntax, onChange }: CodeMirrorSourceEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 원문은 처음 연 값만 쓴다. 다른 원문으로 다시 열 때는 부모가 key를 바꿔 새로 만든다.
  const initial = useRef(source);
  // 서버가 다시 그릴 때마다 syntax 객체가 새로 오므로, 값이 같으면 에디터를 다시 만들어 입력을 잃지 않게 값으로 비교한다.
  const { gfm, math } = syntax;
  useEffect(() => {
    const syntax = { gfm, math };
    const view = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          mdxLanguage(syntax),
          syntaxHighlighting(defaultHighlightStyle),
          lintGutter(),
          linter((view) => compileDiagnostics(view.state.doc, syntax), { delay: 750 }),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [gfm, math]);

  return <div ref={parent} className="rounded border" />;
}
