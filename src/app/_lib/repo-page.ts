import { refreshHref } from "@/app/_lib/session";
import type { PageSession } from "@/lib/auth";
import { CONFIG_FILE, loadEditorConfig, type EditorConfig, type LoadedConfig } from "@/lib/editor-config";
import { createGitHubClient, GitHubApiError, isUnauthorized, type GitHubClient } from "@/lib/github";

type Fetch = typeof fetch;

export type RepoContext = { client: GitHubClient; config: EditorConfig };

/** 레포 화면이 그릴 것. `login`은 로그인 링크, `refresh`는 그 주소로 이동, `config`는 안내 문구. */
export type RepoPage<T> =
  | { kind: "login" }
  | { kind: "refresh"; href: string }
  | { kind: "config"; message: string }
  | { kind: "ok"; config: EditorConfig; value: T };

/**
 * 레포 화면의 준비 과정: 세션 → config 로드 → `read`. 어느 단계에서든 401이면 다시 로그인하게 한다.
 * `returnTo`는 토큰을 갱신한 뒤 돌아올 이 화면의 주소.
 */
export async function prepareRepoPage<T>({
  repo,
  session,
  returnTo,
  fetchFn,
  read,
}: {
  repo: string;
  session: PageSession;
  returnTo: string;
  fetchFn: Fetch;
  read: (context: RepoContext) => Promise<T>;
}): Promise<RepoPage<T>> {
  if (session.kind === "anonymous") return { kind: "login" };
  if (session.kind === "refresh") return { kind: "refresh", href: refreshHref(returnTo) };
  const { accessToken } = session.session;

  let loaded: LoadedConfig;
  try {
    loaded = await loadEditorConfig(repo, accessToken, fetchFn);
  } catch (e) {
    if (isUnauthorized(e)) return { kind: "login" };
    if (e instanceof GitHubApiError) return { kind: "config", message: e.message };
    throw e;
  }
  if (loaded.kind === "missing") return { kind: "config", message: `${repo} 루트에 ${CONFIG_FILE}이 없다.` };
  if (loaded.kind === "invalid") {
    return { kind: "config", message: `${CONFIG_FILE} 오류 ${loaded.issues.length}건. 처음 화면에서 내용을 확인한다.` };
  }

  try {
    const value = await read({ client: createGitHubClient(accessToken, fetchFn), config: loaded.config });
    return { kind: "ok", config: loaded.config, value };
  } catch (e) {
    if (isUnauthorized(e)) return { kind: "login" };
    throw e;
  }
}
