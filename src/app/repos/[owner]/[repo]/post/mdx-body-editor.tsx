"use client";

import "@mdxeditor/editor/style.css";

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  Button,
  CreateLink,
  GenericJsxEditor,
  headingsPlugin,
  insertJsx$,
  jsxPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  Separator,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
  usePublisher,
  type JsxComponentDescriptor,
} from "@mdxeditor/editor";
import { useMemo } from "react";

export type MdxBodyEditorProps = {
  markdown: string;
  /** 삽입 메뉴에 보일 컴포넌트. config `components`. */
  components: string[];
  onChange: (markdown: string, initialMarkdownNormalize: boolean) => void;
  onError: (message: string) => void;
};

/** next/dynamic으로 브라우저에서만 불러온다. MDXEditor는 서버에서 렌더링할 수 없다. */
export default function MdxBodyEditor({ markdown, components, onChange, onError }: MdxBodyEditorProps) {
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
            <UndoRedo />
            <Separator />
            {/* 밑줄은 마크다운에 없어 <u> 태그가 들어가므로 뺀다. */}
            <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
            <BlockTypeSelect />
            <ListsToggle options={["bullet", "number"]} />
            <CreateLink />
            {components.length > 0 && <Separator />}
            {components.map((name) => (
              <InsertComponent key={name} name={name} />
            ))}
          </>
        ),
      }),
    ],
    [components],
  );

  return (
    <MDXEditor
      markdown={markdown}
      plugins={plugins}
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

function InsertComponent({ name }: { name: string }) {
  const insertJsx = usePublisher(insertJsx$);
  return (
    <Button title={`${name} 넣기`} onClick={() => insertJsx({ name, kind: "flow", props: {} })}>
      {name}
    </Button>
  );
}
