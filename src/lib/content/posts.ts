import { compilePathPattern, type Collection, type EditorConfig, type PathParams } from "@/lib/editor-config";

import { GitHubApiError, repoPath, splitRepo, type GitHubClient } from "./client";
import { summarizePost, type PostSummary } from "./summary";

export type TreeEntry = { path: string; type: "blob" | "tree" | "commit"; sha: string; size?: number };

export type PostListItem = PostSummary & {
  path: string;
  params: PathParams;
  /** 목록을 읽을 때의 blob sha. */
  sha: string;
};

/** 브랜치의 전체 파일 트리를 요청 1번으로 받는다. */
export async function fetchTree(client: GitHubClient, repo: string, branch: string): Promise<TreeEntry[]> {
  const res = await client.rest(`${repoPath(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const body = (await res.json()) as { tree: TreeEntry[]; truncated: boolean };
  // 잘린 트리로 목록을 만들면 글이 말없이 빠진다. 지금 레포들은 한도(10만 개)에 한참 못 미친다.
  if (body.truncated) throw new GitHubApiError(`${repo}의 파일 트리가 너무 커서 잘렸다`, null);
  return body.tree;
}

/** 트리에서 컬렉션 path 패턴에 맞는 글 파일을 고른다. */
export function matchPosts(tree: TreeEntry[], collection: Collection): { entry: TreeEntry; params: PathParams }[] {
  const pattern = compilePathPattern(collection.path);
  return tree.flatMap((entry) => {
    if (entry.type !== "blob") return [];
    const params = pattern.match(entry.path);
    return params ? [{ entry, params }] : [];
  });
}

// GraphQL 한 요청에 담는 blob 수. 노드 한도(50만)보다 응답 크기를 보고 정했다.
const BLOB_BATCH = 100;
const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

type BlobText = { text: string | null } | null;

/** blob sha로 텍스트를 받는다. 글마다 REST를 부르면 47편에 47번이라, GraphQL 한 요청에 묶는다. */
export async function fetchBlobTexts(client: GitHubClient, repo: string, shas: string[]): Promise<Map<string, string>> {
  const { owner, name } = splitRepo(repo);
  const unique = [...new Set(shas)];
  const texts = new Map<string, string>();
  for (let start = 0; start < unique.length; start += BLOB_BATCH) {
    const batch = unique.slice(start, start + BLOB_BATCH);
    const fields = batch.map((sha, i) => {
      if (!OID.test(sha)) throw new Error(`blob sha 형식이 아니다: ${sha}`);
      return `b${i}: object(oid: "${sha}") { ... on Blob { text } }`;
    });
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join(" ")} } }`;
    const data = await client.graphql<{ repository: Record<string, BlobText> | null }>(query, { owner, name });
    if (!data.repository) throw new GitHubApiError(`${repo}를 찾을 수 없다`, null);
    batch.forEach((sha, i) => {
      const text = data.repository![`b${i}`]?.text;
      if (typeof text === "string") texts.set(sha, text);
    });
  }
  return texts;
}

const byCreatedAtDesc = (a: PostListItem, b: PostListItem) => {
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt === null) return 1;
    if (b.createdAt === null) return -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
};

/**
 * 컬렉션 하나의 글 목록. 트리 1번 + 글 100편마다 GraphQL 1번으로 끝난다.
 * 최근 글이 위로 오게 createdAt 내림차순으로 정렬한다.
 */
export async function listPosts(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  collection: Collection,
): Promise<PostListItem[]> {
  const files = matchPosts(await fetchTree(client, repo, config.branch), collection);
  const texts = await fetchBlobTexts(
    client,
    repo,
    files.map((f) => f.entry.sha),
  );
  return files
    .map(({ entry, params }): PostListItem => {
      const text = texts.get(entry.sha);
      const summary =
        text === undefined ? summaryWithoutText(params.slug) : summarizePost(text, config.syntax, params.slug);
      return { ...summary, path: entry.path, params, sha: entry.sha };
    })
    .sort(byCreatedAtDesc);
}

const summaryWithoutText = (slug: string): PostSummary => ({
  title: slug,
  titleFromMetadata: false,
  status: null,
  createdAt: null,
  problem: "텍스트로 읽을 수 없는 파일이다",
});
