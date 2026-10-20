import {
  addedImageFile,
  addImage,
  findUnusedImageImports,
  readImageImports,
  setBody,
  type MdxDoc,
} from "@/lib/mdx-doc";

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
export function sniffFormat(content: Uint8Array): UploadFormat | null {
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

/** 편집 화면에서 넣은 이미지들과, 그 import를 모두 더한 doc. */
export type UploadPlan = { doc: MdxDoc; images: UploadImage[] };

/**
 * 편집 화면에 이미지 하나를 넣는다. 이름을 고르고 검사한 뒤 본문에 넣을 태그를 돌려준다.
 * @param files 글 폴더에 이미 있는 파일 이름
 */
export function addUpload(
  plan: UploadPlan,
  image: { extension: string; content: Uint8Array },
  files: string[],
): { ok: true; plan: UploadPlan; tag: string; file: string; name: string } | Exclude<UploadCheck, { ok: true }> {
  if (!(Object.values(UPLOAD_IMAGE_TYPES) as string[]).includes(image.extension)) {
    return { ok: false, reason: "image", file: `.${image.extension}`, problem: "format" };
  }
  const added = addImage(plan.doc, { extension: image.extension, component: IMAGE_COMPONENT, files });
  const images = [...plan.images, { file: added.file, content: image.content }];
  const check = checkUploads(images);
  if (!check.ok) return check;
  return { ok: true, plan: { doc: added.doc, images }, tag: added.tag, file: added.file, name: added.name };
}

/** 넣은 이미지 중 저장할 본문에서 쓰는 것. 넣은 뒤 본문에서 지운 이미지는 커밋하지 않는다. */
export function usedUploads(plan: UploadPlan, body: string): UploadImage[] {
  const unused = new Set(findUnusedImageImports(setBody(plan.doc, body)).map((image) => image.path));
  return plan.images.filter((image) => !unused.has(`./${image.file}`));
}

/**
 * 원문 편집에서 넣은 이미지 중 원문이 경로(`"./N.ext"`)로 가리키는 것. 쓰지 않는 import라도 가리키면 올린다.
 * 원문 편집은 import까지 사용자가 고치므로, 가리키는 파일을 빼고 저장하면 사이트에서 글을 만들 수 없다.
 */
export function sourceUploads(images: UploadImage[], source: string): UploadImage[] {
  return images.filter(({ file }) => source.includes(`"./${file}"`) || source.includes(`'./${file}'`));
}

/**
 * 원문 저장에 함께 올릴 이미지를 검사한다. 형식·합계 크기에 더해, 넣을 때 고른 이름(`N.ext`)이고
 * 글 폴더에 없는 파일이어야 하며(기존 파일을 덮어쓰지 않는다) 원문이 가리켜야 한다.
 * @param folder 글 폴더에 이미 있는 파일 이름
 */
export function checkSourceUploads(images: UploadImage[], source: string, folder: string[]): UploadCheck {
  const check = checkUploads(images);
  if (!check.ok) return check;
  const taken = new Set(folder.map((name) => name.toLowerCase()));
  const referenced = new Set(sourceUploads(images, source).map(({ file }) => file));
  for (const { file } of images) {
    if (!addedImageFile(file) || taken.has(file)) return { ok: false, reason: "image", file, problem: "name" };
    if (!referenced.has(file)) return { ok: false, reason: "image", file, problem: "unused" };
    // 같은 이름을 두 번 보내면 나중 것이 앞의 것을 덮어쓰므로 받지 않는다.
    taken.add(file);
  }
  return { ok: true };
}

/** 넣은 이미지마다 본문의 `src={변수}`에 쓰는 import 변수명. 미리보기가 아직 커밋하지 않은 이미지를 보여 줄 때 쓴다. */
export function uploadImports(plan: UploadPlan): { name: string; image: UploadImage }[] {
  const names = new Map(readImageImports(plan.doc).map((image) => [image.path, image.name]));
  return plan.images.flatMap((image) => {
    const name = names.get(`./${image.file}`);
    return name ? [{ name, image }] : [];
  });
}
