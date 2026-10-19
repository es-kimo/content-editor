import type { EditorConfig } from "@/lib/editor-config";
import { addImageAs, findUnusedImageImports, setBody, type MdxDoc } from "@/lib/mdx-doc";

import type { GitHubClient } from "./client";
import { commitEdit, currentTitle, openForEdit, type CommitEditResult, type OpenForEditResult } from "./edit-post";
import { checkUploads, IMAGE_COMPONENT, type UploadCheck, type UploadImage } from "./upload";

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

  let doc: MdxDoc = post.doc;
  const files = post.images.map((image) => image.name);
  for (const { file } of images) {
    const added = addImageAs(doc, file, { component: IMAGE_COMPONENT, files });
    if (!added) return { ok: false, reason: "image", file, problem: "name" };
    doc = added.doc;
  }
  const edited = setBody(doc, input.body);
  const unused = findUnusedImageImports(edited).find((image) => images.some(({ file }) => image.path === `./${file}`));
  if (unused) return { ok: false, reason: "image", file: unused.path.slice(2), problem: "unused" };

  return commitEdit(client, repo, config, post, edited, currentTitle(post), images);
}
