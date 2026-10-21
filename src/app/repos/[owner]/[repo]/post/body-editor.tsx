"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";

import { TechDetails } from "@/app/_lib/ui";
import { useReportUnsaved, useSaveLocked } from "@/app/_lib/unsaved";
import { bodyImagePhoto, type BodyImageSources } from "@/lib/content/body-image";
import { draftAttachments } from "@/lib/content/draft";
import {
  applyBodyInsertForm,
  bodyImageMoves,
  bodyImageReplace,
  bodyInsert,
  bodyInserts,
  imageFormTag,
  insertMenuItems,
  moveBodyInsert,
  newBodyInsertTarget,
  removeBodyInsert,
  type ImageInsertItem,
} from "@/lib/content/insert-form";
import { uploadPreviewMessage } from "@/lib/content/preview";
import { MAX_IMAGE_SIDE } from "@/lib/content/upload";
import { editedBody, hasTocHeading, sameBodyStructure, type JsxElement, type MdxDoc, type Syntax } from "@/lib/mdx-doc";

import { BodyPreview } from "./body-preview";
import { useDraftInput, useDraftTouch } from "./drafts";
import { AttachedImagesNotice, ImageProblemNotice, useImageUpload } from "./image-upload";
import { InsertEntryList, InsertMenu, useInsertForm } from "./insert-form";
import type { BodyEditorHandle } from "./mdx-body-editor";
import { useModeInput, usePostEditor, usePostInput, type CarriedForm } from "./post-editor";

const MdxBodyEditor = dynamic(() => import("./mdx-body-editor"), {
  ssr: false,
  loading: () => <p className="text-zinc-500">불러오는 중…</p>,
});

/** 이미지를 넣을 수 있는 글이면 글 폴더 파일 이름. */
export type BodyImageUpload = { files: string[] };

type BodyEditorProps = {
  /** 글을 연 시점의 doc. 넣은 이미지의 import와 사이트 미리보기의 파일 전체를 이 doc에서 만든다. */
  doc: MdxDoc;
  body: string;
  syntax: Syntax;
  components: string[];
  upload: BodyImageUpload | null;
  /** 본문의 저장된 이미지를 사진으로 읽어 올 글. 새 글은 null. */
  post: BodyImageSources["post"];
  /** config `preview`. 있으면 사이트 미리보기를 띄운다. */
  preview?: string;
};

/** 일반 편집 본문. 원문 편집에서 이어받은 입력이 있으면 그 본문·첨부로 다시 연다. */
export function BodyEditor(props: BodyEditorProps) {
  const carried = usePostEditor().carried.wysiwyg;
  if (!carried) return <OpenedBodyEditor key="post" {...props} saved={props.body} carried={null} />;
  return (
    <OpenedBodyEditor
      key={carried.key}
      {...props}
      doc={carried.doc}
      body={carried.input.body}
      saved={props.body}
      carried={carried}
    />
  );
}

