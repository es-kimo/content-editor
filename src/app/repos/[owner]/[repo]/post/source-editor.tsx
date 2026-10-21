"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";

import { useReportUnsaved, useSaveLocked } from "@/app/_lib/unsaved";
import type { DraftAttachment } from "@/lib/content/draft";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 미리보기 메시지와 넣기 메뉴만 가져온다.
import {
  advancedComponents,
  applyInsertForm,
  imageMoves as imageMovesIn,
  insertMenuItems,
  moveInsert,
  newInsertTarget,
  removeInsert,
  type ImageInsertItem,
} from "@/lib/content/insert-form";
import { previewMessage, previewUploads } from "@/lib/content/preview";
import { sourceChanged } from "@/lib/content/unsaved";
import { IMAGE_COMPONENT, MAX_IMAGE_SIDE, sourceUploads } from "@/lib/content/upload";
import { hasTocHeading, parseMdx, readInserts, type Syntax } from "@/lib/mdx-doc";

import type { BodyImageUpload } from "./body-editor";
import { BodyPreview } from "./body-preview";
import type { SourceEditorHandle } from "./codemirror-source-editor";
import { AttachedImagesNotice, ImageProblemNotice, useImageUpload } from "./image-upload";
import { InsertEntryList, InsertMenu, useInsertForm } from "./insert-form";
import { useModeInput, usePostEditor, usePostInput } from "./post-editor";

const CodeMirrorSourceEditor = dynamic(() => import("./codemirror-source-editor"), {
  ssr: false,
  loading: () => <p className="text-zinc-500">불러오는 중…</p>,
});

type SourceEditorProps = {
  source: string;
  syntax: Syntax;
  /** 글 분류가 허용한 컴포넌트. `sourceComponents`의 결과. 넣기 메뉴와 고급 삽입으로 나눠 보인다. */
  components: string[];
  /** 이미지를 넣을 수 있는 글이면 글 폴더 파일 이름. 원문을 import·metadata와 본문으로 나눌 수 있어야 넣는다. */
  upload: BodyImageUpload | null;
  /** config `preview`. 있으면 사이트 미리보기를 띄운다. */
  preview?: string;
};

/** 원문 모드. import·metadata를 포함한 파일 전체를 고쳐 저장한다. 일반 편집에서 이어받은 입력이 있으면 그 원문·첨부로 다시 연다. */
export function SourceEditor(props: SourceEditorProps) {
  const carried = usePostEditor().carried.source;
  if (!carried) return <OpenedSourceEditor key="post" {...props} saved={props.source} attachments={[]} />;
  return (
    <OpenedSourceEditor
      key={carried.key}
      {...props}
      source={carried.input.source}
      saved={props.source}
      attachments={carried.input.images}
    />
  );
}

