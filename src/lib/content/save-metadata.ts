import type { EditorConfig } from "@/lib/editor-config";
import type { GitHubClient } from "@/lib/github";
import { setMetadata } from "@/lib/mdx-doc";
import { applyForm, type FormValues } from "@/lib/metadata-form";

import { commitEdit, openForEdit, type CommitEditResult, type OpenForEditResult } from "./edit-post";

export type SaveMetadataInput = {
  path: string;
  /** 폼을 연 글의 blob sha. 그 사이 글이 바뀌었으면 저장하지 않는다. */
  baseSha: string;
  values: FormValues;
};

export type SaveMetadataResult =
  | CommitEditResult
  | Exclude<OpenForEditResult, { ok: true }>
  /** 폼으로 고칠 수 없는 글이다 (구간으로 나눌 수 없음, metadata 없음, 리터럴이 아닌 식). */
  | { ok: false; reason: "not-editable"; message: string }
  | { ok: false; reason: "invalid"; errors: { key: string; message: string }[] };

/** 메타데이터 폼을 저장한다. 서버에서 다시 읽은 원본에 폼 값을 반영하므로 바뀌는 곳은 metadata 블록뿐이다. */
export async function saveMetadata(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: SaveMetadataInput,
): Promise<SaveMetadataResult> {
  const opened = await openForEdit(client, repo, config, input.path, input.baseSha);
  if (!opened.ok) return opened;
  const { post } = opened;
  if (!post.metadata) return { ok: false, reason: "not-editable", message: "metadata export가 없다" };
  if (!post.metadata.editable) return { ok: false, reason: "not-editable", message: post.metadata.reason };

  const applied = applyForm(post.collection, post.metadata.value, input.values);
  if (!applied.ok) return { ok: false, reason: "invalid", errors: applied.errors };

  return commitEdit(client, repo, config, post, setMetadata(post.doc, applied.value), applied.value.title);
}
