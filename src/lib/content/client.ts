type Fetch = typeof fetch;

const API_URL = "https://api.github.com";

export class GitHubApiError extends Error {
  constructor(
    message: string,
    /** GitHub 응답의 HTTP 상태. GraphQL처럼 200에 errors를 담아 오는 경우는 `null`. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export type GitHubClient = {
  /** REST 요청. 응답이 2xx가 아니면 `GitHubApiError`를 던진다. */
  rest(path: string, options?: { accept?: string }): Promise<Response>;
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
  /** 지금까지 보낸 API 요청 수. 목록 화면이 몇 번 호출했는지 기록하는 데 쓴다. */
  readonly calls: number;
};

/** 사용자 토큰으로 GitHub API를 부르는 클라이언트. 화면 하나를 그릴 때마다 새로 만들어 호출 수를 센다. */
export function createGitHubClient(accessToken: string, fetchFn: Fetch): GitHubClient {
  let calls = 0;
  const headers = (accept: string) => ({
    Accept: accept,
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
  });

  return {
    get calls() {
      return calls;
    },
    async rest(path, options = {}) {
      calls++;
      const res = await fetchFn(`${API_URL}${path}`, {
        headers: headers(options.accept ?? "application/vnd.github+json"),
        cache: "no-store",
      });
      if (!res.ok) throw new GitHubApiError(`GitHub API ${decodeURI(path)} 실패: HTTP ${res.status}`, res.status);
      return res;
    },
    async graphql<T>(query: string, variables: Record<string, unknown>) {
      calls++;
      const res = await fetchFn(`${API_URL}/graphql`, {
        method: "POST",
        headers: { ...headers("application/json"), "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      });
      if (!res.ok) throw new GitHubApiError(`GitHub GraphQL 실패: HTTP ${res.status}`, res.status);
      const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
      if (body.errors?.length || !body.data) {
        const detail = body.errors?.map((e) => e.message).join("; ") ?? "data가 없다";
        throw new GitHubApiError(`GitHub GraphQL 실패: ${detail}`, null);
      }
      return body.data;
    },
  };
}

/** 작업에 걸린 시간을 함께 돌려준다. 화면에 API 호출 수와 걸린 시간을 기록하는 데 쓴다. */
export async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await work();
  return { value, ms: Math.round(performance.now() - started) };
}

/** `owner/name`을 나눈다. */
export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length > 0) throw new Error(`레포는 owner/name 형식이어야 한다: ${repo}`);
  return { owner, name };
}

/** REST 경로에 넣을 수 있게 파일 경로를 단계별로 인코딩한다. */
export function encodePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

export function repoPath(repo: string): string {
  const { owner, name } = splitRepo(repo);
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}
