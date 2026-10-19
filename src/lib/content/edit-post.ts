import type { EditorConfig } from "@/lib/editor-config";
import { checkMdx, printMdx, type MdxDoc, type MdxError, type MetadataValue } from "@/lib/mdx-doc";

import type { GitHubClient } from "./client";
import { savePost, type CommitResult } from "./commit";
import { readPost, type Post } from "./read";

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

export type CommitEditResult =
  CommitResult | { ok: false; reason: "unchanged" } | { ok: false; reason: "compile"; error: MdxError };

/** 고친 doc을 컴파일 검사한 뒤 커밋한다. doc이 원래 doc 그대로면 커밋하지 않는다. */
export async function commitEdit(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  post: EditablePost,
  doc: MdxDoc,
  title: MetadataValue | undefined,
): Promise<CommitEditResult> {
  if (doc === post.doc) return { ok: false, reason: "unchanged" };
  return commitSource(client, repo, config, post, printMdx(doc), title);
}

/** 글을 연 시점의 metadata 제목. metadata를 고치지 않는 저장이 커밋 제목에 쓴다. */
export function currentTitle(post: Post): MetadataValue | undefined {
  return post.metadata?.editable ? post.metadata.value.title : undefined;
}

/** 고친 원문 전체를 컴파일 검사한 뒤 커밋한다. 원래 원문과 같으면 커밋하지 않는다. */
export async function commitSource(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  post: Post,
  source: string,
  title: MetadataValue | undefined,
): Promise<CommitEditResult> {
  if (source === post.source) return { ok: false, reason: "unchanged" };

  const check = await checkMdx(source, config.syntax);
  if (!check.ok) return { ok: false, reason: "compile", error: check.error };

  return savePost(client, repo, config, {
    path: post.path,
    baseSha: post.sha,
    source,
    title: typeof title === "string" && title.trim() !== "" ? title : (post.params.slug ?? post.path),
  });
}
