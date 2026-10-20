"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";

import { TechDetails } from "@/app/_lib/ui";
import { useReportUnsaved, useSave } from "@/app/_lib/unsaved";
import { applyBodyInsertForm, bodyInserts, imageFormTag } from "@/lib/content/insert-form";
import { uploadPreviewMessage } from "@/lib/content/preview";
import type { SaveState } from "@/lib/content/save-flow";
import { MAX_IMAGE_SIDE } from "@/lib/content/upload";
import { editedBody, sameBodyStructure, type MdxDoc, type Syntax } from "@/lib/mdx-doc";

import { BodyPreview } from "./body-preview";
import { AttachedImagesNotice, ImagePreparingNotice, ImageProblemNotice, useImageUpload } from "./image-upload";
import { InsertEntryList, useInsertForm } from "./insert-form";
import type { BodyEditorHandle } from "./mdx-body-editor";
import { SaveRow } from "./save-row";

const MdxBodyEditor = dynamic(() => import("./mdx-body-editor"), {
  ssr: false,
  loading: () => <p className="text-zinc-500">불러오는 중…</p>,
});

/** 이미지를 넣을 수 있는 글이면 글 폴더 파일 이름. */
export type BodyImageUpload = { files: string[] };

export function BodyEditor({
  doc,
  body,
  syntax,
  components,
  upload,
  preview,
  action,
}: {
  /** 글을 연 시점의 doc. 넣은 이미지의 import와 사이트 미리보기의 파일 전체를 이 doc에서 만든다. */
  doc: MdxDoc;
  body: string;
  syntax: Syntax;
  components: string[];
  upload: BodyImageUpload | null;
  /** config `preview`. 있으면 사이트 미리보기를 띄운다. */
  preview?: string;
  /** 본문과, 넣은 이미지를 파일 이름이 `N.ext`인 `image` 파일로 담은 FormData를 보낸다. */
  action: (body: string, images: FormData) => Promise<SaveState>;
}) {
  const save = useSave("body");
  /** 일반 편집으로 고칠 수 없게 된 이유. `detail`은 기술 상세에 둘 오류 원문이다. */
  const [problem, setProblem] = useState<{ message: string; detail?: string } | null>(null);
  const normalized = useRef<string | null>(null);
  const edited = useRef<string | null>(null);
  const editor = useRef<BodyEditorHandle | null>(null);
  const [current, setCurrent] = useState(body);
  // 저장할 본문(`editedBody`). 본문이 참조하는 첨부를 이 값으로 판정한다.
  const [draft, setDraft] = useState(body);
  // 서버가 변경 없음으로 답한 본문. 그 본문은 저장한 것과 같으므로 미저장 판정의 기준으로 삼는다.
  const [baseline, setBaseline] = useState(body);
  const changed = draft !== baseline;

  const edit = (markdown: string) => {
    setCurrent(markdown);
    edited.current = markdown;
    setDraft(editedBody(body, normalized.current, markdown));
  };
  const forms = useInsertForm({
    area: "body",
    apply: (target, value) => {
      const handle = editor.current;
      if (!handle) return "parse-error";
      if (target.kind === "image") {
        handle.insert(imageFormTag(target, value));
        return null;
      }
      if (target.kind !== "edit") return "invalid-position";
      const result = applyBodyInsertForm(attachedDoc, current, target, value, syntax);
      if (!result.ok) return result.reason;
      if (result.changed) {
        // 편집기는 코드로 바꾼 본문을 변경으로 알리지 않으므로 사용자가 고친 것처럼 직접 반영한다.
        handle.setMarkdown(result.body);
        edit(result.body);
      }
      return null;
    },
  });
  const images = useImageUpload({
    area: "body",
    doc,
    files: upload?.files ?? [],
    onAdded: (image, opener) => forms.open({ kind: "image", image, place: null }, opener),
  });
  // WYSIWYG로 고칠 수 없게 된 글은 입력을 저장하지 않으므로 미저장으로 알리지 않는다.
  useReportUnsaved("body", changed && problem === null);
  useReportUnsaved("images", images.session.unsaved(draft) && problem === null);
  const { doc: attachedDoc } = images;
  const inserts = useMemo(() => bodyInserts(attachedDoc, current, syntax), [attachedDoc, current, syntax]);

  if (problem) {
    return (
      <>
        <p className="text-sm text-amber-600">{problem.message}</p>
        <pre className="overflow-x-auto rounded border p-3 text-sm whitespace-pre-wrap">{body}</pre>
        {problem.detail && <TechDetails items={[["오류 원문", problem.detail]]} />}
      </>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = editedBody(body, normalized.current, edited.current);
        const data = images.upload(next);
        if (!data) return;
        save.request(
          { target: "body" },
          () => action(next, data),
          () => setBaseline(next),
        );
      }}
    >
      <InsertEntryList
        area="body"
        list={inserts}
        disabled={save.locked || !forms.canOpen || images.preparing}
        onEdit={(item, opener) => forms.open({ kind: "edit", item }, opener)}
      />
      {forms.panel}
      <div {...(upload ? images.dropProps : {})}>
        <MdxBodyEditor
          markdown={body}
          components={components}
          readOnly={save.locked}
          handleRef={editor}
          onChange={(markdown, initialMarkdownNormalize) => {
            if (!initialMarkdownNormalize) return edit(markdown);
            setCurrent(markdown);
            normalized.current = markdown;
            setDraft(editedBody(body, normalized.current, edited.current));
            // 렌더링 구조까지 바뀌는 글은 고치지 않은 곳까지 바꿔 저장하게 되므로 WYSIWYG로 고치지 않는다.
            if (!sameBodyStructure(body, markdown, syntax)) {
              setProblem({
                message:
                  "이 글은 일반 편집을 지원하지 않아요. 원문 편집을 이용해 주세요. 일반 편집으로 열면 글 구조가 바뀌어요.",
              });
            }
          }}
          onError={(message) =>
            setProblem({
              message:
                "이 글은 일반 편집을 지원하지 않아요. 원문 편집을 이용해 주세요. 일반 편집이 읽을 수 없는 내용이 있어요.",
              detail: message,
            })
          }
          onPickImage={upload ? images.pick : undefined}
        />
      </div>
      {upload && images.picker}
      {upload && (
        <p className="text-xs text-zinc-500">
          이미지(png·jpg·webp)는 하나씩 끌어 놓거나 붙여 넣거나 도구 막대의 이미지 버튼으로 넣고 대체 텍스트를 입력해
          주세요. 긴 변이 {MAX_IMAGE_SIDE}px보다 크면 줄여서 넣어요.
        </p>
      )}
      <AttachedImagesNotice upload={images}>
        본문을 저장할 때 글 폴더에 함께 저장하고, 본문에서 지웠거나 넣지 않은 이미지는 올리지 않아요.
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
                // 저장할 본문과 같은 것을 보이도록 저장 때와 같은 규칙으로 본문을 고른다.
                message: () =>
                  uploadPreviewMessage(
                    images.session.plan,
                    editedBody(body, normalized.current, edited.current),
                    images.session.sizes,
                  ),
              }
            : undefined
        }
      />
      <ImagePreparingNotice upload={images} />
      <SaveRow label="본문 저장" save={save} disabled={images.preparing} />
    </form>
  );
}
