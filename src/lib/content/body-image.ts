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
 * 본문은 그 첨부를 넣을 때 정한 변수명(`imageN` ↔ `N.ext`)을 그대로 쓰지만 import가 없다. 그 import를 다시 더해 읽되,
 * 본문이 이미 그 변수명을 써서 본문을 비운 doc에 더한다. `doc`에 이미 있는 import를 가리키면 빠진 첨부가 아니다.
 * @param doc 넣은 이미지의 import까지 더한 doc(`UploadPlan.doc`). 빠진 첨부의 import는 없다.
 * @param missing 복구한 보관본에서 빠진 첨부 이름(`N.ext`).
 */
export function missingBodyImage(
  doc: MdxDoc,
  element: JsxElement,
  missing: string[],
  syntax: Syntax = {},
): MissingBodyImage | null {
  if (missing.length === 0) return null;
  let head = setBody(doc, "");
  for (const file of missing) head = addImageAs(head, file, { component: IMAGE_COMPONENT })?.doc ?? head;
  const image = imageItem(head, printJsxTag(element), syntax);
  const file = image?.path.replace(/^\.\//, "");
  return image && file && missing.includes(file) ? { missing: file, alt: image.alt } : null;
}

/** 복구한 보관본에 파일이 없는 이미지 자리에 사진 대신 보일 안내. */
export const MISSING_DRAFT_IMAGE = "이 이미지는 보관하지 못했어요. 이미지를 다시 골라 주세요.";

/** 편집 화면이 레포 이미지를 받아 갈 라우트 주소. */
export const repoImageHref = (repo: string, postPath: string, importPath: string) =>
  `/repos/${repo}/image?${new URLSearchParams({ post: postPath, src: importPath })}`;
