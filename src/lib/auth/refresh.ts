import type { AuthConfig } from "./config";
import { GitHubAuthError, refreshAccessToken, type Fetch, type Warn } from "./github";
import { needsRefresh, type Session } from "./session";

export type FreshSession =
  | { kind: "fresh"; session: Session }
  | { kind: "refreshed"; session: Session }
  /** 갱신할 수 없어 다시 로그인해야 한다. */
  | { kind: "expired" };

/** access token 만료가 가까우면 refresh token으로 갱신한다. `now`는 테스트에서 주입한다. */
export async function ensureFreshSession(
  session: Session,
  config: Pick<AuthConfig, "clientId" | "clientSecret">,
  deps: { fetch: Fetch; now: number; warn: Warn },
): Promise<FreshSession> {
  if (!needsRefresh(session, deps.now)) return { kind: "fresh", session };

  const stillValid = session.accessTokenExpiresAt !== null && session.accessTokenExpiresAt > deps.now;
  const refreshUsable =
    session.refreshToken !== null &&
    (session.refreshTokenExpiresAt === null || session.refreshTokenExpiresAt > deps.now);
  if (!refreshUsable) return stillValid ? { kind: "fresh", session } : { kind: "expired" };

  try {
    return { kind: "refreshed", session: await refreshAccessToken(config, session.refreshToken!, deps) };
  } catch (error) {
    if (!(error instanceof GitHubAuthError)) throw error;
    deps.warn(`access token 갱신 실패: ${error.message}`);
    // 만료 직전이라 미리 갱신하려던 것이면 남은 시간 동안은 기존 토큰을 쓴다.
    return stillValid ? { kind: "fresh", session } : { kind: "expired" };
  }
}
