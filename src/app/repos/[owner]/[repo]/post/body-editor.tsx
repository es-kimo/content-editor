"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { TechDetails } from "@/app/_lib/ui";
import { useReportUnsaved, useSave } from "@/app/_lib/unsaved";
import { uploadPreviewMessage } from "@/lib/content/preview";
import type { SaveState } from "@/lib/content/save-flow";
import { MAX_IMAGE_SIDE, uploadImports } from "@/lib/content/upload";
import { createUploadSession } from "@/lib/content/upload-session";
import { editedBody, sameBodyStructure, type MdxDoc, type PreviewImages, type Syntax } from "@/lib/mdx-doc";

import { BodyPreview } from "./body-preview";
import { prepareImage } from "./prepare-image";
import { SaveRow } from "./save-row";
import { uploadMessage } from "./upload-message";

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
  action: (data: FormData) => Promise<SaveState>;
}) {
  const save = useSave("body");
  /** 일반 편집으로 고칠 수 없게 된 이유. `detail`은 기술 상세에 둘 오류 원문이다. */
  const [problem, setProblem] = useState<{ message: string; detail?: string } | null>(null);
  const normalized = useRef<string | null>(null);
  const edited = useRef<string | null>(null);
  // 세션이 준비 중 여부를 바꾸면 이 상태로 다시 그려 첨부 판정과 저장 버튼을 갱신한다.
  const [preparing, setPreparing] = useState(false);
  const [uploads] = useState(() =>
    createUploadSession({ doc, files: upload?.files ?? [], prepare: prepareImage, onPreparing: setPreparing }),
  );
  const [images, setImages] = useState<{ file: string; size: number }[]>([]);
  const [imageProblem, setImageProblem] = useState<string | null>(null);
  const [current, setCurrent] = useState(body);
  // 저장할 본문(`editedBody`). 본문이 참조하는 첨부를 이 값으로 판정한다.
  const [draft, setDraft] = useState(body);
  // 서버가 변경 없음으로 답한 본문. 그 본문은 저장한 것과 같으므로 미저장 판정의 기준으로 삼는다.
  const [baseline, setBaseline] = useState(body);
  const changed = draft !== baseline;
  // WYSIWYG로 고칠 수 없게 된 글은 입력을 저장하지 않으므로 미저장으로 알리지 않는다.
  useReportUnsaved("body", changed && problem === null);
  useReportUnsaved("images", uploads.unsaved(draft) && problem === null);
  // 넣은 이미지는 커밋 전이라 레포 주소가 없으므로 미리보기는 브라우저 안의 주소로 보여 준다.
  const objectUrls = useRef(new Map<string, string>());
  const [previewImages, setPreviewImages] = useState<PreviewImages>({});
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  if (problem) {
    return (
      <>
        <p className="text-sm text-amber-600">{problem.message}</p>
        <pre className="overflow-x-auto rounded border p-3 text-sm whitespace-pre-wrap">{body}</pre>
        {problem.detail && <TechDetails items={[["오류 원문", problem.detail]]} />}
      </>
    );
  }

  const addImages = (files: File[], insert: (tags: string[]) => void) =>
    uploads.add(files, ({ tags, problems }) => {
      setImages(uploads.plan.images.map(({ file, content }) => ({ file, size: content.byteLength })));
      for (const { name, image } of uploadImports(uploads.plan)) {
        if (!objectUrls.current.has(name)) {
          objectUrls.current.set(name, URL.createObjectURL(new Blob([new Uint8Array(image.content)])));
        }
      }
      setPreviewImages(Object.fromEntries(objectUrls.current));
      setImageProblem(problems.length > 0 ? problems.map((p) => uploadMessage(p.name, p.problem)).join(" ") : null);
      insert(tags);
    });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = editedBody(body, normalized.current, edited.current);
        const submission = uploads.submission(next);
        if (!submission.ok) return;
        const data = new FormData();
        data.set("body", next);
        for (const image of submission.images) {
          data.append("image", new File([new Uint8Array(image.content)], image.file));
        }
        save.request(
          { target: "body" },
          () => action(data),
          () => setBaseline(next),
        );
      }}
    >
      <MdxBodyEditor
        markdown={body}
        components={components}
        readOnly={save.locked}
        onChange={(markdown, initialMarkdownNormalize) => {
          setCurrent(markdown);
          if (initialMarkdownNormalize) normalized.current = markdown;
          else edited.current = markdown;
          setDraft(editedBody(body, normalized.current, edited.current));
          if (!initialMarkdownNormalize) return;
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
        onImages={upload ? addImages : undefined}
      />
      {upload && (
        <p className="text-xs text-zinc-500">
          이미지(png·jpg·webp)는 끌어 놓거나 붙여 넣거나 도구 막대의 이미지 버튼으로 넣어 주세요. 긴 변이{" "}
          {MAX_IMAGE_SIDE}px보다 크면 줄여서 넣어요.
        </p>
      )}
      {images.length > 0 && (
        <p className="text-xs text-zinc-500">
          넣은 이미지: {images.map(({ file, size }) => `${file} (${Math.ceil(size / 1024)}KB)`).join(", ")}. 본문을
          저장할 때 글 폴더에 함께 저장하고, 본문에서 지운 이미지는 올리지 않아요.
        </p>
      )}
      {imageProblem && <p className="text-sm text-red-600">{imageProblem}</p>}
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
                    uploads.plan,
                    editedBody(body, normalized.current, edited.current),
                    uploads.sizes,
                  ),
              }
            : undefined
        }
      />
      {preparing && <p className="text-sm text-zinc-500">이미지를 준비하고 있어요. 본문에 들어간 뒤 저장해 주세요.</p>}
      <SaveRow label="본문 저장" save={save} disabled={preparing} />
    </form>
  );
}
