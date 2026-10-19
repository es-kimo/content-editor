import type { EditorConfig } from "@/lib/editor-config";
import { setBody } from "@/lib/mdx-doc";

import type { GitHubClient } from "./client";
import { commitEdit, currentTitle, openForEdit, type CommitEditResult, type OpenForEditResult } from "./edit-post";

export type SaveBodyInput = {
  path: string;
  /** 편집 화면을 연 글의 blob sha. 그 사이 글이 바뀌었으면 저장하지 않는다. */
  baseSha: string;
  body: string;
};

export type SaveBodyResult = CommitEditResult | Exclude<OpenForEditResult, { ok: true }>;

/** 본문을 저장한다. 서버에서 다시 읽은 원본의 본문 구간만 바꾸므로 import·metadata는 원본 그대로 남는다. */
export async function saveBody(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: SaveBodyInput,
): Promise<SaveBodyResult> {
  const opened = await openForEdit(client, repo, config, input.path, input.baseSha);
  if (!opened.ok) return opened;
  const { post } = opened;
  return commitEdit(client, repo, config, post, setBody(post.doc, input.body), currentTitle(post));
}
