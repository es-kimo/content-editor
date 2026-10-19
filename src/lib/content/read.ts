import { compilePathPattern, type Collection, type EditorConfig, type PathParams } from "@/lib/editor-config";
import { repoPath, type GitHubClient } from "@/lib/github";
import { isImageFile, metadataText, parseMdx, readMetadata, type MdxDoc, type MetadataResult } from "@/lib/mdx-doc";

import { listDir } from "./contents";

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

  const entries = await listDir(client, repo, dir, config.branch);
  if (!entries) return null;

  const file = entries.find((e) => e.type === "file" && e.name === fileName);
  if (!file) return null;

  const blob = await client.rest(`${repoPath(repo)}/git/blobs/${file.sha}`, {
    accept: "application/vnd.github.raw+json",
  });
  const source = await blob.text();

  const doc = parseMdx(source, config.syntax);

  return {
    collection: found.collection,
    path: filePath,
    params: found.params,
    sha: file.sha,
    source,
    doc,
    metadata: readMetadata(doc),
    images: entries
      .filter((e) => e.type === "file" && isImageFile(e.name))
      .map(({ name, path, sha, size }) => ({ name, path, sha, size }))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })),
  };
}

export type EditorMode = Collection["editor"];

export type EditorModes =
  | { initial: EditorMode; sourceOnly: null }
  /** `doc`: 구간으로 나눌 수 없는 글. `metadata`: metadata를 폼으로 읽을 수 없는 글 (`editable: false`). */
  | { initial: "source"; sourceOnly: { reason: "doc" | "metadata"; message: string } };

/**
 * 글 화면에서 처음 열 본문 편집 모드와, 원문 모드만 쓸 수 있는 글인지.
 * metadata를 폼으로 읽을 수 없는 글은 WYSIWYG로 본문을 저장할 수는 있어도 metadata를 고칠 곳이 원문뿐이라 원문 모드로만 연다.
 */
export function editorModes(post: Post): EditorModes {
  if (!post.doc.ok) return { initial: "source", sourceOnly: { reason: "doc", message: post.doc.message } };
  if (post.metadata && !post.metadata.editable) {
    return { initial: "source", sourceOnly: { reason: "metadata", message: post.metadata.reason } };
  }
  return { initial: post.collection.editor, sourceOnly: null };
}

/**
 * 글 화면의 편집 영역마다 그 영역의 원본에서 만든 key.
 * 한 영역을 저장하면 sha가 바뀌어도 다른 영역의 key는 그대로라, 저장하지 않은 다른 영역의 입력이 다시 마운트로 사라지지 않는다.
 */
export function editorKeys(post: Post): { metadata: string; body: string } {
  if (!post.doc.ok) return { metadata: post.source, body: post.source };
  return { metadata: metadataText(post.doc) ?? "", body: post.doc.body };
}
