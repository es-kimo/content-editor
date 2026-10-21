// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { MdxDoc } from "@/lib/mdx-doc";

import type { DraftAttachment } from "./draft";
import { addUpload, usedUploads, type UploadImage, type UploadPlan, type UploadProblem } from "./upload";

/** 올릴 바이트로 만든 이미지. 가로·세로는 올릴 이미지의 크기다. */
export type PreparedImage = { extension: string; content: Uint8Array; width: number; height: number };

/** 첨부에 더한 이미지. `file`은 글 폴더에 저장할 파일 이름(`N.ext`), `name`은 태그의 `src`에 쓸 import 변수명이다. */
export type AddedUpload = { file: string; name: string };

/** 한 번에 넣은 파일들의 결과. `images`는 첨부에 더한 이미지, `problems`는 넣지 않은 파일과 그 이유다. */
export type AddedUploads = { images: AddedUpload[]; problems: { name: string; problem: UploadProblem }[] };

export type UploadSubmission = { ok: true; images: UploadImage[] } | { ok: false; reason: "preparing" };

export type UploadSession<F extends { name: string }> = {
  readonly plan: UploadPlan;
  /** 넣은 이미지 파일 이름 → 가로·세로. 사이트 미리보기가 이미지 자리를 잡는 데 쓴다. */
  readonly sizes: ReadonlyMap<string, { width: number; height: number }>;
  /** 준비를 시작해 본문에 넣기까지 끝나지 않은 작업이 하나라도 있는지. */
  readonly preparing: boolean;
  /**
   * 파일을 차례로 준비해 계획에 더하고 `insert`로 편집 영역에 넣게 한다. `insert`가 끝날 때까지 준비 중으로 둔다.
   * 준비하지 못한 파일은 계획을 바꾸지 않고 `problems`에만 남는다.
   */
  add(files: F[], insert: (added: AddedUploads) => void): Promise<void>;
  /** 준비 중이거나 `text`(편집 영역의 원문)가 참조하는 미커밋 이미지가 있으면 저장하지 않은 첨부가 있다. */
  unsaved(text: string): boolean;
  /** `text`를 저장할 때 함께 올릴 이미지. 준비 중이면 저장하지 않는다. */
  submission(text: string): UploadSubmission;
  /** 준비가 끝난 첨부 중 `text`가 참조하는 것. 준비 중인 이미지는 아직 계획에 없어 들지 않는다. */
  attached(text: string): UploadImage[];
};

/**
 * 글 하나의 편집 화면에서 넣는 이미지를 모은다.
 * @param files 글 폴더에 이미 있는 파일 이름
 * @param prepare 파일을 올릴 바이트로 만든다. 받지 않는 형식이거나 읽을 수 없으면 null을 돌려주거나 던진다.
 * @param onPreparing 준비 중 여부가 바뀔 때 부른다.
 * @param used 편집 영역의 원문이 참조하는 첨부. 일반 편집은 본문으로(`usedUploads`), 원문 편집은 파일 전체로 판정한다.
 * @param attachments 다른 모드에서 이어받아 처음부터 든 첨부. `doc`은 이 첨부의 import를 이미 담고 있어야 한다.
 */
export function createUploadSession<F extends { name: string }>({
  doc,
  files,
  prepare,
  onPreparing,
  used = usedUploads,
  attachments = [],
}: {
  doc: MdxDoc;
  files: string[];
  prepare: (file: F) => Promise<PreparedImage | null>;
  onPreparing?: (preparing: boolean) => void;
  used?: (plan: UploadPlan, text: string) => UploadImage[];
  attachments?: DraftAttachment[];
}): UploadSession<F> {
  let plan: UploadPlan = { doc, images: attachments.map(({ file, content }) => ({ file, content })) };
  const sizes = new Map<string, { width: number; height: number }>();
  for (const { file, width, height } of attachments) {
    if (width !== undefined && height !== undefined) sizes.set(file, { width, height });
  }
  // 여러 번 넣은 작업이 겹칠 수 있어, 먼저 끝난 작업이 준비 중 상태를 풀지 않게 개수로 센다.
  let running = 0;

  const prepareOrNull = async (file: F) => {
    try {
      return await prepare(file);
    } catch {
      return null;
    }
  };

  return {
    get plan() {
      return plan;
    },
    sizes,
    get preparing() {
      return running > 0;
    },
    async add(selected, insert) {
      running += 1;
      if (running === 1) onPreparing?.(true);
      try {
        const added: AddedUploads = { images: [], problems: [] };
        for (const file of selected) {
          const prepared = await prepareOrNull(file);
          if (!prepared) {
            added.problems.push({ name: file.name, problem: "format" });
            continue;
          }
          // 이미지를 준비하는 사이 다른 작업이 이미지를 넣었을 수 있어 기다린 뒤의 계획에 더한다.
          const result = addUpload(plan, prepared, files);
          if (!result.ok) {
            added.problems.push({ name: file.name, problem: result.problem });
            continue;
          }
          plan = result.plan;
          sizes.set(result.file, { width: prepared.width, height: prepared.height });
          added.images.push({ file: result.file, name: result.name });
        }
        insert(added);
      } finally {
        running -= 1;
        if (running === 0) onPreparing?.(false);
      }
    },
    unsaved(text) {
      // 화면이 입력할 때마다 부르므로 넣은 이미지가 없으면 원문을 읽지 않는다.
      return running > 0 || (plan.images.length > 0 && used(plan, text).length > 0);
    },
    submission(text) {
      if (running > 0) return { ok: false, reason: "preparing" };
      return { ok: true, images: used(plan, text) };
    },
    attached(text) {
      return plan.images.length > 0 ? used(plan, text) : [];
    },
  };
}
