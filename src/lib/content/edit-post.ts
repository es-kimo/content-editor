import type { EditorConfig } from "@/lib/editor-config";
import { checkMdx, printMdx, type MdxDoc, type MdxError, type MetadataValue } from "@/lib/mdx-doc";

import type { GitHubClient } from "./client";
import { savePost, type CommitResult } from "./commit";
import { readPost, type Post } from "./read";

export type EditablePost = Post & { doc: Extract<MdxDoc, { ok: true }> };

export type OpenForEditResult =
  | { ok: true; post: EditablePost }
  | { ok: false; reason: "not-found" }
  | Extract<CommitResult, { reason: "changed" }>
  /** 구간으로 나눌 수 없는 글이다. 원문 모드에서만 고친다. */
  | { ok: false; reason: "not-editable"; message: string };

/**
 * 고칠 글을 서버에서 다시 읽는다. 브라우저가 보낸 원문을 믿지 않기 위해서이고, 그래서 바뀌는 곳은 고친 구간뿐이다.
 * 편집 화면을 연 뒤 다른 곳에서 글이 바뀌었으면 고치지 않는다.
 */
export async function openForEdit(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  path: string,
  baseSha: string,
): Promise<OpenForEditResult> {
  const post = await readPost(client, repo, config, path);
  if (!post) return { ok: false, reason: "not-found" };
  if (post.sha !== baseSha) return { ok: false, reason: "changed", path: post.path, expected: baseSha, actual: post.sha };
  if (!post.doc.ok) return { ok: false, reason: "not-editable", message: post.doc.message };
  return { ok: true, post: post as EditablePost };
}

export type CommitEditResult =
  | CommitResult
  | { ok: false; reason: "unchanged" }
  | { ok: false; reason: "compile"; error: MdxError };

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
  const source = printMdx(doc);

  const check = await checkMdx(source, config.syntax);
  if (!check.ok) return { ok: false, reason: "compile", error: check.error };

  return savePost(client, repo, config, {
    path: post.path,
    baseSha: post.sha,
    source,
    title: typeof title === "string" && title.trim() !== "" ? title : (post.params.slug ?? post.path),
  });
}
