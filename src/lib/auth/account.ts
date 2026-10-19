import { createGitHubClient } from "@/lib/github";

import {
  getUser,
  listInstallationRepositories,
  listInstallations,
  type Fetch,
  type GitHubUser,
  type Repository,
} from "./github";
import { decodeSession, needsRefresh, type Session } from "./session";

export type Account = {
  user: GitHubUser;
  installations: { id: number; account: string | null; repositories: Repository[] }[];
};

/** 로그인한 사용자와 그 사용자가 접근할 수 있는 설치 레포를 모은다. */
export async function loadAccount(accessToken: string, fetchFn: Fetch): Promise<Account> {
  const client = createGitHubClient(accessToken, fetchFn);
  const [user, installations] = await Promise.all([getUser(client), listInstallations(client)]);
  const withRepos = await Promise.all(
    installations.map(async (i) => ({
      id: i.id,
      account: i.account?.login ?? null,
      repositories: await listInstallationRepositories(client, i.id),
    })),
  );
  return { user, installations: withRepos };
}

export type PageSession = { kind: "anonymous" } | { kind: "refresh" } | { kind: "ok"; session: Session };

/**
 * 화면(서버 컴포넌트)에서 세션 쿠키를 보고 할 일을 정한다. 갱신은 쿠키를 쓸 수 있는 라우트로 넘긴다.
 * `refreshAttempted`는 갱신 라우트를 거쳐 왔는데도 기존 토큰이 남은 경우다. 다시 보내면 리다이렉트가 반복된다.
 */
export function resolvePageSession(
  cookie: string | undefined,
  key: Buffer,
  now: number,
  refreshAttempted = false,
): PageSession {
  const session = decodeSession(cookie, key);
  if (!session) return { kind: "anonymous" };
  if (!refreshAttempted && needsRefresh(session, now)) return { kind: "refresh" };
  return { kind: "ok", session };
}
