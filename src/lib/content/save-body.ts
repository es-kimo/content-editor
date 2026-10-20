import type { EditorConfig } from "@/lib/editor-config";
import type { GitHubClient } from "@/lib/github";

import {
  commitEdit,
  currentTitle,
  editBody,
  openForEdit,
  type CommitEditResult,
  type OpenForEditResult,
} from "./edit-post";
import { checkUploads, type UploadCheck, type UploadImage } from "./upload";

export type SaveBodyInput = {
  path: string;
  /** 편집 화면을 연 글의 blob sha. 그 사이 글이 바뀌었으면 저장하지 않는다. */
  baseSha: string;
  body: string;
  /** 본문에 넣은 새 이미지. 글 폴더에 저장하고 import를 더해 같은 커밋에 담는다. */
  images?: UploadImage[];
};

export type SaveBodyResult =
  CommitEditResult | Exclude<OpenForEditResult, { ok: true }> | Exclude<UploadCheck, { ok: true }>;

/**
 * 본문을 저장한다. 서버에서 다시 읽은 원본의 본문 구간만 바꾸므로 import·metadata는 원본 그대로 남는다.
 * 새 이미지가 있으면 그 import만 더한다.
 */
export async function saveBody(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: SaveBodyInput,
): Promise<SaveBodyResult> {
  const images = input.images ?? [];
  const check = checkUploads(images);
  if (!check.ok) return check;

  const opened = await openForEdit(client, repo, config, input.path, input.baseSha);
  if (!opened.ok) return opened;
  const { post } = opened;

  const edited = editBody(post, post.doc, input.body, images);
  if (!edited.ok) return edited;

  return commitEdit(client, repo, config, post, edited.doc, currentTitle(post), images);
}
