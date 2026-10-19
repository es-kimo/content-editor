import type { EditorConfig } from "@/lib/editor-config";
import { checkMdx, printMdx, setMetadata, type MdxError } from "@/lib/mdx-doc";
import { applyForm, type FormValues } from "@/lib/metadata-form";

import type { GitHubClient } from "./client";
import { savePost, type CommitResult } from "./commit";
import { readPost } from "./read";

export type SaveMetadataInput = {
  path: string;
  /** 폼을 연 글의 blob sha. 그 사이 글이 바뀌었으면 저장하지 않는다. */
  baseSha: string;
  values: FormValues;
};

export type SaveMetadataResult =
  | CommitResult
  | { ok: false; reason: "not-found" }
  /** 폼으로 고칠 수 없는 글이다 (구간으로 나눌 수 없음, metadata 없음, 리터럴이 아닌 식). */
  | { ok: false; reason: "not-editable"; message: string }
  | { ok: false; reason: "invalid"; errors: { key: string; message: string }[] }
  | { ok: false; reason: "unchanged" }
  | { ok: false; reason: "compile"; error: MdxError };

/**
 * 메타데이터 폼을 저장한다. 글은 서버에서 다시 읽어 그 원본에 폼 값을 반영한다.
 * 브라우저가 보낸 원문을 믿지 않기 위해서이고, 그래서 바뀌는 곳은 metadata 블록뿐이다.
 */
export async function saveMetadata(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: SaveMetadataInput,
): Promise<SaveMetadataResult> {
  const post = await readPost(client, repo, config, input.path);
  if (!post) return { ok: false, reason: "not-found" };
  if (post.sha !== input.baseSha) {
    return { ok: false, reason: "changed", path: post.path, expected: input.baseSha, actual: post.sha };
  }
  if (!post.doc.ok) return { ok: false, reason: "not-editable", message: post.doc.message };
  if (!post.metadata) return { ok: false, reason: "not-editable", message: "metadata export가 없다" };
  if (!post.metadata.editable) return { ok: false, reason: "not-editable", message: post.metadata.reason };

  const applied = applyForm(post.collection, post.metadata.value, input.values);
  if (!applied.ok) return { ok: false, reason: "invalid", errors: applied.errors };

  const doc = setMetadata(post.doc, applied.value);
  if (doc === post.doc) return { ok: false, reason: "unchanged" };
  const source = printMdx(doc);

  const check = await checkMdx(source, config.syntax);
  if (!check.ok) return { ok: false, reason: "compile", error: check.error };

  const title = applied.value.title;
  return savePost(client, repo, config, {
    path: post.path,
    baseSha: post.sha,
    source,
    title: typeof title === "string" && title.trim() !== "" ? title : (post.params.slug ?? post.path),
  });
}
