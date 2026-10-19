import { describe, expect, test } from "vitest";

import { GitHubApiError, isUnauthorized } from "@/lib/github";
import { json, mockFetch } from "@/test/mock-fetch";

import { loadEditorConfig } from "./load";

const CONTENTS_URL = "https://api.github.com/repos/es-kimo/yjshd/contents/editor.config.json";

const contentsRoute = (res: () => Response) => (url: URL) => (url.href === CONTENTS_URL ? res() : undefined);

const valid = {
  branch: "main",
  collections: [{ name: "게시판", path: "content/4.게시판/{slug}/page.mdx", editor: "wysiwyg" }],
};

describe("loadEditorConfig", () => {
  test("레포 루트의 config를 raw로 받아 검증한다", async () => {
    const fetch = mockFetch(contentsRoute(() => new Response(JSON.stringify(valid))));
    const result = await loadEditorConfig("es-kimo/yjshd", "ghu_token", fetch);
    expect(result).toMatchObject({ kind: "ok", config: { branch: "main", syntax: { gfm: false, math: false } } });

    const [, init] = fetch.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("accept")).toBe("application/vnd.github.raw+json");
    expect(headers.get("authorization")).toBe("Bearer ghu_token");
    // ref를 주지 않아 기본 브랜치에서 읽는다.
    expect(new URL(String(fetch.mock.calls[0][0])).search).toBe("");
  });

  test("404면 config가 없다고 돌려준다", async () => {
    const fetch = mockFetch(contentsRoute(() => json({ message: "Not Found" }, 404)));
    expect(await loadEditorConfig("es-kimo/yjshd", "t", fetch)).toEqual({ kind: "missing" });
  });

  test("검증에 실패하면 오류 목록을 돌려준다", async () => {
    const fetch = mockFetch(contentsRoute(() => new Response(JSON.stringify({ ...valid, branch: undefined }))));
    expect(await loadEditorConfig("es-kimo/yjshd", "t", fetch)).toEqual({
      kind: "invalid",
      issues: [{ path: "branch", message: "필수 항목이 없다" }],
    });
  });

  test("그 밖의 HTTP 오류는 상태 코드와 함께 예외로 던진다", async () => {
    const fetch = mockFetch(contentsRoute(() => json({ message: "Bad credentials" }, 401)));
    const error = await loadEditorConfig("es-kimo/yjshd", "t", fetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).toMatchObject({ status: 401, message: expect.stringContaining("HTTP 401") });
  });

  test("401이면 화면이 로그인 링크로 보낼 오류로 던진다", async () => {
    const fetch = mockFetch(contentsRoute(() => json({ message: "Bad credentials" }, 401)));
    const error = await loadEditorConfig("es-kimo/yjshd", "t", fetch).catch((e: unknown) => e);
    expect(isUnauthorized(error)).toBe(true);
  });

  test("처음 화면에 보일 오류 안내는 레포와 config 파일 이름을 담는다", async () => {
    const fetch = mockFetch(contentsRoute(() => json({ message: "Server Error" }, 502)));
    await expect(loadEditorConfig("es-kimo/yjshd", "t", fetch)).rejects.toThrow(
      "es-kimo/yjshd의 editor.config.json을 읽지 못했다: HTTP 502",
    );
  });
});
