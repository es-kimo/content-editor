import type { EditorConfig } from "@/lib/editor-config";
import type { GitHubClient } from "@/lib/github";
import { setMetadata } from "@/lib/mdx-doc";
import {
  readStatus,
  readTrash,
  statusSupport,
  withoutTrash,
  withTrash,
  type MetadataObject,
  type StatusProblem,
} from "@/lib/metadata-form";

import { commitEdit, openForEdit, type CommitEditResult, type OpenForEditResult } from "./edit-post";

export type TrashInput = {
  path: string;
  /** 휴지통으로 옮기거나 복구하려고 연 글의 blob sha. 그 사이 글이 바뀌었으면 커밋하지 않는다. */
  baseSha: string;
};

/** `unchanged`는 이미 휴지통에 있는 글을 옮기거나 휴지통에 없는 글을 복구하려 했다는 뜻이다. 커밋하지 않는다. */
export type TrashResult =
  | CommitEditResult
  | Exclude<OpenForEditResult, { ok: true }>
  /** 설정이나 글의 상태를 다룰 수 없다. */
  | { ok: false; reason: Exclude<StatusProblem, "action"> };

/**
 * 글을 휴지통으로 옮긴다. 파일은 지우지 않고 metadata의 상태를 `draft`로, `other.trashedAt`을 `now`로 둔 커밋 하나를 만든다.
 * 서버에서 다시 읽은 원본에 반영하므로 바뀌는 곳은 metadata의 두 키뿐이다.
 */
export function trashPost(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: TrashInput,
  now: Date,
): Promise<TrashResult> {
  return changeTrash(client, repo, config, input, true, (metadata) => withTrash(metadata, now));
}

/** 휴지통 글을 복구한다. `other.trashedAt`을 빼고, 옮기기 전에 게시 대상이었어도 자동으로 다시 게시하지 않게 `draft`로 둔다. */
export function restorePost(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: TrashInput,
): Promise<TrashResult> {
  return changeTrash(client, repo, config, input, false, withoutTrash);
}

async function changeTrash(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: TrashInput,
  trash: boolean,
  change: (metadata: MetadataObject) => MetadataObject | null,
): Promise<TrashResult> {
  const opened = await openForEdit(client, repo, config, input.path, input.baseSha);
  if (!opened.ok) return opened;
  const { post } = opened;
  const support = statusSupport(post.collection);
  if (!support.ok) return support;
  // 상태를 읽을 수 없는 글은 옮기거나 꺼낸 뒤 상태가 무엇인지 보장할 수 없다.
  const metadata = post.metadata?.editable ? post.metadata.value : null;
  if (!metadata || readStatus(metadata) === null) return { ok: false, reason: "status-value" };
  if (readTrash(metadata).trashed === trash) return { ok: false, reason: "unchanged" };

  const next = change(metadata);
  if (!next) return { ok: false, reason: "status-value" };
  return commitEdit(client, repo, config, post, setMetadata(post.doc, next), metadata.title);
}
