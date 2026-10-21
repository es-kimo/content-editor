// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import {
  addImageAs,
  printJsxTag,
  setBody,
  type JsxElement,
  type MdxDoc,
  type PreviewImages,
  type Syntax,
} from "@/lib/mdx-doc";

import { bodyInserts, type ImageInsertItem } from "./insert-form";
import { IMAGE_COMPONENT } from "./upload";

/** 일반 편집 본문의 이미지 사진을 받아 올 곳. */
export type BodyImageSources = {
  /** 넣은 이미지의 import 변수명 → 브라우저 안 주소. 커밋 전이라 레포 주소가 없다. */
  inserted: PreviewImages;
  /** 저장된 이미지를 읽어 올 글. 새 글은 레포에 저장된 이미지가 없으므로 null. */
  post: { repo: string; path: string } | null;
};

/** 본문 이미지 한 곳을 사진으로 그릴 주소와 대체 텍스트. */
export type BodyImagePhoto = { src: string; alt: string };

/**
 * 일반 편집 본문의 이미지 한 곳을 사진으로 그릴 주소. 폼이 고칠 수 있는 이미지(`bodyInserts`의 image 항목)만 주소가 있다.
 * 넣은 이미지는 브라우저 안 주소를, 저장된 이미지는 글 폴더 기준 import 경로로 레포 이미지 라우트 주소를 쓴다.
 * `src={식}`이거나 import가 없는 변수면 null이고, 화면은 이름과 속성을 그대로 보인다.
 * @param doc 넣은 이미지의 import까지 더한 doc(`UploadPlan.doc`).
 * @param element 편집기가 넘긴 요소. 원문 위치가 없으므로 태그를 다시 써서 삽입 항목과 같은 규칙으로 읽는다.
 */
export function bodyImagePhoto(
  doc: MdxDoc,
  element: JsxElement,
  sources: BodyImageSources,
  syntax: Syntax = {},
): BodyImagePhoto | null {
  const image = imageItem(doc, printJsxTag(element), syntax);
  if (!image) return null;
  const { inserted, post } = sources;
  if (Object.hasOwn(inserted, image.name)) return { src: inserted[image.name]!, alt: image.alt };
  if (!post) return null;
  return { src: repoImageHref(post.repo, post.path, image.path), alt: image.alt };
}

function imageItem(doc: MdxDoc, tag: string, syntax: Syntax): ImageInsertItem | undefined {
  const list = bodyInserts(doc, tag, syntax);
  return list.ok ? list.items.find((item): item is ImageInsertItem => item.kind === "image") : undefined;
}

/** 복구한 보관본에 파일이 없어 사진을 그릴 수 없는 이미지. `missing`은 빠진 첨부 이름이다. */
export type MissingBodyImage = { missing: string; alt: string };

/**
 * 일반 편집 본문의 이미지 한 곳이 복구한 보관본에서 파일이 빠진 첨부를 가리키면 그 첨부 이름과 대체 텍스트.
 * `doc`에 이미 있는 import를 가리키면 빠진 첨부가 아니다.
 * @param doc 넣은 이미지의 import까지 더한 doc(`UploadPlan.doc`). 빠진 첨부의 import는 없다.
 * @param missing 복구한 보관본에서 빠진 첨부 이름(`N.ext`).
 */
export function missingBodyImage(
  doc: MdxDoc,
  element: JsxElement,
  missing: string[],
  syntax: Syntax = {},
): MissingBodyImage | null {
  const head = withMissingImports(doc, missing);
  if (head.added.length === 0) return null;
  const image = imageItem(head.doc, printJsxTag(element), syntax);
  const file = image && missingFile(image, head.added);
  return file ? { missing: file, alt: image.alt } : null;
}

/**
 * 본문이 아직 가리키는 빠진 첨부 이름. 하나라도 있으면 저장하지 않는다. 그대로 저장하면 import 없는 변수를 쓰는 글이 되어
 * 컴파일 검사는 통과해도 사이트가 글을 만들 수 없다.
 * @param doc 넣은 이미지의 import까지 더한 doc(`UploadPlan.doc`).
 * @param body 저장할 본문.
 */
export function missingImagesInBody(doc: MdxDoc, body: string, missing: string[], syntax: Syntax = {}): string[] {
  const head = withMissingImports(doc, missing);
  if (head.added.length === 0) return [];
  const list = bodyInserts(head.doc, body, syntax);
  if (!list.ok) return [];
  const files = list.items.flatMap((item) => (item.kind === "image" ? [missingFile(item, head.added)] : []));
  return [...new Set(files.filter((file) => file !== null))];
}

/**
 * 빠진 첨부의 import를 더한 doc과 더한 첨부 이름. 본문은 그 첨부를 넣을 때 정한 변수명(`imageN` ↔ `N.ext`)을 그대로 쓰지만
 * import가 없어 다시 더해 읽는다. 본문이 이미 그 변수명을 써서 본문을 비운 doc에 더한다. 읽는 데만 쓰고 저장하지 않는다.
 * 다시 고른 이미지가 같은 이름을 받아 import가 이미 있으면 빠진 첨부가 아니므로 더하지 않는다.
 */
function withMissingImports(doc: MdxDoc, missing: string[]): { doc: MdxDoc; added: string[] } {
  let head = setBody(doc, "");
  const added: string[] = [];
  for (const file of missing) {
    const next = addImageAs(head, file, { component: IMAGE_COMPONENT });
    if (!next) continue;
    head = next.doc;
    added.push(file);
  }
  return { doc: head, added };
}

function missingFile(image: ImageInsertItem, added: string[]): string | null {
  const file = image.path.replace(/^\.\//, "");
  return added.includes(file) ? file : null;
}

/** 복구한 보관본에 파일이 없는 이미지 자리에 사진 대신 보일 안내. */
export const MISSING_DRAFT_IMAGE = "이 이미지는 보관하지 못했어요. 이미지를 다시 골라 주세요.";

/** 본문이 빠진 첨부(`missingImagesInBody`)를 가리켜 저장하지 않았을 때 본문 옆에 보일 이유와 할 일. */
export function missingImagesSaveMessage(files: string[]): string {
  return (
    `보관하지 못한 이미지(${files.join(", ")})가 본문에 남아 있어 저장하지 않았어요. ` +
    "이미지를 다시 넣고, 다시 고르라는 안내가 보이는 자리는 지워 주세요."
  );
}

/** 편집 화면이 레포 이미지를 받아 갈 라우트 주소. */
export const repoImageHref = (repo: string, postPath: string, importPath: string) =>
  `/repos/${repo}/image?${new URLSearchParams({ post: postPath, src: importPath })}`;