function OpenedSourceEditor({
  source,
  saved,
  attachments,
  syntax,
  components,
  upload,
  preview,
}: SourceEditorProps & {
  /** 글에 저장된 원문. 미저장 판정의 기준이다. */
  saved: string;
  /** 이어받은 첨부. `source`가 그 import를 담고 있다. */
  attachments: DraftAttachment[];
}) {
  const locked = useSaveLocked();
  // 숨은 편집기의 입력은 저장하지 않고 다른 모드로 넘어간 것이라 미저장으로 알리지 않는다.
  const visible = usePostEditor().mode === "source";
  const edited = useRef(source);
  const [current, setCurrent] = useState(source);
  // 서버가 변경 없음으로 답한 원문. 그 원문은 저장한 것과 같으므로 미저장 판정의 기준으로 삼는다.
  const [baseline, setBaseline] = useState(saved);
  useReportUnsaved("source", sourceChanged(baseline, current) && visible);
  const editor = useRef<SourceEditorHandle | null>(null);
  /** 폼이나 목차·이미지 제거, 이미지 이동으로 고친 원문을 편집기에 쓴다. */
  const replaceSource = <R,>(
    result: { ok: true; source: string; cursor: number; changed: boolean } | { ok: false; reason: R },
  ) => {
    if (!result.ok) return result.reason;
    if (result.changed) editor.current?.replace(result.source, result.cursor);
    return null;
  };
  const forms = useInsertForm({
    area: "source",
    apply: (target, input) => replaceSource(applyInsertForm(edited.current, target, input, syntax)),
  });
  const [opened] = useState(() => parseMdx(source, syntax));
  const images = useImageUpload({
    area: "source",
    doc: opened,
    files: upload?.files ?? [],
    // 원문 편집은 import까지 사용자가 고치므로 원문이 가리키는 첨부를 모두 올린다.
    used: sourceUploads,
    attachments,
    onAdded: (image, opener) => {
      const at = editor.current?.selection();
      return at ? forms.open({ kind: "image", image, place: { at, opened: edited.current } }, opener) : false;
    },
  });
  useReportUnsaved("sourceImages", images.session.unsaved(current) && visible);
  const inserts = useMemo(() => readInserts(current, syntax), [current, syntax]);
  const tocHeading = useMemo(() => hasTocHeading(current, syntax), [current, syntax]);
  const imageMoves = useCallback((item: ImageInsertItem) => imageMovesIn(current, item, syntax), [current, syntax]);
  const formLocked = locked || !forms.canOpen || images.preparing;
  const menu = insertMenuItems(upload ? [IMAGE_COMPONENT, ...components] : components);
  usePostInput("source", () => {
    const next = edited.current;
    const data = images.upload(next);
    return data && { text: next, data, unchanged: () => setBaseline(next) };
  });
  useModeInput("source", () => {
    const next = edited.current;
    const used = images.attachments(next);
    return used && { source: next, images: used };
  });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500">글 설정과 이미지 연결을 포함한 파일 전체를 고쳐요.</p>
      <InsertMenu
        disabled={formLocked}
        items={menu.map(({ kind, label }) => ({
          label,
          onSelect: (opener) => {
            if (kind === "image") return images.pick(opener);
            const at = editor.current?.selection();
            if (at) forms.open(newInsertTarget(kind, edited.current, { at, opened: edited.current }, syntax), opener);
          },
        }))}
      />
      <InsertEntryList
        area="source"
        list={inserts}
        tocHeading={tocHeading}
        disabled={formLocked}
        onEdit={(item, opener) => forms.open({ kind: "edit", item }, opener)}
        onRemove={(item) => replaceSource(removeInsert(edited.current, item, syntax))}
        images={{
          moves: imageMoves,
          replace: upload
            ? (item, opener) => {
                const replace = { item, opened: edited.current };
                images.pick(opener, (image) => forms.open({ kind: "replace", ...replace, image }, opener));
              }
            : null,
          move: (item, direction) => {
            const result = moveInsert(edited.current, item, direction, syntax);
            replaceSource(result);
            return result;
          },
        }}
      />
      {forms.panel}
      <div {...(upload ? images.dropProps : {})}>
        <CodeMirrorSourceEditor
          handleRef={editor}
          source={source}
          syntax={syntax}
          components={advancedComponents(components)}
          readOnly={locked}
          onChange={(next) => {
            edited.current = next;
            setCurrent(next);
          }}
        />
      </div>
      {upload && images.picker}
      {upload && (
        <p className="text-xs text-zinc-500">
          이미지(png·jpg·webp)는 넣기 메뉴로 고르거나 원문에 하나씩 끌어 놓거나 붙여 넣고 대체 텍스트를 입력해 주세요.
          긴 변이 {MAX_IMAGE_SIDE}px보다 크면 줄여서 넣어요.
        </p>
      )}
      <AttachedImagesNotice upload={images}>
        글을 저장할 때 글 폴더에 함께 저장하고, 원문에서 가져오지 않는 이미지는 올리지 않아요.
      </AttachedImagesNotice>
      <ImageProblemNotice upload={images} />
      <BodyPreview
        markdown={current}
        syntax={syntax}
        images={images.previewImages}
        site={
          preview
            ? {
                url: preview,
                message: () =>
                  previewMessage(edited.current, previewUploads(images.session.plan, images.session.sizes)),
              }
            : undefined
        }
      />
    </div>
  );
}
