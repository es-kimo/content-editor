import { findUnusedImageImports, setBody, type MdxDoc } from "@/lib/mdx-doc";

/** 본문에 넣는 이미지 컴포넌트. 사이트가 MDX 컴포넌트로 전역 등록해 두어 import하지 않는다. */
export const IMAGE_COMPONENT = "Image";

/** 업로드를 받는 형식과 그 파일 확장자. 사진·스크린샷에 쓰는 래스터 형식만 받는다. */
export const UPLOAD_IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

type UploadFormat = keyof typeof UPLOAD_IMAGE_TYPES;

/**
 * 저장 1번에 올리는 이미지 합계 상한. 서버 액션 요청 본문 상한(`next.config.ts`)과
 * Vercel 함수 요청 상한(4.5MB) 안에 본문 원문까지 들어가야 한다.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** 긴 변이 이보다 큰 이미지는 브라우저에서 줄여 올린다. 본문 폭에 고해상도 화면 2배를 더해도 남는 크기다. */
export const MAX_IMAGE_SIDE = 2000;

/** 글 폴더에 함께 커밋할 이미지. `file`은 `addImage`가 고른 파일 이름(`N.ext`)이다. */
export type UploadImage = { file: string; content: Uint8Array };

export type UploadProblem =
  /** png·jpg·webp가 아니거나 확장자와 내용의 형식이 다르다. */
  | "format"
  /** 합계가 `MAX_UPLOAD_BYTES`를 넘는다. */
  | "size"
  /** 파일 이름의 번호를 글이 이미 쓰고 있다. */
  | "name"
  /** 본문에서 쓰지 않는 이미지다. */
  | "unused";

export type UploadCheck = { ok: true } | { ok: false; reason: "image"; file: string; problem: UploadProblem };

/** 브라우저가 알려 준 MIME 형식의 파일 확장자. 받지 않는 형식이면 null. */
export function uploadExtension(mimeType: string): string | null {
  return Object.hasOwn(UPLOAD_IMAGE_TYPES, mimeType) ? UPLOAD_IMAGE_TYPES[mimeType as UploadFormat] : null;
}

/** 확장자와 맞는 형식인지 파일 앞 바이트로 본다. 브라우저가 보낸 MIME 형식이나 이름은 믿지 않는다. */
function sniffFormat(content: Uint8Array): UploadFormat | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...content.subarray(start, end));
  if (content[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** 올릴 이미지의 형식과 합계 크기를 검사한다. 브라우저와 서버가 같은 검사를 한다. */
export function checkUploads(images: UploadImage[]): UploadCheck {
  let total = 0;
  for (const { file, content } of images) {
    const format = sniffFormat(content);
    const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
    const expected = format && UPLOAD_IMAGE_TYPES[format];
    if (!expected || (extension !== expected && !(expected === "jpg" && extension === "jpeg"))) {
      return { ok: false, reason: "image", file, problem: "format" };
    }
    total += content.byteLength;
    if (total > MAX_UPLOAD_BYTES) return { ok: false, reason: "image", file, problem: "size" };
  }
  return { ok: true };
}

/** 긴 변을 `max`로 줄인 크기. 줄일 필요가 없으면 null. */
export function fitImageSize(
  width: number,
  height: number,
  max = MAX_IMAGE_SIDE,
): { width: number; height: number } | null {
  const scale = max / Math.max(width, height);
  if (scale >= 1) return null;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 올려 둔 이미지 중 저장할 본문에서 쓰는 것. 올린 뒤 본문에서 지운 이미지는 커밋하지 않는다.
 * @param doc 올린 이미지의 import를 모두 더한 doc
 */
export function usedUploads<T extends { file: string }>(doc: MdxDoc, body: string, uploads: T[]): T[] {
  const unused = new Set(findUnusedImageImports(setBody(doc, body)).map((image) => image.path));
  return uploads.filter((upload) => !unused.has(`./${upload.file}`));
}
