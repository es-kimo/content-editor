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
  type JsxEditorProps,
  type MdastJsx,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 폼·사진 모듈만 가져온다.
import type { BodyImagePhoto } from "@/lib/content/body-image";
import { advancedComponents, type BodyFootnote } from "@/lib/content/insert-form";

import { BodyFootnoteItem } from "./body-footnote";
import { BodyPhoto } from "./body-photo";

export type MdxBodyEditorProps = {
  markdown: string;
  /** config `components`. 넣기 메뉴가 폼으로 넣지 않는 컴포넌트는 도구 막대의 ‘고급 삽입’에 보인다. */
  components: string[];
  onChange: (markdown: string, initialMarkdownNormalize: boolean) => void;
  onError: (message: string) => void;
  /** 도구 막대의 이미지 버튼을 누르면 부른다. 버튼을 넘겨 폼을 닫을 때 초점을 돌려받게 한다. 없으면 버튼을 두지 않는다. */
  onPickImage?: (button: HTMLElement | null) => void;
  /** 저장 중이면 고치지 않는다. 도구 막대는 에디터가 함께 막는다. */
  readOnly?: boolean;
  /** 넣기·수정 폼이 본문을 읽고 적용한 결과를 쓰는 손잡이. 편집기가 만들어지면 채운다. */
  handleRef?: RefObject<BodyEditorHandle | null>;
  /** 본문의 요소를 사진으로 그릴 주소. 없거나 null을 돌려주면 이름과 속성을 보인다. */
  photo?: PhotoOf;
  /** 본문의 요소가 각주·출처면 번호와 내용으로 그릴 값. 없거나 null을 돌려주면 이름과 속성을 보인다. */
  footnote?: FootnoteOf;
};

type PhotoOf = (element: MdastJsx) => BodyImagePhoto | null;
type FootnoteOf = (element: MdastJsx) => BodyFootnote | null;

export type BodyEditorHandle = {
  markdown(): string;
  /** 본문을 바꾼다. 편집기는 이 변경을 `onChange`로 알리지 않는다. */
  setMarkdown(markdown: string): void;
  /** 본문의 커서 자리에 넣는다. 본문에 커서가 없었으면 끝에 넣는다. */
  insert(markdown: string): void;
  /**
   * 문장 안의 커서 자리에 글자만 담은 컴포넌트를 넣는다. 원문으로 넣으면 편집기가 문단 사이 요소로 읽어 문장을 나누므로
   * 컴포넌트로 넣는다. `text`는 이스케이프하기 전의 글자다.
   */
  insertInline(name: string, props: Record<string, string>, text: string): void;
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
  photo,
  footnote,
}: MdxBodyEditorProps) {
  const editor = useRef<MDXEditorMethods>(null);
  const insertInRoot = useRef<RootInserts | null>(null);
  const acceptsImages = onPickImage !== undefined;
  const advanced = useMemo(() => advancedComponents(components), [components]);
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
      insert: (next) =>
        editor.current?.focus(() => insertInRoot.current?.markdown(next), { defaultSelection: "rootEnd" }),
      insertInline: (name, props, text) =>
        editor.current?.focus(() => insertInRoot.current?.inline(name, props, text), { defaultSelection: "rootEnd" }),
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
            {(advanced.length > 0 || acceptsImages) && <Separator />}
            {acceptsImages && <ImageButton onClick={(button) => pickImage.current?.(button)} />}
            {advanced.length > 0 && (
              <span role="group" aria-label="고급 삽입" className="flex items-center">
                {advanced.map((name) => (
                  <InsertComponent key={name} name={name} />
                ))}
              </span>
            )}
          </>
        ),
      }),
    ],
    [components, advanced, acceptsImages],
  );

  return (
    // 편집기는 처음 만든 플러그인으로 요소를 그리므로, 넣은 이미지가 늘어 바뀌는 사진 주소와 본문마다 바뀌는 각주는
    // context로 넘긴다.
    <PhotoContext value={photo ?? null}>
      <FootnoteContext value={footnote ?? null}>
        <div onKeyDownCapture={leaveOnTab}>
          <MDXEditor
            ref={editor}
            markdown={markdown}
            plugins={plugins}
            readOnly={readOnly}
            onChange={onChange}
            onError={({ error }) => onError(error)}
            className="rounded border"
            contentEditableClassName={CONTENT_CLASS}
          />
        </div>
      </FootnoteContext>
    </PhotoContext>
  );
}

