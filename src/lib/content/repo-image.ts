import type { EditorConfig } from "@/lib/editor-config";
import type { GitHubClient } from "@/lib/github";
import { imageContentType } from "@/lib/mdx-doc";

import { readDirFile } from "./contents";
import { findCollection } from "./read";

/** 레포 이미지를 읽지 못한 이유. `outside-repo`는 import 경로가 레포 루트를 넘거나 글 폴더 기준 상대 경로가 아닌 것이다. */
export type RepoImageProblem = "not-post" | "not-image" | "outside-repo" | "missing";

export type RepoImage =
  { ok: true; bytes: Uint8Array<ArrayBuffer>; contentType: string } | { ok: false; reason: RepoImageProblem };

/**
 * 글이 import한 이미지(`./1.png`)를 `config.branch`에서 읽는다.
 * 경로 검사는 GitHub를 부르기 전에 끝내, 주소를 바꿔 보낸 요청이 글 이미지가 아닌 파일을 읽지 못하게 한다.
 */
export async function readRepoImage(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  postPath: string,
  importPath: string,
): Promise<RepoImage> {
  if (!findCollection(config, postPath)) return { ok: false, reason: "not-post" };
  const filePath = resolveImportPath(postPath, importPath);
  if (filePath === null) return { ok: false, reason: "outside-repo" };
  const contentType = imageContentType(filePath);
  if (contentType === null) return { ok: false, reason: "not-image" };

  const read = await readDirFile(client, repo, filePath, config.branch);
  if (!read) return { ok: false, reason: "missing" };
  return { ok: true, bytes: new Uint8Array(await read.blob.arrayBuffer()), contentType };
}

/** 글 폴더를 기준으로 import 경로를 레포 경로로 푼다. `./`·`../`로 시작하지 않거나 레포 루트를 넘으면 null. */
function resolveImportPath(postPath: string, importPath: string): string | null {
  if (!importPath.startsWith("./") && !importPath.startsWith("../")) return null;
  const parts = postPath.split("/").slice(0, -1);
  for (const part of importPath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** 편집 화면이 레포 이미지를 받아 갈 라우트 주소. */
export const repoImageHref = (repo: string, postPath: string, importPath: string) =>
  `/repos/${repo}/image?${new URLSearchParams({ post: postPath, src: importPath })}`;
