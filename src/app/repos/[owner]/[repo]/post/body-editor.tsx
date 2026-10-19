"use client";

import dynamic from "next/dynamic";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { addUpload, MAX_IMAGE_SIDE, uploadImports, usedUploads, type UploadPlan } from "@/lib/content/upload";
import { editedBody, sameBodyStructure, type MdxDoc, type PreviewImages, type Syntax } from "@/lib/mdx-doc";

import type { SaveState } from "./actions";
import { BodyPreview } from "./body-preview";
import { prepareImage } from "./prepare-image";
import { SaveRow } from "./save-row";
import { uploadMessage } from "./upload-message";

const MdxBodyEditor = dynamic(() => import("./mdx-body-editor"), {
  ssr: false,
  loading: () => <p className="text-zinc-500">불러오는 중…</p>,
});

/** 이미지를 넣을 수 있는 글이면 글을 연 시점의 doc과 글 폴더 파일 이름. */
export type BodyImageUpload = { doc: MdxDoc; files: string[] };

export function BodyEditor({
  body,
  syntax,
  components,
  upload,
  action,
}: {
  body: string;
  syntax: Syntax;
  components: string[];
  upload: BodyImageUpload | null;
  action: (state: SaveState, data: FormData) => Promise<SaveState>;
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const normalized = useRef<string | null>(null);
  const edited = useRef<string | null>(null);
  const plan = useRef<UploadPlan | null>(upload && { doc: upload.doc, images: [] });
  const [images, setImages] = useState<{ file: string; size: number }[]>([]);
  const [imageProblem, setImageProblem] = useState<string | null>(null);
  const [current, setCurrent] = useState(body);
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
        <p className="text-sm text-amber-600">{problem}</p>
        <pre className="overflow-x-auto rounded border p-3 text-sm whitespace-pre-wrap">{body}</pre>
      </>
    );
  }

  const addImages = async (files: File[]): Promise<string[]> => {
    const tags: string[] = [];
    const problems: string[] = [];
    for (const file of files) {
      const prepared = await prepareImage(file);
      // 이미지를 줄이는 사이 다른 이미지를 넣었을 수 있어 기다린 뒤의 계획을 읽는다.
      const current = plan.current;
      if (!upload || !current) return [];
      const added = prepared ? addUpload(current, prepared, upload.files) : null;
      if (!added?.ok) {
        problems.push(uploadMessage(file.name, added?.problem ?? "format"));
        continue;
      }
      plan.current = added.plan;
      tags.push(added.tag);
    }
    setImages((plan.current?.images ?? []).map(({ file, content }) => ({ file, size: content.byteLength })));
    for (const { name, image } of plan.current ? uploadImports(plan.current) : []) {
      if (!objectUrls.current.has(name)) {
        objectUrls.current.set(name, URL.createObjectURL(new Blob([new Uint8Array(image.content)])));
      }
    }
    setPreviewImages(Object.fromEntries(objectUrls.current));
    setImageProblem(problems.length > 0 ? problems.join(" ") : null);
    return tags;
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = editedBody(body, normalized.current, edited.current);
        const data = new FormData();
        data.set("body", next);
        for (const image of plan.current ? usedUploads(plan.current, next) : []) {
          data.append("image", new File([new Uint8Array(image.content)], image.file));
        }
        startTransition(() => dispatch(data));
      }}
    >
      <MdxBodyEditor
        markdown={body}
        components={components}
        onChange={(markdown, initialMarkdownNormalize) => {
          setCurrent(markdown);
          if (!initialMarkdownNormalize) {
            edited.current = markdown;
            return;
          }
          normalized.current = markdown;
          // 렌더링 구조까지 바뀌는 글은 고치지 않은 곳까지 바꿔 저장하게 되므로 WYSIWYG로 고치지 않는다.
          if (!sameBodyStructure(body, markdown, syntax)) {
            setProblem("WYSIWYG로 열면 글 구조가 바뀌는 글이라 원문 모드에서만 고친다.");
          }
        }}
        onError={(message) => setProblem(`WYSIWYG로 열 수 없는 글이라 원문 모드에서만 고친다: ${message}`)}
        onImages={upload ? addImages : undefined}
      />
      {upload && (
        <p className="text-xs text-zinc-500">
          이미지(png·jpg·webp)는 끌어 놓거나 붙여넣거나 도구 막대의 이미지 버튼으로 넣는다. 긴 변이 {MAX_IMAGE_SIDE}
          px보다 크면 줄여 넣는다.
        </p>
      )}
      {images.length > 0 && (
        <p className="text-xs text-zinc-500">
          넣은 이미지: {images.map(({ file, size }) => `${file} (${Math.ceil(size / 1024)}KB)`).join(", ")}. 본문 저장
          때 글 폴더에 함께 커밋하고, 본문에서 지운 이미지는 올리지 않는다.
        </p>
      )}
      {imageProblem && <p className="text-sm text-red-600">{imageProblem}</p>}
      <BodyPreview markdown={current} syntax={syntax} images={previewImages} />
      <SaveRow label="본문 저장" pending={pending} state={state} unchanged="바뀐 내용이 없어 커밋하지 않았다." />
    </form>
  );
}
