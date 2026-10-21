// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import { printJsxTag, type JsxElement, type MdxDoc, type PreviewImages, type Syntax } from "@/lib/mdx-doc";

import { bodyInserts, type ImageInsertItem } from "./insert-form";

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
  const list = bodyInserts(doc, printJsxTag(element), syntax);
  const image = list.ok ? list.items.find((item): item is ImageInsertItem => item.kind === "image") : undefined;
  if (!image) return null;
  const { inserted, post } = sources;
  if (Object.hasOwn(inserted, image.name)) return { src: inserted[image.name]!, alt: image.alt };
  if (!post) return null;
  return { src: repoImageHref(post.repo, post.path, image.path), alt: image.alt };
}

/** 편집 화면이 레포 이미지를 받아 갈 라우트 주소. */
export const repoImageHref = (repo: string, postPath: string, importPath: string) =>
  `/repos/${repo}/image?${new URLSearchParams({ post: postPath, src: importPath })}`;
