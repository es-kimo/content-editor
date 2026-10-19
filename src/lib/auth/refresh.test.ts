import { randomBytes } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { json, mockFetch } from "@/test/mock-fetch";

import { resolvePageSession } from "./account";
import { ensureFreshSession } from "./refresh";
import { encodeSession, type Session } from "./session";

const config = { clientId: "cid", clientSecret: "secret" };
const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

const session: Session = {
  accessToken: "ghu_old",
  accessTokenExpiresAt: NOW + 8 * HOUR,
  refreshToken: "ghr_old",
  refreshTokenExpiresAt: NOW + 4000 * HOUR,
};

const refreshed = () =>
  mockFetch(() =>
    json({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new", refresh_token_expires_in: 15897600 }),
  );
const rejected = () => mockFetch(() => json({ error: "bad_refresh_token" }));

describe("ensureFreshSession", () => {
  test("만료 전이면 갱신하지 않고 GitHub도 부르지 않는다", async () => {
    const fetch = refreshed();
    expect(await ensureFreshSession(session, config, { fetch, now: NOW, warn: vi.fn() })).toEqual({
      kind: "fresh",
      session,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("만료 시각이 지난 세션은 갱신 경로를 탄다", async () => {
    const fetch = refreshed();
    const later = NOW + 9 * HOUR;
    const result = await ensureFreshSession(session, config, { fetch, now: later, warn: vi.fn() });
    expect(result).toEqual({
      kind: "refreshed",
      session: {
        accessToken: "ghu_new",
        accessTokenExpiresAt: later + 28800 * 1000,
        refreshToken: "ghr_new",
        refreshTokenExpiresAt: later + 15897600 * 1000,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("만료 직전(여유 시간 안)이면 미리 갱신한다", async () => {
    const result = await ensureFreshSession(session, config, {
      fetch: refreshed(),
      now: NOW + 8 * HOUR - 60_000,
      warn: vi.fn(),
    });
    expect(result.kind).toBe("refreshed");
  });

  test("만료 후 갱신이 거부되면 다시 로그인해야 한다", async () => {
    const warn = vi.fn();
    const result = await ensureFreshSession(session, config, { fetch: rejected(), now: NOW + 9 * HOUR, warn });
    expect(result).toEqual({ kind: "expired" });
    expect(warn).toHaveBeenCalled();
  });

  test("만료 직전에 갱신이 거부되면 남은 시간 동안 기존 토큰을 쓴다", async () => {
    const result = await ensureFreshSession(session, config, {
      fetch: rejected(),
      now: NOW + 8 * HOUR - 60_000,
      warn: vi.fn(),
    });
    expect(result).toEqual({ kind: "fresh", session });
  });

  test("refresh token도 만료됐으면 GitHub을 부르지 않고 만료로 본다", async () => {
    const fetch = refreshed();
    const result = await ensureFreshSession(session, config, { fetch, now: NOW + 5000 * HOUR, warn: vi.fn() });
    expect(result).toEqual({ kind: "expired" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("만료 없는 토큰은 언제든 그대로 쓴다", async () => {
    const forever: Session = {
      accessToken: "a",
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    };
    const fetch = refreshed();
    expect(await ensureFreshSession(forever, config, { fetch, now: NOW * 10, warn: vi.fn() })).toEqual({
      kind: "fresh",
      session: forever,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("네트워크 오류는 삼키지 않는다", async () => {
    const fetch = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(ensureFreshSession(session, config, { fetch, now: NOW + 9 * HOUR, warn: vi.fn() })).rejects.toThrow(
      "fetch failed",
    );
  });
});

describe("resolvePageSession", () => {
  const key = randomBytes(32);
  const cookie = encodeSession(session, key);

  test("쿠키가 없거나 변조됐으면 로그인 전 상태", () => {
    expect(resolvePageSession(undefined, key, NOW)).toEqual({ kind: "anonymous" });
    const tampered = (cookie[0] === "A" ? "B" : "A") + cookie.slice(1);
    expect(resolvePageSession(tampered, key, NOW)).toEqual({ kind: "anonymous" });
  });

  test("유효한 세션은 그대로 쓴다", () => {
    expect(resolvePageSession(cookie, key, NOW)).toEqual({ kind: "ok", session });
  });

  test("만료 시각이 지난 세션은 갱신 경로로 보낸다", () => {
    expect(resolvePageSession(cookie, key, NOW + 9 * HOUR)).toEqual({ kind: "refresh" });
  });

  test("갱신 라우트를 거쳐 왔으면 만료 직전이어도 다시 갱신으로 보내지 않는다", () => {
    const nearExpiry = NOW + 8 * HOUR - 60 * 1000;
    expect(resolvePageSession(cookie, key, nearExpiry)).toEqual({ kind: "refresh" });
    expect(resolvePageSession(cookie, key, nearExpiry, true)).toEqual({ kind: "ok", session });
  });
});
