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
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import { useMemo, useRef, type DragEvent } from "react";

import { UPLOAD_IMAGE_TYPES } from "@/lib/content/upload";

export type MdxBodyEditorProps = {
  markdown: string;
  /** 삽입 메뉴에 보일 컴포넌트. config `components`. */
  components: string[];
  onChange: (markdown: string, initialMarkdownNormalize: boolean) => void;
  onError: (message: string) => void;
  /**
   * 끌어 놓기·붙여넣기·파일 선택으로 받은 이미지를 처리하고 `insert`로 커서 자리에 태그를 넣는다.
   * 본문에 넣기까지를 한 작업으로 보호하도록 넣는 시점을 호출자가 정한다. 없으면 이미지를 받지 않는다.
   */
  onImages?: (files: File[], insert: (tags: string[]) => void) => Promise<void>;
};

/** next/dynamic으로 브라우저에서만 불러온다. MDXEditor는 서버에서 렌더링할 수 없다. */
export default function MdxBodyEditor({ markdown, components, onChange, onError, onImages }: MdxBodyEditorProps) {
  const editor = useRef<MDXEditorMethods>(null);
  const picker = useRef<HTMLInputElement>(null);
  const acceptsImages = onImages !== undefined;

  const insertImages = async (files: File[]) => {
    if (!onImages || files.length === 0) return;
    await onImages(files, (tags) => {
      if (tags.length > 0) editor.current?.insertMarkdown(tags.join("\n\n"));
    });
  };

  // 파일을 놓거나 붙여넣으면 에디터가 처리하기 전에 가로챈다. 그대로 두면 브라우저가 파일을 열거나 에디터가 무시한다.
  const takeFiles = (event: { preventDefault(): void; stopPropagation(): void }, data: DataTransfer | null) => {
    const files = [...(data?.files ?? [])];
    if (!acceptsImages || files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void insertImages(files);
  };
  const allowDrop = (event: DragEvent) => {
    if (acceptsImages && event.dataTransfer.types.includes("Files")) event.preventDefault();
  };

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
            {(components.length > 0 || acceptsImages) && <Separator />}
            {acceptsImages && (
              <Button title="이미지 넣기" onClick={() => picker.current?.click()}>
                이미지
              </Button>
            )}
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
    <div
      onPasteCapture={(event) => takeFiles(event, event.clipboardData)}
      onDragOverCapture={allowDrop}
      onDropCapture={(event) => takeFiles(event, event.dataTransfer)}
    >
      <MDXEditor
        ref={editor}
        markdown={markdown}
        plugins={plugins}
        onChange={onChange}
        onError={({ error }) => onError(error)}
        className="rounded border"
        contentEditableClassName="body-editor-content"
      />
      {acceptsImages && (
        <input
          ref={picker}
          type="file"
          accept={Object.keys(UPLOAD_IMAGE_TYPES).join(",")}
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            // 같은 파일을 다시 골라도 change가 일어나게 비운다.
            event.target.value = "";
            void insertImages(files);
          }}
        />
      )}
    </div>
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
