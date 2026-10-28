import { createVerify, generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { appJwt, createGitHub, WRITE_GAP_MS } from "./github.mts";

describe("createGitHub 쓰기 간격", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({})));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("쓰기는 앞 쓰기가 끝나고 1초가 지나야 나간다", async () => {
    const gh = createGitHub("t");
    await gh.request("/repos/o/r/issues", { method: "POST", body: { title: "1" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = gh.request("/repos/o/r/issues", { method: "POST", body: { title: "2" } });
    await vi.advanceTimersByTimeAsync(WRITE_GAP_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("한꺼번에 부른 쓰기도 1초씩 띄워 하나씩 나간다", async () => {
    const gh = createGitHub("t");
    const sentAt: number[] = [];
    fetchMock.mockImplementation(() => {
      sentAt.push(Date.now());
      return Promise.resolve(Response.json({}));
    });

    const all = Promise.all([1, 2, 3].map((n) => gh.request(`/repos/o/r/issues/${n}`, { method: "PATCH", body: {} })));
    await vi.advanceTimersByTimeAsync(WRITE_GAP_MS * 3);
    await all;

    expect(sentAt).toHaveLength(3);
    expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(WRITE_GAP_MS);
    expect(sentAt[2]! - sentAt[1]!).toBeGreaterThanOrEqual(WRITE_GAP_MS);
  });

  test("읽기는 쓰기 직후에도 기다리지 않는다", async () => {
    const gh = createGitHub("t");
    await gh.request("/repos/o/r/issues", { method: "POST", body: {} });
    await gh.request("/repos/o/r/issues/1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("앞 쓰기가 실패해도 다음 쓰기는 1초 뒤 나간다", async () => {
    const gh = createGitHub("t");
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("nope", { status: 422 })));
    await expect(gh.request("/repos/o/r/issues", { method: "POST", body: {} })).rejects.toThrow("HTTP 422");

    const next = gh.request("/repos/o/r/issues", { method: "POST", body: {} });
    await vi.advanceTimersByTimeAsync(WRITE_GAP_MS);
    await expect(next).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("appJwt", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

  test("앱 키로 서명하고, 1분 앞당긴 발급 시각부터 10분 안에 만료된다", () => {
    const now = Date.parse("2026-10-28T00:00:00Z");
    const [header, payload, signature] = appJwt("123", pem, now).split(".");

    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString()) as {
      iat: number;
      exp: number;
      iss: string;
    };
    expect(claims.iss).toBe("123");
    expect(claims.iat).toBe(now / 1000 - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(10 * 60);
    expect(claims.exp).toBeGreaterThan(now / 1000);

    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, signature!, "base64url");
    expect(verified).toBe(true);
  });
});
