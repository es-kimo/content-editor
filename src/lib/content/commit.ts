import { type EditorConfig } from "@/lib/editor-config";

import { encodePath, GitHubApiError, repoPath, type GitHubClient } from "./client";
import { findCollection, isImageFile } from "./read";

export type CommitFile = { path: string; content: string | Uint8Array };

/** 커밋하기 전에 브랜치 끝에서 이 sha여야 하는 파일. `sha: null`은 파일이 없어야 한다는 뜻(새 글). */
export type ExpectedFile = { path: string; sha: string | null };

export type CommitResult =
  | { ok: true; commit: string; parent: string }
  /** 글을 연 뒤 다른 곳에서 파일을 고쳤다. */
  | { ok: false; reason: "changed"; path: string; expected: string | null; actual: string | null }
  /** 검사와 ref 갱신 사이에 브랜치가 앞서 나갔다. force로 덮지 않는다. */
  | { ok: false; reason: "not-fast-forward" };

type ContentsEntry = { type: string; name: string; sha: string };

const parentDir = (filePath: string) => filePath.slice(0, filePath.lastIndexOf("/"));

/** `ref`(커밋 sha) 시점의 파일 sha. 없으면 null. 같은 폴더의 파일은 목록 1번으로 본다. */
async function currentShas(
  client: GitHubClient,
  repo: string,
  ref: string,
  paths: string[],
): Promise<Map<string, string | null>> {
  const shas = new Map<string, string | null>();
  for (const dir of new Set(paths.map(parentDir))) {
    let entries: ContentsEntry[] = [];
    try {
      const res = await client.rest(`${repoPath(repo)}/contents/${encodePath(dir)}?ref=${ref}`);
      const body = (await res.json()) as ContentsEntry[] | ContentsEntry;
      if (Array.isArray(body)) entries = body;
    } catch (error) {
      if (!(error instanceof GitHubApiError && error.status === 404)) throw error;
    }
    for (const path of paths.filter((p) => parentDir(p) === dir)) {
      const name = path.slice(dir.length + 1);
      shas.set(path, entries.find((e) => e.type === "file" && e.name === name)?.sha ?? null);
    }
  }
  return shas;
}

const toBlob = (content: string | Uint8Array) =>
  typeof content === "string"
    ? { content, encoding: "utf-8" }
    : { content: Buffer.from(content).toString("base64"), encoding: "base64" };

/**
 * 여러 파일을 Git Data API로 커밋 1개에 담는다: blob → tree(base_tree) → commit → ref 갱신.
 * Contents API는 파일마다 커밋이 생겨 쓰지 않는다.
 * 작성자는 지정하지 않는다. GitHub이 토큰의 사용자(로그인한 사용자)로 채운다.
 */
export async function commitFiles(
  client: GitHubClient,
  repo: string,
  options: { branch: string; message: string; files: CommitFile[]; expected: ExpectedFile[] },
): Promise<CommitResult> {
  const { branch, message, files, expected } = options;
  if (files.length === 0) throw new Error("커밋할 파일이 없다");
  const base = repoPath(repo);
  const refPath = `${base}/git/refs/heads/${encodePath(branch)}`;

  const ref = (await (await client.rest(`${base}/git/ref/heads/${encodePath(branch)}`)).json()) as {
    object: { sha: string };
  };
  const parent = ref.object.sha;

  const current = await currentShas(
    client,
    repo,
    parent,
    expected.map((e) => e.path),
  );
  for (const { path, sha } of expected) {
    const actual = current.get(path) ?? null;
    if (actual !== sha) return { ok: false, reason: "changed", path, expected: sha, actual };
  }

  const parentCommit = (await (await client.rest(`${base}/git/commits/${parent}`)).json()) as { tree: { sha: string } };

  const tree = [];
  for (const file of files) {
    const blob = (await (
      await client.rest(`${base}/git/blobs`, { method: "POST", body: toBlob(file.content) })
    ).json()) as { sha: string };
    tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = (await (
    await client.rest(`${base}/git/trees`, { method: "POST", body: { base_tree: parentCommit.tree.sha, tree } })
  ).json()) as { sha: string };
  const commit = (await (
    await client.rest(`${base}/git/commits`, {
      method: "POST",
      body: { message, tree: newTree.sha, parents: [parent] },
    })
  ).json()) as { sha: string };

  try {
    await client.rest(refPath, { method: "PATCH", body: { sha: commit.sha, force: false } });
  } catch (error) {
    // 만든 커밋은 어느 ref에도 걸리지 않아 레포에 흔적을 남기지 않는다.
    if (error instanceof GitHubApiError && error.status === 422) return { ok: false, reason: "not-fast-forward" };
    throw error;
  }
  return { ok: true, commit: commit.sha, parent };
}

/** 기존 관례: `post: <제목>`. 커밋 제목이 한 줄이 되게 줄바꿈을 공백으로 바꾼다. */
export function postCommitMessage(title: string): string {
  return `post: ${title.replace(/\s+/g, " ").trim()}`;
}

export type SavePostInput = {
  /** 글 파일 경로. config의 컬렉션 패턴에 맞아야 한다. */
  path: string;
  /** 글을 열 때 받은 blob sha(`Post.sha`). 새 글이면 null. */
  baseSha: string | null;
  source: string;
  title: string;
  /** 글 폴더에 함께 넣을 이미지. `name`은 폴더 안의 파일 이름. */
  images?: { name: string; content: Uint8Array }[];
};

/** 글 하나와 그 이미지를 config의 브랜치에 커밋 1개로 저장한다. 글을 연 뒤 다른 곳에서 고쳤으면 저장하지 않는다. */
export async function savePost(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: SavePostInput,
): Promise<CommitResult> {
  if (!findCollection(config, input.path)) throw new Error(`config의 컬렉션에 없는 경로다: ${input.path}`);
  const dir = parentDir(input.path);
  const images = (input.images ?? []).map(({ name, content }) => {
    if (name.includes("/") || name.startsWith(".") || !isImageFile(name)) {
      throw new Error(`글 폴더에 넣을 수 없는 이미지 이름이다: ${name}`);
    }
    return { path: `${dir}/${name}`, content };
  });
  return commitFiles(client, repo, {
    branch: config.branch,
    message: postCommitMessage(input.title),
    files: [{ path: input.path, content: input.source }, ...images],
    expected: [{ path: input.path, sha: input.baseSha }],
  });
}
