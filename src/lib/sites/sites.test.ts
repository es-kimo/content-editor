import { describe, expect, test } from "vitest";

import { loadAccount } from "@/lib/auth/account";
import { json, mockFetch } from "@/test/mock-fetch";

import { allowsRepo, normalizeHost, resolveRepoAccess, siteForHeaders, siteForHost, SITES } from "./sites";

const repo = (full_name: string, id: number) => ({
  id,
  full_name,
  private: true,
  html_url: `https://github.com/${full_name}`,
});

const YJSHD = repo("es-kimo/yjshd", 1);
const SITE = repo("es-kimo/site", 2);
const OTHER = repo("es-kimo/other", 3);

/** 설치 두 개에 레포가 나뉘어 있는 GitHub 계정 모의. */
function accountFetch(installations: { id: number; repos: ReturnType<typeof repo>[] }[]) {
  return mockFetch((url) => {
    if (url.pathname === "/user") {
      return json({ login: "kimo", name: null, avatar_url: "", html_url: "https://github.com/kimo" });
    }
    if (url.pathname === "/user/installations") {
      return json({ installations: installations.map((i) => ({ id: i.id, account: { login: "es-kimo" } })) });
    }
    const m = url.pathname.match(/^\/user\/installations\/(\d+)\/repositories$/);
    if (m) return json({ repositories: installations.find((i) => i.id === Number(m[1]))?.repos ?? [] });
    return undefined;
  });
}

/** 요청 Host로 사이트를 고르고, 로그인 사용자의 레포 중 그 도메인에서 보일 것을 고른다. 화면이 하는 순서와 같다. */
async function reposForRequest(host: string, fetchFn: typeof fetch) {
  const scope = siteForHeaders(new Headers({ host }));
  const account = await loadAccount("ghu_token", fetchFn);
  return resolveRepoAccess(
    scope,
    account.installations.flatMap((i) => i.repositories),
  );
}

describe("Host 헤더로 레포 고정", () => {
  const fetchAll = () =>
    accountFetch([
      { id: 10, repos: [YJSHD, OTHER] },
      { id: 20, repos: [SITE] },
    ]);

  test("editor.yonsei-jshd.com은 es-kimo/yjshd로 고정된다", async () => {
    expect(await reposForRequest("editor.yonsei-jshd.com", fetchAll())).toEqual({ kind: "pinned", repo: YJSHD });
  });

  test("editor.khryu.dev는 es-kimo/site로 고정된다", async () => {
    expect(await reposForRequest("editor.khryu.dev", fetchAll())).toEqual({ kind: "pinned", repo: SITE });
  });

  test("localhost는 접근 가능한 레포 전체를 보인다", async () => {
    expect(await reposForRequest("localhost:3000", fetchAll())).toEqual({ kind: "all", repos: [YJSHD, OTHER, SITE] });
  });

  test("*.vercel.app은 접근 가능한 레포 전체를 보인다", async () => {
    expect(await reposForRequest("content-editor-git-main-es-kimo.vercel.app", fetchAll())).toEqual({
      kind: "all",
      repos: [YJSHD, OTHER, SITE],
    });
  });

  test("고정된 레포에 권한이 없으면 forbidden이다", async () => {
    const fetchFn = accountFetch([{ id: 20, repos: [SITE, OTHER] }]);
    expect(await reposForRequest("editor.yonsei-jshd.com", fetchFn)).toEqual({
      kind: "forbidden",
      repo: "es-kimo/yjshd",
    });
  });
});

describe("siteForHost", () => {
  test("매핑된 Host는 대소문자, 포트, 끝의 점과 상관없이 고른다", () => {
    for (const host of ["editor.khryu.dev", "EDITOR.khryu.dev", "editor.khryu.dev:443", "editor.khryu.dev."]) {
      expect(siteForHost(host)).toEqual({ kind: "pinned", site: { host: "editor.khryu.dev", repo: "es-kimo/site" } });
    }
  });

  test("매핑된 도메인의 다른 서브도메인이나 접미사가 붙은 Host는 고정하지 않는다", () => {
    for (const host of ["khryu.dev", "x.editor.khryu.dev", "editor.khryu.dev.evil.com", "editor.khryu.dev-x"]) {
      expect(siteForHost(host)).toEqual({ kind: "open" });
    }
  });

  test("Host가 없거나 localhost, IP면 고정하지 않는다", () => {
    for (const host of [null, undefined, "", "localhost", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(siteForHost(host)).toEqual({ kind: "open" });
    }
  });

  test("사이트 목록은 두 도메인을 PRD 5.6대로 매핑한다", () => {
    expect(SITES).toEqual([
      { host: "editor.yonsei-jshd.com", repo: "es-kimo/yjshd" },
      { host: "editor.khryu.dev", repo: "es-kimo/site" },
    ]);
  });
});

describe("normalizeHost", () => {
  test("IPv6 주소의 포트를 뗀다", () => {
    expect(normalizeHost("[::1]:3000")).toBe("[::1]");
    expect(normalizeHost("[::1]")).toBe("[::1]");
  });
});

describe("allowsRepo", () => {
  const pinned = siteForHost("editor.yonsei-jshd.com");

  test("고정된 도메인에서는 그 레포만 연다", () => {
    expect(allowsRepo(pinned, "es-kimo/yjshd")).toBe(true);
    expect(allowsRepo(pinned, "ES-KIMO/YJSHD")).toBe(true);
    expect(allowsRepo(pinned, "es-kimo/site")).toBe(false);
  });

  test("고정되지 않은 도메인에서는 어느 레포든 연다", () => {
    expect(allowsRepo(siteForHost("localhost:3000"), "es-kimo/site")).toBe(true);
  });
});

describe("resolveRepoAccess", () => {
  test("레포 이름을 대소문자 구분 없이 맞춘다", () => {
    const upper = repo("ES-Kimo/YJSHD", 1);
    expect(resolveRepoAccess(siteForHost("editor.yonsei-jshd.com"), [upper])).toEqual({ kind: "pinned", repo: upper });
  });
});
