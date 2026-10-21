"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";

import { FormBlockedNotice, useFormFlow, useReportPreparing } from "@/app/_lib/unsaved";
import type { DraftAttachment } from "@/lib/content/draft";
// 브라우저 번들에 GitHub 클라이언트가 딸려 오지 않게 content 전체가 아닌 업로드 정책과 세션만 가져온다.
import { UPLOAD_IMAGE_TYPES, uploadImports, type UploadImage, type UploadPlan } from "@/lib/content/upload";
import type { FormArea } from "@/lib/content/save-flow";
import { createUploadSession, type AddedUpload } from "@/lib/content/upload-session";
import type { MdxDoc, PreviewImages } from "@/lib/mdx-doc";

import { prepareImage } from "./prepare-image";
import { IMAGE_ADD_BLOCKED, uploadMessage } from "./upload-message";

type DropTarget = { preventDefault(): void; stopPropagation(): void };

/** 이미지를 넣지 못한 이유. `invalid`는 받은 파일이 틀린 것, `blocked`는 지금 받을 수 없는 것이다. */
type ImageProblem = { kind: "invalid" | "blocked"; message: string };

type ImageUpload = ReturnType<typeof useImageUpload>;

/**
 * 이미지를 넣지 못한 이유를 이미지를 받는 곳 옆에 보인다. 열린 폼 때문이면 다른 동작과 같은 안내를 쓰고, 폼을 닫으면 함께 사라진다.
 * 두 편집기가 모두 떠 있으므로 열린 폼이 있는 영역에만 보인다.
 */
export function ImageProblemNotice({ upload }: { upload: ImageUpload }) {
  const { form } = useFormFlow();
  if (form?.blocked === "image" && form.area === upload.area) return <FormBlockedNotice />;
  const { problem } = upload;
  if (!problem) return null;
  const color = problem.kind === "invalid" ? "text-red-600" : "text-amber-600";
  return <p className={`text-sm ${color}`}>{problem.message}</p>;
}

/**
 * 첨부에 더한 이미지와 크기를 보인다.
 * @param children 저장할 때 첨부를 어떻게 올리는지. 영역마다 무엇을 저장하는지가 달라 영역이 정한다.
 */
export function AttachedImagesNotice({ upload, children }: { upload: ImageUpload; children: ReactNode }) {
  if (upload.attached.length === 0) return null;
  return (
    <p className="text-xs text-zinc-500">
      넣은 이미지: {upload.attached.map(({ file, size }) => `${file} (${Math.ceil(size / 1024)}KB)`).join(", ")}.{" "}
      {children}
    </p>
  );
}

/**
 * 일반 편집과 원문 편집이 같이 쓰는 이미지 받기. 파일 선택·붙여넣기·끌어 놓기로 받은 이미지를 하나 준비해 첨부에 더하고,
 * `onAdded`가 대체 텍스트 폼을 열게 한다. 준비를 시작해 폼이 열릴 때까지 준비 중이고, 그 뒤는 열린 폼이 저장을 막는다.
 * @param area 이미지를 받는 편집 영역. 받은 이미지의 폼도 이 영역에 열린다.
 * @param used 편집 영역의 원문이 참조하는 첨부(`createUploadSession`).
 * @param attachments 다른 모드에서 이어받은 첨부. `doc`은 그 import를 이미 담고 있다.
 * @param onAdded 첨부에 더한 이미지로 폼을 연다. 열지 못하면 false. `opener`는 이미지를 받을 때 초점이 있던 요소다.
 */
