import type { EditorConfig } from "@/lib/editor-config";
import type { GitHubClient } from "@/lib/github";
import {
  addImageAs,
  checkMdx,
  findUnusedImageImports,
  printMdx,
  setBody,
  type MdxDoc,
  type MdxError,
  type MetadataValue,
} from "@/lib/mdx-doc";
import {
  applyForm,
  REQUIRED_MESSAGE,
  TITLE_FIELD,
  type FormValues,
  type MetadataObject,
  type PostAction,
} from "@/lib/metadata-form";

import { savePost, type CommitResult } from "./commit";
import { readPost, type Post } from "./read";
import { BODY_FIELD } from "./save-flow";
import { IMAGE_COMPONENT, type UploadCheck, type UploadImage } from "./upload";

export type EditablePost = Post & { doc: Extract<MdxDoc, { ok: true }> };

export type OpenPostResult =
  { ok: true; post: Post } | { ok: false; reason: "not-found" } | Extract<CommitResult, { reason: "changed" }>;

export type OpenForEditResult =
  | { ok: true; post: EditablePost }
  | Exclude<OpenPostResult, { ok: true }>
  /** 구간으로 나눌 수 없는 글이다. 원문 모드에서만 고친다. */
  | { ok: false; reason: "not-editable"; message: string };

/**
 * 고칠 글을 서버에서 다시 읽는다. 브라우저가 보낸 원문을 믿지 않기 위해서이고, 그래서 바뀌는 곳은 고친 곳뿐이다.
 * 편집 화면을 연 뒤 다른 곳에서 글이 바뀌었으면 고치지 않는다.
 */
export async function openPost(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  path: string,
  baseSha: string,
): Promise<OpenPostResult> {
  const post = await readPost(client, repo, config, path);
  if (!post) return { ok: false, reason: "not-found" };
  if (post.sha !== baseSha)
    return { ok: false, reason: "changed", path: post.path, expected: baseSha, actual: post.sha };
  return { ok: true, post };
}

/** `openPost`에 더해 구간으로 나눌 수 있는 글만 연다. 구간 하나만 고치는 저장이 쓴다. */
export async function openForEdit(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  path: string,
  baseSha: string,
): Promise<OpenForEditResult> {
  const opened = await openPost(client, repo, config, path, baseSha);
  if (!opened.ok) return opened;
  if (!opened.post.doc.ok) return { ok: false, reason: "not-editable", message: opened.post.doc.message };
  return { ok: true, post: opened.post as EditablePost };
}

export type MetadataFormResult =
  | { ok: true; value: MetadataObject }
  /** 폼으로 고칠 수 없는 글이다 (metadata 없음, 리터럴이 아닌 식). */
  | { ok: false; reason: "not-editable"; message: string }
  | { ok: false; reason: "invalid"; errors: { key: string; message: string }[] };

/** 서버에서 다시 읽은 글의 metadata에 폼 값을 반영한다. 폼에 없는 키와 키 순서는 원본 그대로다. */
export function applyMetadataForm(post: EditablePost, values: FormValues): MetadataFormResult {
  if (!post.metadata) return { ok: false, reason: "not-editable", message: "metadata export가 없다" };
  if (!post.metadata.editable) return { ok: false, reason: "not-editable", message: post.metadata.reason };
  const applied = applyForm(post.collection, post.metadata.value, values);
  return applied.ok ? applied : { ok: false, reason: "invalid", errors: applied.errors };
}

/**
 * `doc`의 본문을 `body`로 바꾸고 새 이미지의 import를 더한다. import·metadata는 `doc` 그대로 남는다.
 * 본문이 쓰지 않는 새 이미지는 커밋하지 않도록 실패로 돌려준다.
 * @param post 글 폴더에 이미 있는 이미지. 새 이미지 이름이 그 번호를 쓰지 않게 한다. 새 글은 `{ images: [] }`.
 */
export function editBody(
  post: Pick<Post, "images">,
  doc: MdxDoc,
  body: string,
  images: UploadImage[],
): { ok: true; doc: MdxDoc } | Exclude<UploadCheck, { ok: true }> {
  const files = post.images.map((image) => image.name);
  for (const { file } of images) {
    const added = addImageAs(doc, file, { component: IMAGE_COMPONENT, files });
    if (!added) return { ok: false, reason: "image", file, problem: "name" };
    doc = added.doc;
  }
  const edited = setBody(doc, body);
  const unused = findUnusedImageImports(edited).find((image) => images.some(({ file }) => image.path === `./${file}`));
  if (unused) return { ok: false, reason: "image", file: unused.path.slice(2), problem: "unused" };
  return { ok: true, doc: edited };
}

/**
 * 폼 해석 오류에 필수 값 오류를 더한다. 제목은 내용을 저장하는 행동에 모두 필요하다.
 * 본문은 게시 대상이 되는 행동에만 필요하고, 이미지 태그만 있어도 비어 있지 않다.
 * 게시 내리기는 상태만 바꾸므로 이미 저장된 제목·본문을 다시 따지지 않는다.
 */
export function withRequired(
  errors: { key: string; message: string }[],
  action: PostAction,
  title: MetadataValue | undefined,
  body: string,
): { key: string; message: string }[] {
  const missing = [...errors];
  if (action === "unpublish") return missing;
  const has = (key: string) => missing.some((error) => error.key === key);
  if (!has(TITLE_FIELD) && (typeof title !== "string" || title.trim() === "")) {
    missing.push({ key: TITLE_FIELD, message: REQUIRED_MESSAGE });
  }
  if ((action === "publish" || action === "update") && body.trim() === "") {
    missing.push({ key: BODY_FIELD, message: REQUIRED_MESSAGE });
  }
  return missing;
}

export type CommitEditResult =
  CommitResult | { ok: false; reason: "unchanged" } | { ok: false; reason: "compile"; error: MdxError };

/** 고친 doc을 컴파일 검사한 뒤 `images`와 함께 커밋한다. doc이 원래 doc 그대로면 커밋하지 않는다. */
export async function commitEdit(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  post: EditablePost,
  doc: MdxDoc,
  title: MetadataValue | undefined,
  images: UploadImage[] = [],
): Promise<CommitEditResult> {
  if (doc === post.doc) return { ok: false, reason: "unchanged" };
  return commitSource(client, repo, config, post, printMdx(doc), title, images);
}

/** 글을 연 시점의 metadata 제목. metadata를 고치지 않는 저장이 커밋 제목에 쓴다. */
export function currentTitle(post: Post): MetadataValue | undefined {
  return post.metadata?.editable ? post.metadata.value.title : undefined;
}

/** 고친 원문 전체를 컴파일 검사한 뒤 `images`와 함께 커밋한다. 원래 원문과 같으면 커밋하지 않는다. */
export async function commitSource(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  post: Post,
  source: string,
  title: MetadataValue | undefined,
  images: UploadImage[] = [],
): Promise<CommitEditResult> {
  if (source === post.source) return { ok: false, reason: "unchanged" };

  const check = await checkMdx(source, config.syntax);
  if (!check.ok) return { ok: false, reason: "compile", error: check.error };

  return savePost(client, repo, config, {
    path: post.path,
    baseSha: post.sha,
    source,
    title: typeof title === "string" && title.trim() !== "" ? title : (post.params.slug ?? post.path),
    images: images.map(({ file, content }) => ({ name: file, content })),
  });
}
