import { compilePathPattern, type Collection, type EditorConfig, type PathParams } from "@/lib/editor-config";
import { parseMdx, parseMetadata, type MdxDoc, type MetadataResult } from "@/lib/mdx-doc";

import { encodePath, GitHubApiError, repoPath, type GitHubClient } from "./client";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"] as const;

export type PostImage = { name: string; path: string; sha: string; size: number };

export type Post = {
  collection: Collection;
  path: string;
  params: PathParams;
  /** 읽은 blob의 sha. 저장할 때 그 사이 다른 곳에서 고쳤는지 이 값과 비교한다. */
  sha: string;
  source: string;
  doc: MdxDoc;
  /** metadata 구간을 읽은 결과. 구간으로 나눌 수 없거나 metadata export가 없으면 null. */
  metadata: MetadataResult | null;
  /** 글 폴더 안의 이미지. 이름순. */
  images: PostImage[];
};

type ContentsEntry = {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  sha: string;
  size: number;
};

/** 경로가 맞는 컬렉션. config에 없는 경로는 열지 않는다. */
export function findCollection(
  config: EditorConfig,
  filePath: string,
): { collection: Collection; params: PathParams } | null {
  for (const collection of config.collections) {
    const params = compilePathPattern(collection.path).match(filePath);
    if (params) return { collection, params };
  }
  return null;
}

export function isImageFile(name: string): boolean {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return name.includes(".") && (IMAGE_EXTENSIONS as readonly string[]).includes(extension);
}

/**
 * 글 하나를 연다. 글 폴더 목록(파일 sha 포함)을 먼저 받고 그 sha로 blob을 받아, 내용과 sha가 같은 시점의 것이 되게 한다.
 * 컬렉션에 없는 경로이거나 파일이 없으면 null.
 */
export async function readPost(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  filePath: string,
): Promise<Post | null> {
  const found = findCollection(config, filePath);
  if (!found) return null;

  const slash = filePath.lastIndexOf("/");
  const dir = filePath.slice(0, slash);
  const fileName = filePath.slice(slash + 1);

  let entries: ContentsEntry[];
  try {
    const res = await client.rest(
      `${repoPath(repo)}/contents/${encodePath(dir)}?ref=${encodeURIComponent(config.branch)}`,
    );
    const body = (await res.json()) as ContentsEntry[] | ContentsEntry;
    // 글 폴더 자리에 파일이 있으면 배열이 아닌 객체가 온다.
    if (!Array.isArray(body)) return null;
    entries = body;
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }

  const file = entries.find((e) => e.type === "file" && e.name === fileName);
  if (!file) return null;

  const blob = await client.rest(`${repoPath(repo)}/git/blobs/${file.sha}`, {
    accept: "application/vnd.github.raw+json",
  });
  const source = await blob.text();

  const doc = parseMdx(source, config.syntax);
  const segment = doc.ok ? doc.head.find((s) => s.kind === "metadata") : undefined;

  return {
    collection: found.collection,
    path: filePath,
    params: found.params,
    sha: file.sha,
    source,
    doc,
    metadata: segment ? parseMetadata(segment.text) : null,
    images: entries
      .filter((e) => e.type === "file" && isImageFile(e.name))
      .map(({ name, path, sha, size }) => ({ name, path, sha, size }))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })),
  };
}