export function useImageUpload({
  area,
  doc,
  files,
  used,
  attachments,
  onAdded,
}: {
  area: FormArea;
  doc: MdxDoc;
  files: string[];
  used?: (plan: UploadPlan, text: string) => UploadImage[];
  attachments?: DraftAttachment[];
  onAdded: (image: AddedUpload, opener: HTMLElement | null) => boolean;
}) {
  const forms = useFormFlow();
  // 세션이 준비 중 여부를 바꾸면 이 상태로 다시 그려 첨부 판정과 저장 버튼을 갱신한다.
  const [preparing, setPreparing] = useState(false);
  const [session] = useState(() =>
    createUploadSession<File>({ doc, files, prepare: prepareImage, onPreparing: setPreparing, used, attachments }),
  );
  useReportPreparing(area, preparing);
  const [problem, setProblem] = useState<ImageProblem | null>(null);
  const attachedOf = () => session.plan.images.map(({ file, content }) => ({ file, size: content.byteLength }));
  const [attached, setAttached] = useState(attachedOf);
  const [attachedDoc, setAttachedDoc] = useState(doc);
  // 넣은 이미지는 커밋 전이라 레포 주소가 없으므로 미리보기는 브라우저 안의 주소로 보여 준다.
  const [objectUrls] = useState(() => new Map<string, string>());
  const previewOf = (): PreviewImages => {
    for (const { name, image } of uploadImports(session.plan)) {
      if (!objectUrls.has(name)) objectUrls.set(name, URL.createObjectURL(new Blob([new Uint8Array(image.content)])));
    }
    return Object.fromEntries(objectUrls);
  };
  const [previewImages, setPreviewImages] = useState(previewOf);
  useEffect(() => () => objectUrls.forEach((url) => URL.revokeObjectURL(url)), [objectUrls]);
  // 준비가 끝난 뒤 지금 화면의 상태로 폼을 열도록 마지막으로 그린 `onAdded`를 쓴다.
  const latestOnAdded = useRef(onAdded);
  useEffect(() => {
    latestOnAdded.current = onAdded;
  }, [onAdded]);
  const picker = useRef<HTMLInputElement>(null);
  const pickOpener = useRef<HTMLElement | null>(null);
  const pickAdded = useRef<((image: AddedUpload) => boolean) | null>(null);

  /** @param added 이 파일로 열 폼. 없으면 `onAdded`로 새 이미지 폼을 연다. */
  const add = (selected: File[], opener: HTMLElement | null, added?: ((image: AddedUpload) => boolean) | null) => {
    if (selected.length === 0) return;
    // 막은 기록은 폼을 닫을 때 흐름이 지우므로, 남은 이유가 열린 폼 안내와 겹치지 않게 비운다.
    if (forms.blocks("image")) return setProblem(null);
    // 저장 중에는 입력을 받지 않는다.
    if (!forms.canOpen) return;
    if (session.preparing) return setProblem({ kind: "blocked", message: IMAGE_ADD_BLOCKED.preparing });
    if (selected.length > 1) return setProblem({ kind: "blocked", message: IMAGE_ADD_BLOCKED.many });
    void session.add(selected, ({ images, problems }) => {
      setAttached(attachedOf());
      setAttachedDoc(session.plan.doc);
      setPreviewImages(previewOf());
      setProblem(
        problems.length > 0
          ? { kind: "invalid", message: problems.map((p) => uploadMessage(p.name, p.problem)).join(" ") }
          : null,
      );
      const [image] = images;
      const open = added ?? ((found: AddedUpload) => latestOnAdded.current(found, opener));
      if (image && !open(image)) {
        setProblem({ kind: "blocked", message: IMAGE_ADD_BLOCKED.unopened });
      }
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
    area,
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
    /**
     * `text`를 저장할 때 함께 보낼 첨부. 파일 이름이 `N.ext`인 `image` 파일로 담는다. 준비 중이면 저장하지 않으므로 null.
     * @param text 편집 영역의 원문(일반 편집은 본문, 원문 편집은 파일 전체).
     */
    upload(text: string): FormData | null {
      const submission = session.submission(text);
      if (!submission.ok) return null;
      const data = new FormData();
      for (const image of submission.images) {
        data.append("image", new File([new Uint8Array(image.content)], image.file));
      }
      return data;
    },
    /** `text`가 쓰는 첨부와 그 크기. 모드를 바꿀 때 다른 모드로 넘긴다. 준비 중이면 null. */
    attachments(text: string): DraftAttachment[] | null {
      const submission = session.submission(text);
      if (!submission.ok) return null;
      return submission.images.map((image) => ({ ...image, ...session.sizes.get(image.file) }));
    },
    /**
     * 파일 선택 창을 연다. 고른 이미지의 폼을 닫으면 `opener`로 초점을 돌린다.
     * @param added 고른 파일을 첨부에 더한 뒤 열 폼. 이미지 교체처럼 새 이미지 폼이 아닌 폼을 열 때 준다.
     */
    pick(opener: HTMLElement | null, added?: (image: AddedUpload) => boolean) {
      pickOpener.current = opener;
      pickAdded.current = added ?? null;
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
          add(selected, pickOpener.current, pickAdded.current);
        }}
      />
    ),
  };
}