function OpenedBodyEditor({
  doc,
  body,
  saved,
  carried,
  syntax,
  components,
  upload,
  post,
  preview,
}: BodyEditorProps & {
  /** 글에 저장된 본문. 미저장 판정의 기준이다. */
  saved: string;
  /** 이어받아 연 입력. 연 본문이 일반 편집으로 읽히지 않으면 전환을 되돌린다. */
  carried: CarriedForm | null;
}) {
  const locked = useSaveLocked();
  const { mode, rejectCarried } = usePostEditor();
  // 숨은 편집기의 입력은 저장하지 않고 다른 모드로 넘어간 것이라 미저장으로 알리지 않는다.
  const visible = mode === "wysiwyg";
  /** 일반 편집으로 고칠 수 없게 된 이유. `detail`은 기술 상세에 둘 오류 원문이다. */
  const [problem, setProblem] = useState<{ message: string; detail?: string } | null>(null);
  // 원문 편집에서 본문을 고쳐 읽을 수 없게 됐을 때만 전환을 되돌린다. 저장된 본문부터 읽을 수 없는 글은
  // 처음 열 때처럼 이유를 보이고 제목·설정은 일반 편집에서 고치게 둔다.
  const unreadable = (found: { message: string; detail?: string }) => {
    if (carried && !carried.restored && body !== saved) rejectCarried(carried.key);
    else setProblem(found);
  };
  const normalized = useRef<string | null>(null);
  const edited = useRef<string | null>(null);
  const editor = useRef<BodyEditorHandle | null>(null);
  const [current, setCurrent] = useState(body);
  // 저장할 본문(`editedBody`). 본문이 참조하는 첨부를 이 값으로 판정한다.
  const [draft, setDraft] = useState(body);
  // 서버가 변경 없음으로 답한 본문. 그 본문은 저장한 것과 같으므로 미저장 판정의 기준으로 삼는다.
  const [baseline, setBaseline] = useState(saved);
  const changed = draft !== baseline;
  const touch = useDraftTouch();

  const edit = (markdown: string) => {
    touch();
    setCurrent(markdown);
    edited.current = markdown;
    setDraft(editedBody(body, normalized.current, markdown));
  };
  /** 폼이나 목차·이미지 제거, 이미지 이동으로 고친 본문을 편집기에 쓴다. */
  const replaceBody = <R,>(result: { ok: true; body: string; changed: boolean } | { ok: false; reason: R }) => {
    if (!result.ok) return result.reason;
    if (result.changed) {
      // 편집기는 코드로 바꾼 본문을 변경으로 알리지 않으므로 사용자가 고친 것처럼 직접 반영한다.
      editor.current?.setMarkdown(result.body);
      edit(result.body);
    }
    return null;
  };
  const forms = useInsertForm({
    area: "body",
    apply: (target, input) => {
      const handle = editor.current;
      if (!handle) return "parse-error";
      if (target.kind === "image") {
        handle.insert(imageFormTag(target, input.text));
        return null;
      }
      if (target.kind !== "edit" && target.kind !== "replace") {
        const result = bodyInsert(attachedDoc, current, target, input, syntax);
        if (!result.ok) return result.reason;
        const { insert } = result;
        if (insert.kind === "inline") handle.insertInline(insert.name, { id: String(insert.id) }, insert.text);
        else handle.insert(insert.markdown);
        return null;
      }
      return replaceBody(applyBodyInsertForm(attachedDoc, current, target, input, syntax));
    },
  });
  const images = useImageUpload({
    area: "body",
    doc,
    files: upload?.files ?? [],
    attachments: carried?.input.images,
    onAdded: (image, opener) => forms.open({ kind: "image", image, place: null }, opener),
  });
  // WYSIWYG로 고칠 수 없게 된 글은 입력을 저장하지 않으므로 미저장으로 알리지 않는다.
  useReportUnsaved("body", changed && problem === null && visible);
  useReportUnsaved("images", images.session.unsaved(draft) && problem === null && visible);
  const { doc: attachedDoc } = images;
  const inserts = useMemo(() => bodyInserts(attachedDoc, current, syntax), [attachedDoc, current, syntax]);
  const tocHeading = useMemo(() => hasTocHeading(current, syntax), [current, syntax]);
  const { previewImages } = images;
  const photo = useCallback(
    (element: JsxElement) => bodyImagePhoto(attachedDoc, element, { inserted: previewImages, post }, syntax),
    [attachedDoc, previewImages, post, syntax],
  );
  const imageMoves = useCallback(
    (item: ImageInsertItem) => bodyImageMoves(attachedDoc, current, item, syntax),
    [attachedDoc, current, syntax],
  );
  const formLocked = locked || !forms.canOpen || images.preparing;
  // 본문과 본문에 넣은 이미지를 낸다. 일반 편집으로 고칠 수 없게 된 글도 제목·설정은 일반 편집에서 저장하므로,
  // 본문은 연 그대로 첨부 없이 낸다.
  usePostInput("wysiwyg", () => {
    if (problem) return { text: body, data: new FormData(), unchanged: () => {} };
    const next = editedBody(body, normalized.current, edited.current);
    const data = images.upload(next);
    return data && { text: next, data, unchanged: () => setBaseline(next) };
  });
  // 원문 편집으로 넘길 본문과 첨부. 일반 편집으로 고칠 수 없게 된 글은 저장할 때처럼 본문을 연 그대로 넘긴다.
  useModeInput("wysiwyg", () => {
    if (problem) return { body, images: [], doc };
    const next = editedBody(body, normalized.current, edited.current);
    const attachments = images.attachments(next);
    return attachments && { body: next, images: attachments, doc: images.session.plan.doc };
  });
  // 보관할 본문과 준비가 끝난 첨부. 일반 편집으로 고칠 수 없게 된 글은 저장할 때처럼 본문을 연 그대로 낸다.
  useDraftInput("wysiwyg", () => {
    if (problem) return { body, images: [] };
    const next = editedBody(body, normalized.current, edited.current);
    return { body: next, images: draftAttachments(images.session, next) };
  });
  // 이미지는 넣을 수 있는 글에서만 메뉴에 둔다. 고르면 파일 선택 창을 열고, 고른 뒤 폼이 열린다.
  const menu = insertMenuItems(components).filter((item) => item.kind !== "image" || upload);

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
    <div className="flex flex-col gap-2">
      <InsertMenu
        disabled={formLocked}
        items={menu.map(({ kind, label }) => ({
          label,
          onSelect: (opener) => {
            if (kind === "image") return images.pick(opener);
            forms.open(newBodyInsertTarget(kind, attachedDoc, current, syntax), opener);
          },
        }))}
      />
      <InsertEntryList
        area="body"
        list={inserts}
        tocHeading={tocHeading}
        disabled={formLocked}
        onEdit={(item, opener) => forms.open({ kind: "edit", item }, opener)}
        onRemove={(item) => replaceBody(removeBodyInsert(attachedDoc, current, item, syntax))}
        images={{
          moves: imageMoves,
          replace: upload
            ? (item, opener) => {
                // 새 파일을 첨부에 더하면 import가 늘어 위치가 밀리므로, 고른 때의 원문을 함께 둔다.
                const replace = bodyImageReplace(attachedDoc, current, item);
                images.pick(opener, (image) => forms.open({ kind: "replace", ...replace, image }, opener));
              }
            : null,
          move: (item, direction) => {
            const result = moveBodyInsert(attachedDoc, current, item, direction, syntax);
            replaceBody(result);
            return result;
          },
        }}
      />
      {forms.panel}
      <div {...(upload ? images.dropProps : {})}>
        <MdxBodyEditor
          markdown={body}
          components={components}
          readOnly={locked}
          handleRef={editor}
          onChange={(markdown, initialMarkdownNormalize) => {
            if (!initialMarkdownNormalize) return edit(markdown);
            setCurrent(markdown);
            normalized.current = markdown;
            setDraft(editedBody(body, normalized.current, edited.current));
            // 렌더링 구조까지 바뀌는 글은 고치지 않은 곳까지 바꿔 저장하게 되므로 WYSIWYG로 고치지 않는다.
            if (!sameBodyStructure(body, markdown, syntax)) {
              unreadable({
                message:
                  "이 글은 일반 편집을 지원하지 않아요. 원문 편집을 이용해 주세요. 일반 편집으로 열면 글 구조가 바뀌어요.",
              });
            }
          }}
          onError={(message) =>
            unreadable({
              message:
                "이 글은 일반 편집을 지원하지 않아요. 원문 편집을 이용해 주세요. 일반 편집이 읽을 수 없는 내용이 있어요.",
              detail: message,
            })
          }
          onPickImage={upload ? images.pick : undefined}
          photo={photo}
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
        글을 저장할 때 글 폴더에 함께 저장하고, 본문에서 지웠거나 넣지 않은 이미지는 올리지 않아요.
      </AttachedImagesNotice>
      <ImageProblemNotice upload={images} />
      <BodyPreview
        markdown={current}
        syntax={syntax}
        images={previewImages}
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
    </div>
  );
}
