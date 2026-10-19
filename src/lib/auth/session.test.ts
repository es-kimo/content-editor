import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import { readAuthConfig } from "./config";
import { parseKey, seal, unseal } from "./crypto";
import { decodeSession, encodeSession, needsRefresh, REFRESH_MARGIN_MS, sessionMaxAge, type Session } from "./session";

const key = randomBytes(32);
const session: Session = {
  accessToken: "ghu_access",
  accessTokenExpiresAt: 1_000_000,
  refreshToken: "ghr_refresh",
  refreshTokenExpiresAt: 9_000_000,
};

/** base64url 문자열의 한 글자를 다른 글자로 바꾼다. */
function flip(value: string, index: number): string {
  const c = value[index] === "A" ? "B" : "A";
  return value.slice(0, index) + c + value.slice(index + 1);
}

describe("쿠키 암호화", () => {
  test("암호화한 세션을 복호화하면 원래 세션이 나온다", () => {
    expect(decodeSession(encodeSession(session, key), key)).toEqual(session);
  });

  test("만료 없는 세션도 왕복한다", () => {
    const s: Session = {
      accessToken: "a",
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    };
    expect(decodeSession(encodeSession(s, key), key)).toEqual(s);
  });

  test("같은 세션도 매번 다른 암호문이 된다", () => {
    expect(encodeSession(session, key)).not.toBe(encodeSession(session, key));
  });

  test("암호문에 토큰이 평문으로 드러나지 않는다", () => {
    const sealed = encodeSession(session, key);
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("ghu_access");
  });

  test("암호문 어느 위치를 바꿔도 복호화가 거부된다", () => {
    const sealed = encodeSession(session, key);
    // 마지막 글자는 base64 패딩 비트만 바뀔 수 있어서 제외한다.
    for (const i of [0, 13, 20, 30, sealed.length - 2]) {
      expect(decodeSession(flip(sealed, i), key)).toBeNull();
    }
  });

  test("잘린 쿠키, 빈 쿠키, 쓰레기 값은 거부된다", () => {
    const sealed = encodeSession(session, key);
    expect(decodeSession(sealed.slice(0, -4), key)).toBeNull();
    expect(decodeSession("", key)).toBeNull();
    expect(decodeSession(undefined, key)).toBeNull();
    expect(decodeSession("not-a-cookie", key)).toBeNull();
  });

  test("다른 키로 만든 쿠키는 거부된다", () => {
    expect(decodeSession(encodeSession(session, randomBytes(32)), key)).toBeNull();
  });

  test("복호화는 되지만 세션 형식이 아니면 거부된다", () => {
    expect(decodeSession(seal(JSON.stringify({ accessToken: 1 }), key), key)).toBeNull();
    expect(decodeSession(seal("[]", key), key)).toBeNull();
    expect(decodeSession(seal("{", key), key)).toBeNull();
    expect(unseal(seal("hello", key), key)).toBe("hello");
  });
});

describe("SESSION_SECRET", () => {
  test("base64url 32바이트 키를 읽는다", () => {
    const secret = randomBytes(32).toString("base64url");
    expect(parseKey(secret)).toHaveLength(32);
    expect(
      readAuthConfig({ GITHUB_APP_CLIENT_ID: "id", GITHUB_APP_CLIENT_SECRET: "s", SESSION_SECRET: secret }).sessionKey,
    ).toEqual(Buffer.from(secret, "base64url"));
  });

  test("길이가 32바이트가 아니면 예외", () => {
    expect(() => parseKey(randomBytes(16).toString("base64url"))).toThrow(/32바이트/);
  });

  test("환경변수가 빠지면 예외", () => {
    expect(() => readAuthConfig({ GITHUB_APP_CLIENT_ID: "id" })).toThrow(/GITHUB_APP_CLIENT_SECRET/);
  });
});

describe("needsRefresh", () => {
  test("만료까지 여유가 있으면 갱신하지 않는다", () => {
    expect(needsRefresh(session, 1_000_000 - REFRESH_MARGIN_MS - 1)).toBe(false);
  });

  test("만료가 가까우면 갱신한다", () => {
    expect(needsRefresh(session, 1_000_000 - REFRESH_MARGIN_MS)).toBe(true);
  });

  test("만료 시각이 지났으면 갱신한다", () => {
    expect(needsRefresh(session, 2_000_000)).toBe(true);
  });

  test("만료 없는 토큰은 갱신하지 않는다", () => {
    expect(needsRefresh({ ...session, accessTokenExpiresAt: null }, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("sessionMaxAge", () => {
  test("refresh token 만료까지 쿠키를 유지한다", () => {
    expect(sessionMaxAge(session, 1_000_000)).toBe(8000);
  });

  test("만료 없는 토큰이면 긴 기간을 준다", () => {
    const s: Session = {
      accessToken: "a",
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    };
    expect(sessionMaxAge(s, 0)).toBeGreaterThan(30 * 24 * 60 * 60);
  });
});
