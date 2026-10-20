"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import { useFormFlow } from "@/app/_lib/unsaved";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 업로드 정책과 세션만 가져온다.
import { UPLOAD_IMAGE_TYPES, uploadImports, type UploadImage, type UploadPlan } from "@/lib/content/upload";
import { createUploadSession, type AddedUpload } from "@/lib/content/upload-session";
import type { MdxDoc, PreviewImages } from "@/lib/mdx-doc";

import { prepareImage } from "./prepare-image";
import { IMAGE_ADD_BLOCKED, uploadMessage } from "./upload-message";

type DropTarget = { preventDefault(): void; stopPropagation(): void };

/**
 * 일반 편집과 원문 편집이 같이 쓰는 이미지 받기. 파일 선택·붙여넣기·끌어 놓기로 받은 이미지를 하나 준비해 첨부에 더하고,
 * `onAdded`가 대체 텍스트 폼을 열게 한다. 준비를 시작해 폼이 열릴 때까지 준비 중이고, 그 뒤는 열린 폼이 저장을 막는다.
 * @param used 편집 영역의 원문이 참조하는 첨부(`createUploadSession`).
 * @param onAdded 첨부에 더한 이미지로 폼을 연다. 열지 못하면 false. `opener`는 이미지를 받을 때 초점이 있던 요소다.
 */
export function useImageUpload({
  doc,
  files,
  used,
  onAdded,
}: {
  doc: MdxDoc;
  files: string[];
  used?: (plan: UploadPlan, text: string) => UploadImage[];
  onAdded: (image: AddedUpload, opener: HTMLElement | null) => boolean;
}) {
  const forms = useFormFlow();
  // 세션이 준비 중 여부를 바꾸면 이 상태로 다시 그려 첨부 판정과 저장 버튼을 갱신한다.
  const [preparing, setPreparing] = useState(false);
  const [session] = useState(() =>
    createUploadSession<File>({ doc, files, prepare: prepareImage, onPreparing: setPreparing, used }),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [attached, setAttached] = useState<{ file: string; size: number }[]>([]);
  const [attachedDoc, setAttachedDoc] = useState(doc);
  // 넣은 이미지는 커밋 전이라 레포 주소가 없으므로 미리보기는 브라우저 안의 주소로 보여 준다.
  const objectUrls = useRef(new Map<string, string>());
  const [previewImages, setPreviewImages] = useState<PreviewImages>({});
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  // 준비가 끝난 뒤 지금 화면의 상태로 폼을 열도록 마지막으로 그린 `onAdded`를 쓴다.
  const latestOnAdded = useRef(onAdded);
  useEffect(() => {
    latestOnAdded.current = onAdded;
  }, [onAdded]);
  const picker = useRef<HTMLInputElement>(null);
  const pickOpener = useRef<HTMLElement | null>(null);

  const add = (selected: File[], opener: HTMLElement | null) => {
    if (selected.length === 0) return;
    if (forms.form) return setProblem(IMAGE_ADD_BLOCKED.form);
    // 저장 중이거나 다른 영역 입력을 버릴지 묻는 중에는 입력을 받지 않는다.
    if (!forms.canOpen) return;
    if (session.preparing) return setProblem(IMAGE_ADD_BLOCKED.preparing);
    if (selected.length > 1) return setProblem(IMAGE_ADD_BLOCKED.many);
    void session.add(selected, ({ images, problems }) => {
      setAttached(session.plan.images.map(({ file, content }) => ({ file, size: content.byteLength })));
      setAttachedDoc(session.plan.doc);
      for (const { name, image } of uploadImports(session.plan)) {
        if (!objectUrls.current.has(name)) {
          objectUrls.current.set(name, URL.createObjectURL(new Blob([new Uint8Array(image.content)])));
        }
      }
      setPreviewImages(Object.fromEntries(objectUrls.current));
      setProblem(problems.length > 0 ? problems.map((p) => uploadMessage(p.name, p.problem)).join(" ") : null);
      const [image] = images;
      if (image && !latestOnAdded.current(image, opener)) setProblem(IMAGE_ADD_BLOCKED.unopened);
    });
  };

  // 파일을 놓거나 붙여넣으면 편집기가 처리하기 전에 가로챈다. 그대로 두면 브라우저가 파일을 열거나 편집기가 무시한다.
  const take = (event: DropTarget, data: DataTransfer | null) => {
    const selected = [...(data?.files ?? [])];
    if (selected.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    add(selected, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  };

  return {
    session,
    preparing,
    /** 넣지 못한 이유. 이미지를 받는 곳 옆에 보인다. */
    problem,
    /** 첨부에 더한 이미지와 바이트 크기. */
    attached,
    /** 글을 연 doc에 첨부한 이미지의 import를 더한 것. 일반 편집이 넣은 이미지까지 본문 이미지로 읽는 데 쓴다. */
    doc: attachedDoc,
    /** 넣은 이미지의 import 변수명 → 브라우저 안 주소. */
    previewImages,
    /** 파일 선택 창을 연다. 고른 이미지의 폼을 닫으면 `opener`로 초점을 돌린다. */
    pick(opener: HTMLElement | null) {
      pickOpener.current = opener;
      picker.current?.click();
    },
    /** 이미지를 받는 편집기를 감싸는 요소에 붙인다. */
    dropProps: {
      onPasteCapture: (event: ClipboardEvent) => take(event, event.clipboardData),
      onDragOverCapture: (event: DragEvent) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      },
      onDropCapture: (event: DragEvent) => take(event, event.dataTransfer),
    },
    picker: (
      <input
        ref={picker}
        type="file"
        accept={Object.keys(UPLOAD_IMAGE_TYPES).join(",")}
        hidden
        onChange={(event) => {
          const selected = [...(event.target.files ?? [])];
          // 같은 파일을 다시 골라도 change가 일어나게 비운다.
          event.target.value = "";
          add(selected, pickOpener.current);
        }}
      />
    ),
  };
}