const PhotoContext = createContext<PhotoOf | null>(null);
const FootnoteContext = createContext<FootnoteOf | null>(null);

const CONTENT_CLASS = "body-editor-content";

/**
 * 목록 밖 본문에서 Tab을 누르면 편집기에 넘기지 않아 브라우저가 초점을 다음 조작 요소(본문 사진 등)로 옮기게 한다.
 * 편집기는 목록 들여쓰기에 쓰려고 본문 어디서나 Tab을 막아, 키보드만으로는 본문을 벗어나거나 사진을 고를 수 없다.
 */
function leaveOnTab(event: ReactKeyboardEvent) {
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.classList.contains(CONTENT_CLASS)) return;
  const anchor = document.getSelection()?.anchorNode;
  const at = anchor instanceof Element ? anchor : anchor?.parentElement;
  if (at?.closest("li")) return;
  event.stopPropagation();
}

/**
 * 사진 주소가 있는 이미지는 사진으로, 각주·출처는 번호와 내용으로, 나머지 요소는 이름과 속성으로 그린다.
 * 표현만 바꾸고 요소는 고치지 않는다.
 */
function JsxEditor(props: JsxEditorProps) {
  const photoOf = useContext(PhotoContext);
  const footnoteOf = useContext(FootnoteContext);
  const { mdastNode } = props;
  // 편집기는 이름이 같은 descriptor를 종류와 상관없이 쓰므로, 설정에 있는 컴포넌트는 문장 안에 있어도 flow descriptor로 온다.
  const inline = mdastNode.type === "mdxJsxTextElement";
  const photo = useMemo(() => photoOf?.(mdastNode) ?? null, [photoOf, mdastNode]);
  const footnote = useMemo(() => (photo ? null : (footnoteOf?.(mdastNode) ?? null)), [photo, footnoteOf, mdastNode]);
  if (photo) return <BodyPhoto key={photo.src} photo={photo} element={mdastNode} inline={inline} />;
  if (!footnote) return <GenericJsxEditor {...props} />;
  return (
    <BodyFootnoteItem footnote={footnote} element={mdastNode} inline={inline}>
      <GenericJsxEditor {...props} />
    </BodyFootnoteItem>
  );
}

/**
 * 삽입 메뉴에는 config의 컴포넌트만 둔다. 이미 글에 있는 다른 컴포넌트도 지우지 않고 보존해야 하므로
 * 이름을 가리지 않는 descriptor(`*`)로 읽어 들인다.
 */
function descriptors(components: string[]): JsxComponentDescriptor[] {
  const generic = { props: [], hasChildren: true, Editor: JsxEditor };
  return [
    ...components.map((name): JsxComponentDescriptor => ({ name, kind: "flow", ...generic })),
    { name: "*", kind: "flow", ...generic },
    { name: "*", kind: "text", ...generic },
  ];
}

type RootInserts = {
  markdown: (markdown: string) => void;
  inline: (name: string, props: Record<string, string>, text: string) => void;
};

/**
 * 본문(루트 편집기)에 넣는 함수를 `insertRef`에 채운다. 편집기의 넣기는 마지막에 초점이 있던 편집기에 넣어,
 * 기존 컴포넌트의 내용 편집기에 초점이 있었으면 그 컴포넌트 안에 들어가거나 넣지 못한다.
 */
function RootInsert({ insertRef }: { insertRef: RefObject<RootInserts | null> }) {
  const root = useCellValue(rootEditor$);
  const setActive = usePublisher(activeEditor$);
  const insert = usePublisher(insertMarkdown$);
  const insertJsx = usePublisher(insertJsx$);
  useEffect(() => {
    insertRef.current = {
      markdown: (markdown) => {
        if (root) setActive(root);
        insert(markdown);
      },
      inline: (name, props, text) => {
        if (root) setActive(root);
        insertJsx({ kind: "text", name, props, children: [{ type: "text", value: text }] });
      },
    };
  }, [insertRef, root, setActive, insert, insertJsx]);
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
