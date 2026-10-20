"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";

import { useReportUnsaved, useSave } from "@/app/_lib/unsaved";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 미리보기 메시지와 넣기 메뉴만 가져온다.
import { applyInsertForm, insertMenuItems } from "@/lib/content/insert-form";
import { previewMessage, previewUploads } from "@/lib/content/preview";
import type { SaveState } from "@/lib/content/save-flow";
import { sourceChanged } from "@/lib/content/unsaved";
import { IMAGE_COMPONENT, MAX_IMAGE_SIDE, sourceUploads } from "@/lib/content/upload";
import { parseMdx, readInserts, type Syntax } from "@/lib/mdx-doc";

import type { BodyImageUpload } from "./body-editor";
import { BodyPreview } from "./body-preview";
import type { SourceEditorHandle } from "./codemirror-source-editor";
import { useImageUpload } from "./image-upload";
import { InsertEntryList, InsertMenu, useInsertForm } from "./insert-form";
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
  upload,
  preview,
  action,
}: {
  source: string;
  syntax: Syntax;
  /** 삽입 버튼으로 보일 컴포넌트. `sourceComponents`의 결과. */
  components: string[];
  /** 이미지를 넣을 수 있는 글이면 글 폴더 파일 이름. 원문을 import·metadata와 본문으로 나눌 수 있어야 넣는다. */
  upload: BodyImageUpload | null;
  /** config `preview`. 있으면 사이트 미리보기를 띄운다. */
  preview?: string;
  /** 원문과, 넣은 이미지를 파일 이름이 `N.ext`인 `image` 파일로 담은 FormData를 보낸다. */
  action: (source: string, images: FormData) => Promise<SaveState>;
}) {
  const save = useSave("source");
  const edited = useRef(source);
  const [current, setCurrent] = useState(source);
  // 서버가 변경 없음으로 답한 원문. 그 원문은 저장한 것과 같으므로 미저장 판정의 기준으로 삼는다.
  const [baseline, setBaseline] = useState(source);
  useReportUnsaved("source", sourceChanged(baseline, current));
  const editor = useRef<SourceEditorHandle | null>(null);
  const forms = useInsertForm({
    area: "source",
    apply: (target, value) => {
      const result = applyInsertForm(edited.current, target, value, syntax);
      if (!result.ok) return result.reason;
      if (result.changed) editor.current?.replace(result.source, result.cursor);
      return null;
    },
  });
  const [opened] = useState(() => parseMdx(source, syntax));
  const images = useImageUpload({
    doc: opened,
    files: upload?.files ?? [],
    // 원문 편집은 import까지 사용자가 고치므로 원문이 가리키는 첨부를 모두 올린다.
    used: (plan, text) => sourceUploads(plan.images, text),
    onAdded: (image, opener) => {
      const at = editor.current?.selection();
      return at ? forms.open({ kind: "image", image, place: { at, opened: edited.current } }, opener) : false;
    },
  });
  useReportUnsaved("sourceImages", images.session.unsaved(current));
  const inserts = useMemo(() => readInserts(current, syntax), [current, syntax]);
  const formLocked = save.locked || !forms.canOpen || images.preparing;
  const menu = insertMenuItems(upload ? [IMAGE_COMPONENT, ...components] : components);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = edited.current;
        const submission = images.session.submission(next);
        if (!submission.ok) return;
        const data = new FormData();
        for (const image of submission.images) {
          data.append("image", new File([new Uint8Array(image.content)], image.file));
        }
        save.request(
          { target: "source", before: source, after: next, syntax },
          () => action(next, data),
          () => setBaseline(next),
        );
      }}
    >
      <p className="text-xs text-zinc-500">글 설정과 이미지 연결을 포함한 파일 전체를 고쳐요.</p>
      <InsertMenu
        disabled={formLocked}
        items={menu.map(({ kind, label }) => ({
          label,
          onSelect: (opener) => {
            if (kind === "image") return images.pick(opener);
            const at = editor.current?.selection();
            if (at) forms.open({ kind, at, opened: edited.current }, opener);
          },
        }))}
      />
      <InsertEntryList
        area="source"
        list={inserts}
        disabled={formLocked}
        onEdit={(item, opener) => forms.open({ kind: "edit", item }, opener)}
      />
      {forms.panel}
      <div {...(upload ? images.dropProps : {})}>
        <CodeMirrorSourceEditor
          handleRef={editor}
          source={source}
          syntax={syntax}
          components={components}
          readOnly={save.locked}
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
      {images.attached.length > 0 && (
        <p className="text-xs text-zinc-500">
          넣은 이미지: {images.attached.map(({ file, size }) => `${file} (${Math.ceil(size / 1024)}KB)`).join(", ")}.
          원문을 저장할 때 글 폴더에 함께 저장하고, 원문에서 가져오지 않는 이미지는 올리지 않아요.
        </p>
      )}
      {images.problem && <p className="text-sm text-red-600">{images.problem}</p>}
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
      {images.preparing && (
        <p className="text-sm text-zinc-500">이미지를 준비하고 있어요. 대체 텍스트를 넣은 뒤 저장해 주세요.</p>
      )}
      <SaveRow label="원문 저장" save={save} disabled={images.preparing} />
    </form>
  );
}
