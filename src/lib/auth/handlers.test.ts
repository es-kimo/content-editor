import { randomBytes } from "node:crypto";

import { NextRequest, type NextResponse } from "next/server";
import { describe, expect, test, vi } from "vitest";

import { formBody, json, mockFetch } from "@/test/mock-fetch";

import type { AuthConfig } from "./config";
import { resolvePageSession } from "./account";
import {
  handleCallback,
  handleLogin,
  handleLogout,
  handleRefresh,
  REFRESH_ATTEMPTED_PARAM,
  safeReturnTo,
} from "./handlers";
import { decodeSession, encodeSession, SESSION_COOKIE, STATE_COOKIE, type Session } from "./session";

const config: AuthConfig = { clientId: "Iv23test", clientSecret: "secret", sessionKey: randomBytes(32) };
const ORIGIN = "https://editor.khryu.dev";
const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

const token = { access_token: "ghu_a", expires_in: 28800, refresh_token: "ghr_r", refresh_token_expires_in: 15897600 };

function request(path: string, cookies: Record<string, string> = {}, method = "GET") {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(ORIGIN + path, { method, headers: cookie ? { cookie } : {} });
}

function setCookie(res: NextResponse, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

const deps = (fetch = mockFetch(() => json(token))) => ({ fetch, now: NOW, warn: vi.fn() });

describe("handleLogin", () => {
  test("GitHub 인가 화면으로 보내고 state를 쿠키에 둔다", () => {
    const res = handleLogin(request("/api/auth/login"), config);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("Iv23test");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback`);

    const state = location.searchParams.get("state");
    expect(state).toMatch(/^[\w-]{40,}$/);
    const cookie = setCookie(res, STATE_COOKIE)!;
    expect(cookie).toContain(`${STATE_COOKIE}=${state}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  test("요청마다 다른 state를 만든다", () => {
    const state = () =>
      new URL(handleLogin(request("/api/auth/login"), config).headers.get("location")!).searchParams.get("state");
    expect(state()).not.toBe(state());
  });

  test("redirect_uri는 요청 origin을 따른다", () => {
    const res = handleLogin(new NextRequest("http://localhost:3000/api/auth/login"), config);
    expect(new URL(res.headers.get("location")!).searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/callback",
    );
  });
});

describe("handleCallback", () => {
  test("state가 맞으면 code를 교환해 암호화된 세션 쿠키를 쓴다", async () => {
    const d = deps();
    const res = await handleCallback(
      request("/api/auth/callback?code=c0de&state=abc", { [STATE_COOKIE]: "abc" }),
      config,
      d,
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(formBody(d.fetch.mock.calls[0][1])).toMatchObject({
      code: "c0de",
      redirect_uri: `${ORIGIN}/api/auth/callback`,
    });

    const cookie = setCookie(res, SESSION_COOKIE)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toContain("ghu_a");
    const value = res.cookies.get(SESSION_COOKIE)!.value;
    expect(decodeSession(value, config.sessionKey)).toEqual({
      accessToken: "ghu_a",
      accessTokenExpiresAt: NOW + 28800 * 1000,
      refreshToken: "ghr_r",
      refreshTokenExpiresAt: NOW + 15897600 * 1000,
    });
    // 한 번 쓴 state는 지운다.
    expect(setCookie(res, STATE_COOKIE)).toMatch(/Max-Age=0/i);
  });

  test("state가 다르면 거부하고 code를 교환하지 않는다", async () => {
    const d = deps();
    const res = await handleCallback(
      request("/api/auth/callback?code=c0de&state=abc", { [STATE_COOKIE]: "xyz" }),
      config,
      d,
    );
    expect(res.status).toBe(400);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();
  });

  test("길이가 다른 state도 거부한다", async () => {
    const res = await handleCallback(
      request("/api/auth/callback?code=c&state=abc", { [STATE_COOKIE]: "abcd" }),
      config,
      deps(),
    );
    expect(res.status).toBe(400);
  });

  test("state 쿠키가 없으면 거부한다", async () => {
    const d = deps();
    const res = await handleCallback(request("/api/auth/callback?code=c0de&state=abc"), config, d);
    expect(res.status).toBe(400);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  test("state 파라미터가 없으면 거부한다", async () => {
    const res = await handleCallback(
      request("/api/auth/callback?code=c0de", { [STATE_COOKIE]: "abc" }),
      config,
      deps(),
    );
    expect(res.status).toBe(400);
  });

  test("사용자가 인가를 거절하면 거부한다", async () => {
    const d = deps();
    const res = await handleCallback(
      request("/api/auth/callback?error=access_denied&state=abc", { [STATE_COOKIE]: "abc" }),
      config,
      d,
    );
    expect(res.status).toBe(400);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  test("code 교환이 실패하면 502이고 세션을 쓰지 않는다", async () => {
    const d = deps(mockFetch(() => json({ error: "bad_verification_code" })));
    const res = await handleCallback(
      request("/api/auth/callback?code=c0de&state=abc", { [STATE_COOKIE]: "abc" }),
      config,
      d,
    );
    expect(res.status).toBe(502);
    expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();
    expect(d.warn).toHaveBeenCalled();
  });
});

describe("handleRefresh", () => {
  const session: Session = {
    accessToken: "ghu_old",
    accessTokenExpiresAt: NOW - HOUR,
    refreshToken: "ghr_old",
    refreshTokenExpiresAt: NOW + 4000 * HOUR,
  };
  const cookie = () => ({ [SESSION_COOKIE]: encodeSession(session, config.sessionKey) });

  test("만료된 세션을 갱신해 쿠키를 다시 쓰고 원래 화면으로 돌려보낸다", async () => {
    const res = await handleRefresh(request("/api/auth/refresh?return_to=/repos", cookie()), config, deps());
    expect(res.headers.get("location")).toBe(`${ORIGIN}/repos`);
    const next = decodeSession(res.cookies.get(SESSION_COOKIE)!.value, config.sessionKey);
    expect(next?.accessToken).toBe("ghu_a");
    expect(next?.accessTokenExpiresAt).toBe(NOW + 28800 * 1000);
  });

  test("갱신이 거부되면 세션 쿠키를 지운다", async () => {
    const res = await handleRefresh(
      request("/api/auth/refresh", cookie()),
      config,
      deps(mockFetch(() => json({ error: "bad_refresh_token" }))),
    );
    expect(setCookie(res, SESSION_COOKIE)).toMatch(/Max-Age=0/i);
  });

  test("갱신이 필요 없으면 쿠키를 건드리지 않는다", async () => {
    const fresh = { ...session, accessTokenExpiresAt: NOW + HOUR };
    const d = deps();
    const res = await handleRefresh(
      request("/api/auth/refresh", { [SESSION_COOKIE]: encodeSession(fresh, config.sessionKey) }),
      config,
      d,
    );
    expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();
    expect(d.fetch).not.toHaveBeenCalled();
  });

  test("갱신에 성공하면 갱신 시도 표시를 붙이지 않는다", async () => {
    const res = await handleRefresh(request("/api/auth/refresh?return_to=/", cookie()), config, deps());
    expect(new URL(res.headers.get("location")!).searchParams.has(REFRESH_ATTEMPTED_PARAM)).toBe(false);
  });

  test("만료 직전에 갱신이 거부돼도 화면이 다시 갱신으로 보내지 않는다", async () => {
    // 여유 시간(5분) 안이지만 아직 만료되지 않은 세션. 다른 탭이 refresh token을 먼저 써 버린 상황이다.
    const nearExpiry = { ...session, accessTokenExpiresAt: NOW + 2 * 60 * 1000 };
    const sessionCookie = encodeSession(nearExpiry, config.sessionKey);
    expect(resolvePageSession(sessionCookie, config.sessionKey, NOW)).toEqual({ kind: "refresh" });

    const res = await handleRefresh(
      request("/api/auth/refresh?return_to=/", { [SESSION_COOKIE]: sessionCookie }),
      config,
      deps(mockFetch(() => json({ error: "bad_refresh_token" }))),
    );
    expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/");
    const refreshAttempted = location.searchParams.has(REFRESH_ATTEMPTED_PARAM);
    expect(resolvePageSession(sessionCookie, config.sessionKey, NOW, refreshAttempted)).toEqual({
      kind: "ok",
      session: nearExpiry,
    });
  });

  test("만료 직전에 GitHub이 5xx를 줘도 화면이 다시 갱신으로 보내지 않는다", async () => {
    const nearExpiry = { ...session, accessTokenExpiresAt: NOW + 2 * 60 * 1000 };
    const sessionCookie = encodeSession(nearExpiry, config.sessionKey);
    const res = await handleRefresh(
      request("/api/auth/refresh?return_to=/", { [SESSION_COOKIE]: sessionCookie }),
      config,
      deps(mockFetch(() => new Response("bad gateway", { status: 502 }))),
    );
    const refreshAttempted = new URL(res.headers.get("location")!).searchParams.has(REFRESH_ATTEMPTED_PARAM);
    expect(resolvePageSession(sessionCookie, config.sessionKey, NOW, refreshAttempted).kind).toBe("ok");
  });

  test("변조된 쿠키는 지운다", async () => {
    const res = await handleRefresh(request("/api/auth/refresh", { [SESSION_COOKIE]: "garbage" }), config, deps());
    expect(setCookie(res, SESSION_COOKIE)).toMatch(/Max-Age=0/i);
  });

  test("다른 사이트로는 돌려보내지 않는다", async () => {
    const res = await handleRefresh(request("/api/auth/refresh?return_to=//evil.com", cookie()), config, deps());
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
  });
});

describe("safeReturnTo", () => {
  test("같은 사이트 경로만 받는다", () => {
    expect(safeReturnTo("/a?b=1")).toBe("/a?b=1");
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo("https://evil.com")).toBe("/");
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("/\\evil.com")).toBe("/");
  });
});

describe("handleLogout", () => {
  test("세션 쿠키를 지우고 첫 화면으로 보낸다", () => {
    const res = handleLogout(request("/api/auth/logout", {}, "POST"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    const cookie = setCookie(res, SESSION_COOKIE)!;
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/Path=\//i);
  });
});
