import { createHash } from "node:crypto";

import { blobSha, type FakeFile } from "./fake-github";
import { json, mockFetch } from "./mock-fetch";

type Commit = { sha: string; tree: string; parents: string[]; message: string; author: unknown };

const hash = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex");

/**
 * Git Data API(ref, commit, blob, tree, 전체 트리 읽기)와 contents 폴더 목록을 메모리에서 흉내 내는 레포.
 * 트리는 경로 → blob sha 평면 맵으로 들고, ref 갱신은 실제 API처럼 fast-forward만 받는다.
 */
export function fakeGitRepo(repo: string, branch: string, files: FakeFile[]) {
  const blobs = new Map<string, Uint8Array>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, Commit>();
  const refs = new Map<string, string>();

  const bytes = (content: string | Uint8Array) =>
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  const putBlob = (content: string | Uint8Array) => {
    const sha = blobSha(content);
    blobs.set(sha, bytes(content));
    return sha;
  };
  const putTree = (entries: Map<string, string>) => {
    const sha = hash([...entries].sort());
    trees.set(sha, entries);
    return sha;
  };
  const putCommit = (tree: string, parents: string[], message: string, author: unknown = null) => {
    const sha = hash({ tree, parents, message, n: commits.size });
    commits.set(sha, { sha, tree, parents, message, author });
    return sha;
  };
  const isAncestor = (ancestor: string, sha: string): boolean => {
    if (ancestor === sha) return true;
    return (commits.get(sha)?.parents ?? []).some((p) => isAncestor(ancestor, p));
  };
  const treeAt = (ref: string) => {
    const commit = commits.get(refs.get(ref) ?? ref);
    return commit ? trees.get(commit.tree)! : undefined;
  };

  refs.set(branch, putCommit(putTree(new Map(files.map((f) => [f.path, putBlob(f.content)]))), [], "init"));

  const base = `https://api.github.com/repos/${repo}`;
  const body = (init: RequestInit | undefined) => JSON.parse(String(init?.body)) as Record<string, unknown>;

  const fetch = mockFetch((url, init) => {
    const href = decodeURIComponent(url.href);
    const method = init?.method ?? "GET";

    const ref = new RegExp(`^${base}/git/refs?/heads/(.+)$`).exec(href);
    if (ref && method === "GET") {
      const sha = refs.get(ref[1]);
      return sha ? json({ ref: `refs/heads/${ref[1]}`, object: { type: "commit", sha } }) : json({}, 404);
    }
    if (ref && method === "PATCH") {
      const { sha, force } = body(init) as { sha: string; force?: boolean };
      const head = refs.get(ref[1]);
      if (!head || !commits.has(sha)) return json({ message: "Reference does not exist" }, 422);
      if (!force && !isAncestor(head, sha)) return json({ message: "Update is not a fast forward" }, 422);
      refs.set(ref[1], sha);
      return json({ ref: `refs/heads/${ref[1]}`, object: { type: "commit", sha } });
    }

    const commit = new RegExp(`^${base}/git/commits/([0-9a-f]+)$`).exec(href);
    if (commit && method === "GET") {
      const c = commits.get(commit[1]);
      return c ? json({ sha: c.sha, tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) }) : undefined;
    }

    const blob = new RegExp(`^${base}/git/blobs/([0-9a-f]+)$`).exec(href);
    if (blob && method === "GET") {
      const data = blobs.get(blob[1]);
      return data ? new Response(new Uint8Array(data)) : json({ message: "Not Found" }, 404);
    }
    if (method === "POST" && href === `${base}/git/blobs`) {
      const { content, encoding } = body(init) as { content: string; encoding: string };
      const data = encoding === "base64" ? new Uint8Array(Buffer.from(content, "base64")) : content;
      return json({ sha: putBlob(data) }, 201);
    }
    if (method === "POST" && href === `${base}/git/trees`) {
      const { base_tree, tree } = body(init) as { base_tree?: string; tree: { path: string; sha: string }[] };
      const entries = new Map(base_tree ? trees.get(base_tree) : []);
      if (base_tree && !trees.has(base_tree)) return json({ message: "base_tree 없음" }, 422);
      for (const e of tree) {
        if (!blobs.has(e.sha)) return json({ message: "blob 없음" }, 422);
        entries.set(e.path, e.sha);
      }
      return json({ sha: putTree(entries) }, 201);
    }
    if (method === "POST" && href === `${base}/git/commits`) {
      const { tree, parents, message, author } = body(init) as {
        tree: string;
        parents: string[];
        message: string;
        author?: unknown;
      };
      if (!trees.has(tree) || parents.some((p) => !commits.has(p))) return json({ message: "없는 객체" }, 422);
      return json({ sha: putCommit(tree, parents, message, author ?? null) }, 201);
    }

    const recursiveTree = new RegExp(`^${base}/git/trees/(.+)\\?recursive=1$`).exec(href);
    if (recursiveTree && method === "GET") {
      const entries = treeAt(recursiveTree[1]);
      if (!entries) return json({ message: "Not Found" }, 404);
      const tree = [...entries].map(([path, sha]) => ({ path, type: "blob", sha, size: blobs.get(sha)!.length }));
      return json({ sha: hash([...entries].sort()), tree, truncated: false });
    }

    const contents = new RegExp(`^${base}/contents/(.+)\\?ref=(.+)$`).exec(href);
    if (contents && method === "GET") {
      const [, dir, at] = contents;
      const entries = treeAt(at);
      if (!entries) return json({ message: "No commit found" }, 404);
      const children = new Map<string, { type: string; name: string; path: string; sha: string }>();
      for (const [path, sha] of entries) {
        if (!path.startsWith(`${dir}/`)) continue;
        const [child, ...rest] = path.slice(dir.length + 1).split("/");
        children.set(child, {
          type: rest.length === 0 ? "file" : "dir",
          name: child,
          path: `${dir}/${child}`,
          sha: rest.length === 0 ? sha : hash(`${dir}/${child}`),
        });
      }
      return children.size === 0 ? json({ message: "Not Found" }, 404) : json([...children.values()]);
    }
    return undefined;
  });

  /** 브랜치 끝에서 처음 커밋까지 거꾸로. */
  const log = (name = branch) => {
    const out: Commit[] = [];
    for (let sha: string | undefined = refs.get(name); sha; sha = commits.get(sha)?.parents[0]) {
      out.push(commits.get(sha)!);
    }
    return out;
  };

  return {
    fetch,
    log,
    head: (name = branch) => refs.get(name)!,
    /** 브랜치 끝의 파일 내용. */
    file(path: string, name = branch): Uint8Array | undefined {
      const sha = treeAt(name)?.get(path);
      return sha ? blobs.get(sha) : undefined;
    },
    paths: (name = branch) => [...(treeAt(name)?.keys() ?? [])].sort(),
    /** 에디터 밖(IDE 등)에서 커밋한 것처럼 브랜치를 앞으로 옮긴다. `content: null`은 파일 삭제. */
    pushElsewhere(
      changed: { path: string; content: FakeFile["content"] | null }[],
      message = "다른 곳에서 고침",
      name = branch,
    ) {
      const entries = new Map(treeAt(name));
      for (const f of changed) {
        if (f.content === null) entries.delete(f.path);
        else entries.set(f.path, putBlob(f.content));
      }
      refs.set(name, putCommit(putTree(entries), [refs.get(name)!], message));
    },
  };
}
