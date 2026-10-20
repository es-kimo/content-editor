"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { InsertSpan, Syntax } from "@/lib/mdx-doc";

import { TOGGLE_BUTTON_CLASS } from "./editor-mode-switch";
import { compileDiagnostics, insertComponent, mdxLanguage, replaceSource } from "./mdx-source";

export type CodeMirrorSourceEditorProps = {
  source: string;
  syntax: Syntax;
  /** ‘고급 삽입’ 버튼으로 템플릿을 넣을 컴포넌트. `advancedComponents`의 결과. */
  components: string[];
  onChange: (source: string) => void;
  /** 저장 중이면 고치지도 컴포넌트를 넣지도 않는다. */
  readOnly?: boolean;
  /** 넣기·수정 폼이 편집기의 선택 영역을 읽고 적용한 원문을 쓰는 손잡이. 편집기가 만들어지면 채운다. */
  handleRef?: RefObject<SourceEditorHandle | null>;
};

export type SourceEditorHandle = {
  selection(): InsertSpan;
  /** 적용한 원문으로 바꾸고 커서를 `cursor`에 둔다. */
  replace(source: string, cursor: number): void;
};

const locked = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];

const theme = EditorView.theme({
  "&": { maxHeight: "70vh", fontSize: "0.875rem" },
  ".cm-scroller": { overflow: "auto" },
});

/** next/dynamic으로 브라우저에서만 불러온다. CodeMirror는 DOM이 있어야 만들 수 있다. */
export default function CodeMirrorSourceEditor({
  source,
  syntax,
  components,
  onChange,
  readOnly = false,
  handleRef,
}: CodeMirrorSourceEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  // 잠금이 바뀔 때 에디터를 다시 만들면 처음 원문으로 돌아가 입력을 잃으므로 잠금 구획만 바꾼다.
  const [lock] = useState(() => new Compartment());
  const readOnlyRef = useRef(readOnly);

  // 원문은 처음 연 값만 쓴다. 다른 원문으로 다시 열 때는 부모가 key를 바꿔 새로 만든다.
  const initial = useRef(source);
  // 서버가 다시 그릴 때마다 syntax 객체가 새로 오므로, 값이 같으면 에디터를 다시 만들어 입력을 잃지 않게 값으로 비교한다.
  const { gfm, math } = syntax;
  useEffect(() => {
    const syntax = { gfm, math };
    const created = new EditorView({
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
          lock.of(locked(readOnlyRef.current)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      view.current = null;
      created.destroy();
    };
  }, [gfm, math, lock]);
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      selection: () => {
        const { from, to } = view.current?.state.selection.main ?? { from: 0, to: 0 };
        return { from, to };
      },
      replace: (source, cursor) => {
        const current = view.current;
        if (current) current.dispatch(replaceSource(current.state, source, cursor));
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);
  useEffect(() => {
    readOnlyRef.current = readOnly;
    view.current?.dispatch({ effects: lock.reconfigure(locked(readOnly)) });
  }, [lock, readOnly]);

  const insert = (name: string) => {
    const current = view.current;
    if (!current || readOnly) return;
    current.dispatch(insertComponent(current.state, name, { gfm, math }));
    current.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      {components.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="고급 삽입">
          <span className="text-xs text-zinc-500">고급 삽입</span>
          {components.map((name) => (
            <button
              key={name}
              type="button"
              disabled={readOnly}
              onClick={() => insert(name)}
              className={TOGGLE_BUTTON_CLASS}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div ref={parent} className="rounded border" />
    </div>
  );
}
