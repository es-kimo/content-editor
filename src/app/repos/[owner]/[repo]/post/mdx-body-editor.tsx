"use client";

import "@mdxeditor/editor/style.css";

import {
  activeEditor$,
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  Button,
  CreateLink,
  GenericJsxEditor,
  headingsPlugin,
  insertJsx$,
  insertMarkdown$,
  jsxPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  readOnly$,
  rootEditor$,
  Separator,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
  useCellValue,
  usePublisher,
  type JsxComponentDescriptor,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import { useEffect, useMemo, useRef, type RefObject } from "react";

export type MdxBodyEditorProps = {
  markdown: string;
  /** 삽입 메뉴에 보일 컴포넌트. config `components`. */
  components: string[];
  onChange: (markdown: string, initialMarkdownNormalize: boolean) => void;
  onError: (message: string) => void;
  /** 도구 막대의 이미지 버튼을 누르면 부른다. 버튼을 넘겨 폼을 닫을 때 초점을 돌려받게 한다. 없으면 버튼을 두지 않는다. */
  onPickImage?: (button: HTMLElement | null) => void;
  /** 저장 중이면 고치지 않는다. 도구 막대는 에디터가 함께 막는다. */
  readOnly?: boolean;
  /** 넣기·수정 폼이 본문을 읽고 적용한 결과를 쓰는 손잡이. 편집기가 만들어지면 채운다. */
  handleRef?: RefObject<BodyEditorHandle | null>;
};

export type BodyEditorHandle = {
  markdown(): string;
  /** 본문을 바꾼다. 편집기는 이 변경을 `onChange`로 알리지 않는다. */
  setMarkdown(markdown: string): void;
  /** 본문의 커서 자리에 넣는다. 본문에 커서가 없었으면 끝에 넣는다. */
  insert(markdown: string): void;
};

/** next/dynamic으로 브라우저에서만 불러온다. MDXEditor는 서버에서 렌더링할 수 없다. */
export default function MdxBodyEditor({
  markdown,
  components,
  onChange,
  onError,
  onPickImage,
  readOnly = false,
  handleRef,
}: MdxBodyEditorProps) {
  const editor = useRef<MDXEditorMethods>(null);
  const insertInRoot = useRef<((markdown: string) => void) | null>(null);
  const acceptsImages = onPickImage !== undefined;
  // 도구 막대는 처음 만든 플러그인으로 그리므로 버튼이 부를 함수는 마지막으로 그린 것을 쓴다.
  const pickImage = useRef(onPickImage);
  useEffect(() => {
    pickImage.current = onPickImage;
  }, [onPickImage]);
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      markdown: () => editor.current?.getMarkdown() ?? "",
      setMarkdown: (next) => editor.current?.setMarkdown(next),
      // 폼으로 옮겨 간 초점을 본문으로 돌려야 편집기가 기억한 커서 자리에 넣는다.
      insert: (next) => editor.current?.focus(() => insertInRoot.current?.(next), { defaultSelection: "rootEnd" }),
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      markdownShortcutPlugin(),
      jsxPlugin({ jsxComponentDescriptors: descriptors(components) }),
      toolbarPlugin({
        toolbarContents: () => (
          <>
            <RootInsert insertRef={insertInRoot} />
            <UndoRedo />
            <Separator />
            {/* 밑줄은 마크다운에 없어 <u> 태그가 들어가므로 뺀다. */}
            <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
            <BlockTypeSelect />
            <ListsToggle options={["bullet", "number"]} />
            <CreateLink />
            {(components.length > 0 || acceptsImages) && <Separator />}
            {acceptsImages && <ImageButton onClick={(button) => pickImage.current?.(button)} />}
            {components.map((name) => (
              <InsertComponent key={name} name={name} />
            ))}
          </>
        ),
      }),
    ],
    [components, acceptsImages],
  );

  return (
    <MDXEditor
      ref={editor}
      markdown={markdown}
      plugins={plugins}
      readOnly={readOnly}
      onChange={onChange}
      onError={({ error }) => onError(error)}
      className="rounded border"
      contentEditableClassName="body-editor-content"
    />
  );
}

/**
 * 삽입 메뉴에는 config의 컴포넌트만 둔다. 이미 글에 있는 다른 컴포넌트도 지우지 않고 보존해야 하므로
 * 이름을 가리지 않는 descriptor(`*`)로 읽어 들인다.
 */
function descriptors(components: string[]): JsxComponentDescriptor[] {
  const generic = { props: [], hasChildren: true, Editor: GenericJsxEditor };
  return [
    ...components.map((name): JsxComponentDescriptor => ({ name, kind: "flow", ...generic })),
    { name: "*", kind: "flow", ...generic },
    { name: "*", kind: "text", ...generic },
  ];
}

/**
 * 본문(루트 편집기)에 넣는 함수를 `insertRef`에 채운다. 편집기의 넣기는 마지막에 초점이 있던 편집기에 넣어,
 * 기존 컴포넌트의 내용 편집기에 초점이 있었으면 그 컴포넌트 안에 들어가거나 넣지 못한다.
 */
function RootInsert({ insertRef }: { insertRef: RefObject<((markdown: string) => void) | null> }) {
  const root = useCellValue(rootEditor$);
  const setActive = usePublisher(activeEditor$);
  const insert = usePublisher(insertMarkdown$);
  useEffect(() => {
    insertRef.current = (markdown) => {
      if (root) setActive(root);
      insert(markdown);
    };
  }, [insertRef, root, setActive, insert]);
  return null;
}

// 에디터의 읽기 전용은 도구 막대의 마우스 입력만 막고 직접 만든 버튼은 키보드로 누를 수 있어 같은 값으로 막는다.
function ImageButton({ onClick }: { onClick: (button: HTMLElement) => void }) {
  const readOnly = useCellValue(readOnly$);
  return (
    <Button title="이미지 넣기" disabled={readOnly} onClick={(event) => onClick(event.currentTarget)}>
      이미지
    </Button>
  );
}

function InsertComponent({ name }: { name: string }) {
  const insertJsx = usePublisher(insertJsx$);
  const readOnly = useCellValue(readOnly$);
  return (
    <Button title={`${name} 넣기`} disabled={readOnly} onClick={() => insertJsx({ name, kind: "flow", props: {} })}>
      {name}
    </Button>
  );
}
