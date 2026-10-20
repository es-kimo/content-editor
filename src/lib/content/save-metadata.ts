import type { EditorConfig } from "@/lib/editor-config";
import type { GitHubClient } from "@/lib/github";
import { setMetadata } from "@/lib/mdx-doc";
import type { FormValues } from "@/lib/metadata-form";

import {
  applyMetadataForm,
  commitEdit,
  openForEdit,
  type CommitEditResult,
  type MetadataFormResult,
  type OpenForEditResult,
} from "./edit-post";

export type SaveMetadataInput = {
  path: string;
  /** 폼을 연 글의 blob sha. 그 사이 글이 바뀌었으면 저장하지 않는다. */
  baseSha: string;
  values: FormValues;
};

export type SaveMetadataResult =
  CommitEditResult | Exclude<OpenForEditResult, { ok: true }> | Exclude<MetadataFormResult, { ok: true }>;

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

  const applied = applyMetadataForm(post, input.values);
  if (!applied.ok) return applied;

  return commitEdit(client, repo, config, post, setMetadata(post.doc, applied.value), applied.value.title);
}
