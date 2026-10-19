import type { EditorConfig } from "@/lib/editor-config";

import type { GitHubClient } from "./client";
import { commitSource, currentTitle, openPost, type CommitEditResult, type OpenPostResult } from "./edit-post";

export type SaveSourceInput = {
  path: string;
  /** 원문 모드를 연 글의 blob sha. 그 사이 글이 바뀌었으면 저장하지 않는다. */
  baseSha: string;
  /** 파일 전체 원문. import·metadata 같은 ESM도 포함한다. */
  source: string;
};

export type SaveSourceResult = CommitEditResult | Exclude<OpenPostResult, { ok: true }>;

/**
 * 원문 모드에서 고친 파일 전체를 저장한다. 구간으로 나눌 수 없는 글이나 metadata를 폼으로 읽을 수 없는 글도 저장할 수 있다.
 * 커밋 제목은 고치기 전 글의 제목이다. 원문 안의 metadata는 리터럴이 아닐 수 있어 고친 원문에서 읽지 않는다.
 */
export async function saveSource(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: SaveSourceInput,
): Promise<SaveSourceResult> {
  const opened = await openPost(client, repo, config, input.path, input.baseSha);
  if (!opened.ok) return opened;
  return commitSource(client, repo, config, opened.post, input.source, currentTitle(opened.post));
}
