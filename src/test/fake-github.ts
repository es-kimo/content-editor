import { createHash } from "node:crypto";

import { json, mockFetch } from "./mock-fetch";

export type FakeFile = { path: string; content: string | Uint8Array };

/** git과 같은 방식으로 blob sha를 만든다. */
export function blobSha(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export const GRAPHQL_URL = "https://api.github.com/graphql";

/**
 * 글 목록이 blob 텍스트를 묶어 읽는 GraphQL 요청에 답한다. 쿼리 모양은 두 가짜 GitHub가 여기서만 안다.
 * `textOf`는 없는 blob이면 `undefined`, 실제 API처럼 텍스트로 읽을 수 없는 blob이면 `null`을 돌려준다.
 */
export function blobTextsResponse(
  repo: string,
  init: RequestInit | undefined,
  textOf: (oid: string) => string | null | undefined,
): Response {
  const { query, variables } = JSON.parse(String(init?.body)) as {
    query: string;
    variables: { owner: string; name: string };
  };
  if (`${variables.owner}/${variables.name}` !== repo) return json({ data: { repository: null } });
  const repository: Record<string, { text: string | null } | null> = {};
  for (const [, alias, oid] of query.matchAll(/(\w+): object\(oid: "([0-9a-f]+)"\)/g)) {
    const text = textOf(oid);
    repository[alias] = text === undefined ? null : { text };
  }
  return json({ data: { repository } });
}

/**
 * 파일 목록으로 GitHub API(트리, GraphQL blob, contents 폴더, blob raw)를 흉내 낸다.
 * 실제 API처럼 경로는 URL 인코딩된 채로 온다.
 */
export function fakeGitHub(repo: string, branch: string, files: FakeFile[], options: { truncated?: boolean } = {}) {
  const blobs = new Map(files.map((f) => [blobSha(f.content), f.content]));
  const shaOf = new Map(files.map((f) => [f.path, blobSha(f.content)]));
  const dirs = new Set(
    files.flatMap((f) =>
      f.path
        .split("/")
        .slice(0, -1)
        .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
    ),
  );
  const size = (content: string | Uint8Array) =>
    typeof content === "string" ? new TextEncoder().encode(content).length : content.length;

  const base = `https://api.github.com/repos/${repo}`;

  return mockFetch((url, init) => {
    const href = decodeURIComponent(url.href);
    if (href === `${base}/git/trees/${branch}?recursive=1`) {
      const tree = [
        ...[...dirs].map((path) => ({ path, type: "tree", sha: blobSha(path) })),
        ...files.map((f) => ({ path: f.path, type: "blob", sha: shaOf.get(f.path), size: size(f.content) })),
      ];
      return json({ sha: "root", tree, truncated: options.truncated ?? false });
    }
    if (url.href === GRAPHQL_URL) {
      return blobTextsResponse(repo, init, (oid) => {
        const content = blobs.get(oid);
        return content === undefined ? undefined : typeof content === "string" ? content : null;
      });
    }
    const contents = new RegExp(`^${base}/contents/(.+)\\?ref=${branch}$`).exec(href);
    if (contents) {
      const dir = contents[1];
      if (!dirs.has(dir)) return json({ message: "Not Found" }, 404);
      const children = new Map<string, { type: string; name: string; path: string; sha: string; size: number }>();
      for (const f of files) {
        if (!f.path.startsWith(`${dir}/`)) continue;
        const [child, ...rest] = f.path.slice(dir.length + 1).split("/");
        const path = `${dir}/${child}`;
        children.set(
          child,
          rest.length === 0
            ? { type: "file", name: child, path, sha: shaOf.get(f.path)!, size: size(f.content) }
            : { type: "dir", name: child, path, sha: blobSha(path), size: 0 },
        );
      }
      return json([...children.values()]);
    }
    const blob = new RegExp(`^${base}/git/blobs/([0-9a-f]+)$`).exec(href);
    if (blob) {
      const content = blobs.get(blob[1]);
      return content === undefined
        ? json({ message: "Not Found" }, 404)
        : new Response(typeof content === "string" ? content : new Uint8Array(content));
    }
    return undefined;
  });
}
