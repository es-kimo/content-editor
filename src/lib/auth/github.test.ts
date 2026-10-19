import { describe, expect, test, vi } from "vitest";

import { formBody, json, mockFetch } from "@/test/mock-fetch";

import { loadAccount } from "./account";
import { authorizeUrl, exchangeCode, getUser, GitHubAuthError, refreshAccessToken } from "./github";

const config = { clientId: "Iv23test", clientSecret: "secret" };
const NOW = 1_700_000_000_000;

const tokenRoute =
  (body: unknown, status = 200) =>
  (url: URL) =>
    url.href === "https://github.com/login/oauth/access_token" ? json(body, status) : undefined;

const fullToken = {
  access_token: "ghu_new",
  expires_in: 28800,
  refresh_token: "ghr_new",
  refresh_token_expires_in: 15897600,
  token_type: "bearer",
  scope: "",
};

describe("authorizeUrl", () => {
  test("client_id, redirect_uri, state를 담는다", () => {
    const url = new URL(authorizeUrl({ clientId: "cid", redirectUri: "https://x.dev/api/auth/callback", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid",
      redirect_uri: "https://x.dev/api/auth/callback",
      state: "st",
    });
  });
});

describe("exchangeCode", () => {
  const deps = (fetch: typeof globalThis.fetch) => ({ fetch, now: NOW, warn: vi.fn() });

  test("code를 토큰으로 바꾸고 만료 시각을 계산한다", async () => {
    const fetch = mockFetch(tokenRoute(fullToken));
    const session = await exchangeCode(config, { code: "c0de", redirectUri: "https://x.dev/cb" }, deps(fetch));
    expect(session).toEqual({
      accessToken: "ghu_new",
      accessTokenExpiresAt: NOW + 28800 * 1000,
      refreshToken: "ghr_new",
      refreshTokenExpiresAt: NOW + 15897600 * 1000,
    });
    const [, init] = fetch.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    expect(formBody(init)).toEqual({
      client_id: "Iv23test",
      client_secret: "secret",
      code: "c0de",
      redirect_uri: "https://x.dev/cb",
    });
  });

  test("200 본문에 error가 오면 실패한다", async () => {
    const fetch = mockFetch(tokenRoute({ error: "bad_verification_code", error_description: "expired" }));
    await expect(exchangeCode(config, { code: "x", redirectUri: "r" }, deps(fetch))).rejects.toThrow(
      /bad_verification_code/,
    );
  });

  test("HTTP 오류면 실패한다", async () => {
    const fetch = mockFetch(tokenRoute({}, 500));
    await expect(exchangeCode(config, { code: "x", redirectUri: "r" }, deps(fetch))).rejects.toBeInstanceOf(
      GitHubAuthError,
    );
  });

  test("access_token이 없으면 실패한다", async () => {
    const fetch = mockFetch(tokenRoute({ token_type: "bearer" }));
    await expect(exchangeCode(config, { code: "x", redirectUri: "r" }, deps(fetch))).rejects.toThrow(/access_token/);
  });

  test("refresh_token이 없으면 만료 없는 토큰으로 처리하고 경고한다", async () => {
    const fetch = mockFetch(tokenRoute({ access_token: "ghu_forever", token_type: "bearer", scope: "" }));
    const d = deps(fetch);
    const session = await exchangeCode(config, { code: "x", redirectUri: "r" }, d);
    expect(session).toEqual({
      accessToken: "ghu_forever",
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    });
    expect(d.warn).toHaveBeenCalledTimes(1);
    expect(d.warn.mock.calls[0][0]).toMatch(/refresh_token/);
  });

  test("refresh_token이 있으면 경고하지 않는다", async () => {
    const d = deps(mockFetch(tokenRoute(fullToken)));
    await exchangeCode(config, { code: "x", redirectUri: "r" }, d);
    expect(d.warn).not.toHaveBeenCalled();
  });
});

describe("refreshAccessToken", () => {
  test("refresh token으로 새 토큰을 받는다", async () => {
    const fetch = mockFetch(tokenRoute(fullToken));
    const session = await refreshAccessToken(config, "ghr_old", { fetch, now: NOW, warn: vi.fn() });
    expect(session.accessToken).toBe("ghu_new");
    expect(session.refreshToken).toBe("ghr_new");
    expect(formBody(fetch.mock.calls[0][1])).toEqual({
      client_id: "Iv23test",
      client_secret: "secret",
      grant_type: "refresh_token",
      refresh_token: "ghr_old",
    });
  });

  test("bad_refresh_token이면 실패한다", async () => {
    const fetch = mockFetch(tokenRoute({ error: "bad_refresh_token" }));
    await expect(refreshAccessToken(config, "ghr_old", { fetch, now: NOW, warn: vi.fn() })).rejects.toBeInstanceOf(
      GitHubAuthError,
    );
  });
});

describe("GitHub API", () => {
  const api = (routes: Record<string, unknown>) => (url: URL) =>
    url.origin === "https://api.github.com" && url.pathname in routes ? json(routes[url.pathname]) : undefined;

  test("사용자 정보를 토큰으로 조회한다", async () => {
    const fetch = mockFetch(api({ "/user": { login: "es-kimo", name: null, avatar_url: "a", html_url: "h" } }));
    expect((await getUser("ghu_t", fetch)).login).toBe("es-kimo");
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer ghu_t");
  });

  test("401이면 상태를 담아 실패한다", async () => {
    const fetch = mockFetch(() => json({ message: "Bad credentials" }, 401));
    const error = await getUser("bad", fetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubAuthError);
    expect((error as GitHubAuthError).status).toBe(401);
  });

  test("사용자, 설치, 설치별 레포를 모은다", async () => {
    const fetch = mockFetch(
      api({
        "/user": { login: "es-kimo", name: "Kimo", avatar_url: "a", html_url: "h" },
        "/user/installations": {
          total_count: 2,
          installations: [
            { id: 1, account: { login: "es-kimo" } },
            { id: 2, account: null },
          ],
        },
        "/user/installations/1/repositories": {
          total_count: 1,
          repositories: [{ id: 10, full_name: "es-kimo/site", private: false, html_url: "s" }],
        },
        "/user/installations/2/repositories": {
          total_count: 1,
          repositories: [{ id: 20, full_name: "es-kimo/yjshd", private: true, html_url: "y" }],
        },
      }),
    );
    const account = await loadAccount("ghu_t", fetch);
    expect(account.user.login).toBe("es-kimo");
    expect(account.installations).toEqual([
      { id: 1, account: "es-kimo", repositories: [expect.objectContaining({ full_name: "es-kimo/site" })] },
      { id: 2, account: null, repositories: [expect.objectContaining({ full_name: "es-kimo/yjshd" })] },
    ]);
  });

  test("레포 조회가 실패하면 전체가 실패한다", async () => {
    const fetch = mockFetch(
      api({
        "/user": { login: "es-kimo", name: null, avatar_url: "a", html_url: "h" },
        "/user/installations": { installations: [{ id: 1, account: null }] },
      }),
      () => json({ message: "Not Found" }, 404),
    );
    await expect(loadAccount("ghu_t", fetch)).rejects.toThrow(/404/);
  });
});
