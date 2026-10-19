import type { AuthConfig } from "./config";
import type { Session } from "./session";

export type Fetch = typeof fetch;
export type Warn = (message: string) => void;

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_URL = "https://api.github.com";

export class GitHubAuthError extends Error {
  constructor(
    message: string,
    /** GitHub 응답의 HTTP 상태. 토큰 엔드포인트처럼 200에 error를 담아 오는 경우는 `null`. */
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

export function authorizeUrl(params: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
};

const seconds = (v: unknown) => (typeof v === "number" && v > 0 ? v * 1000 : null);

/** 토큰 엔드포인트 응답을 세션으로 바꾼다. */
export function sessionFromTokenResponse(body: TokenResponse, now: number, warn: Warn): Session {
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new GitHubAuthError("토큰 응답에 access_token이 없다");
  }
  if (typeof body.refresh_token !== "string" || !body.refresh_token) {
    // 앱 설정에서 user access token 만료 옵션이 꺼져 있으면 refresh token 없이 만료 없는 토큰이 온다.
    warn("GitHub 토큰 응답에 refresh_token이 없다. 만료 없는 토큰으로 처리한다 (GitHub App의 토큰 만료 옵션 확인)");
    return {
      accessToken: body.access_token,
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    };
  }
  const expiresIn = seconds(body.expires_in);
  const refreshExpiresIn = seconds(body.refresh_token_expires_in);
  return {
    accessToken: body.access_token,
    accessTokenExpiresAt: expiresIn === null ? null : now + expiresIn,
    refreshToken: body.refresh_token,
    refreshTokenExpiresAt: refreshExpiresIn === null ? null : now + refreshExpiresIn,
  };
}

async function requestToken(
  params: Record<string, string>,
  deps: { fetch: Fetch; now: number; warn: Warn },
): Promise<Session> {
  const res = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  if (!res.ok) throw new GitHubAuthError(`토큰 요청 실패: HTTP ${res.status}`, res.status);
  const body = (await res.json()) as TokenResponse;
  // 토큰 엔드포인트는 실패도 200으로 돌려주고 본문의 error로 알린다.
  if (typeof body.error === "string") {
    const detail = typeof body.error_description === "string" ? `: ${body.error_description}` : "";
    throw new GitHubAuthError(`토큰 요청 실패 (${body.error})${detail}`);
  }
  return sessionFromTokenResponse(body, deps.now, deps.warn);
}

export function exchangeCode(
  config: Pick<AuthConfig, "clientId" | "clientSecret">,
  params: { code: string; redirectUri: string },
  deps: { fetch: Fetch; now: number; warn: Warn },
): Promise<Session> {
  return requestToken(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    },
    deps,
  );
}

export function refreshAccessToken(
  config: Pick<AuthConfig, "clientId" | "clientSecret">,
  refreshToken: string,
  deps: { fetch: Fetch; now: number; warn: Warn },
): Promise<Session> {
  return requestToken(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    deps,
  );
}

async function api<T>(path: string, accessToken: string, fetchFn: Fetch): Promise<T> {
  const res = await fetchFn(`${API_URL}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new GitHubAuthError(`GitHub API ${path} 실패: HTTP ${res.status}`, res.status);
  return (await res.json()) as T;
}

export type GitHubUser = { login: string; name: string | null; avatar_url: string; html_url: string };
export type Installation = { id: number; account: { login: string } | null };
export type Repository = { id: number; full_name: string; private: boolean; html_url: string };

export function getUser(accessToken: string, fetchFn: Fetch): Promise<GitHubUser> {
  return api<GitHubUser>("/user", accessToken, fetchFn);
}

export async function listInstallations(accessToken: string, fetchFn: Fetch): Promise<Installation[]> {
  const body = await api<{ installations: Installation[] }>("/user/installations?per_page=100", accessToken, fetchFn);
  return body.installations;
}

export async function listInstallationRepositories(
  accessToken: string,
  installationId: number,
  fetchFn: Fetch,
): Promise<Repository[]> {
  const body = await api<{ repositories: Repository[] }>(
    `/user/installations/${installationId}/repositories?per_page=100`,
    accessToken,
    fetchFn,
  );
  return body.repositories;
}
