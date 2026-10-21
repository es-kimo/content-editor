import { compilePathPattern, type Collection, type EditorConfig, type PathParams } from "@/lib/editor-config";
import type { GitHubClient } from "@/lib/github";
import { isImageFile, parseMdx, readMetadata, type MdxDoc, type MetadataResult } from "@/lib/mdx-doc";

import { readDirFile } from "./contents";
import { docEditorKeys, type EditorKeys } from "./save-flow";
import { IMAGE_COMPONENT } from "./upload";

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

  const read = await readDirFile(client, repo, filePath, config.branch);
  if (!read) return null;
  const { entries, file, blob } = read;
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

/**
 * 원문 모드 삽입 버튼에 보일 컴포넌트. config `components` 순서를 따른다.
 * 이미지는 파일 업로드와 import까지 함께 넣어야 해서 템플릿만 넣는 버튼으로는 쓸 수 없으므로 뺀다.
 */
export function sourceComponents(collection: Collection): string[] {
  return collection.components.filter((name) => name !== IMAGE_COMPONENT);
}

/**
 * 글 화면의 편집 영역마다 그 영역의 원본에서 만든 key.
 * 한 영역을 저장하면 sha가 바뀌어도 다른 영역의 key는 그대로라, 저장하지 않은 다른 영역의 입력이 다시 마운트로 사라지지 않는다.
 */
export function editorKeys(post: Post): EditorKeys {
  return docEditorKeys(post.source, post.doc);
}
