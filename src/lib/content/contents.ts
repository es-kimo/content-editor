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
