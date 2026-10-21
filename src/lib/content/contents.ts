import { encodePath, GitHubApiError, repoPath, type GitHubClient } from "@/lib/github";

export type ContentsEntry = {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  sha: string;
  size: number;
};

/** `ref` 시점의 폴더 목록(Contents API). 폴더가 없거나 그 자리에 파일이 있으면 null. */
export async function listDir(
  client: GitHubClient,
  repo: string,
  dir: string,
  ref: string,
): Promise<ContentsEntry[] | null> {
  try {
    const res = await client.rest(`${repoPath(repo)}/contents/${encodePath(dir)}?ref=${encodeURIComponent(ref)}`);
    const body = (await res.json()) as ContentsEntry[] | ContentsEntry;
    // 폴더 자리에 파일이 있으면 배열이 아닌 객체가 온다.
    return Array.isArray(body) ? body : null;
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * `ref` 시점의 파일 하나를 그 폴더 목록과 함께 읽는다. 목록의 sha로 blob을 받아 내용과 sha가 같은 시점의 것이 되게 한다.
 * 폴더나 파일이 없거나, 목록을 읽은 뒤 그 사이에 지워졌으면 null.
 */
export async function readDirFile(
  client: GitHubClient,
  repo: string,
  filePath: string,
  ref: string,
): Promise<{ entries: ContentsEntry[]; file: ContentsEntry; blob: Response } | null> {
  const slash = filePath.lastIndexOf("/");
  const entries = await listDir(client, repo, filePath.slice(0, Math.max(slash, 0)), ref);
  const file = entries?.find((e) => e.type === "file" && e.name === filePath.slice(slash + 1));
  if (!entries || !file) return null;

  try {
    const blob = await client.rest(`${repoPath(repo)}/git/blobs/${file.sha}`, {
      accept: "application/vnd.github.raw+json",
    });
    return { entries, file, blob };
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}
