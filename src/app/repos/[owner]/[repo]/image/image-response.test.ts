import { describe, expect, test } from "vitest";

import type { PageSession } from "@/lib/auth";
import { fakeGitHub } from "@/test/fake-github";
import { json } from "@/test/mock-fetch";

import { imageResponse } from "./image-response";

const REPO = "es-kimo/yjshd";
const POST = "content/게시판/일반/page.mdx";
const CONFIG = JSON.stringify({
  branch: "main",
  collections: [{ name: "게시판", path: "content/게시판/{slug}/page.mdx", editor: "wysiwyg" }],
});

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const signedIn: PageSession = {
  kind: "ok",
  session: { accessToken: "token", accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null },
};

/** config는 기본 브랜치에서, 글 폴더는 가짜 GitHub에서 읽는다. `configStatus`를 주면 config 요청이 그 상태로 실패한다. */
const github = (configStatus?: number): typeof fetch => {
  const repo = fakeGitHub(REPO, "main", [
    { path: POST, content: "# 일반\n" },
    { path: "content/게시판/일반/1.png", content: png },
    { path: "content/게시판/일반/2.svg", content: "<svg xmlns='http://www.w3.org/2000/svg'/>" },
  ]);
  return async (input, init) => {
    if (String(input).endsWith(`/repos/${REPO}/contents/editor.config.json`)) {
      return configStatus === undefined ? new Response(CONFIG) : json({ message: "실패" }, configStatus);
    }
    return repo(input, init);
  };
};

const respond = (src: string | null, session: PageSession = signedIn, fetchFn = github()) =>
  imageResponse({ repo: REPO, session, post: POST, src, fetchFn });

const expectSafeHeaders = (res: Response) => {
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
};

describe("imageResponse", () => {
  test("글 폴더의 이미지를 확장자에 맞는 Content-Type과 스크립트를 막는 헤더로 보낸다", async () => {
    const res = await respond("./1.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expectSafeHeaders(res);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  });

  test("SVG도 sandbox로 보내 문서로 열어도 스크립트가 돌지 않는다", async () => {
    const res = await respond("./2.svg");
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expectSafeHeaders(res);
  });

  test("로그인하지 않았으면 GitHub를 부르지 않고 401이다", async () => {
    const res = await respond("./1.png", { kind: "anonymous" }, async () => {
      throw new Error("GitHub를 불렀다");
    });
    expect(res.status).toBe(401);
    expectSafeHeaders(res);
  });

  test("토큰이 폐기돼 GitHub가 401이면 401이다", async () => {
    expect((await respond("./1.png", signedIn, github(401))).status).toBe(401);
  });

  test.each([
    ["폴더에 없는 파일", "./3.png"],
    ["레포 밖으로 나가는 경로", "./../../../../x.png"],
    ["이미지가 아닌 파일", "./page.mdx"],
    ["import 경로가 없는 요청", null],
  ])("%s은 404다", async (_, src) => {
    const res = await respond(src);
    expect(res.status).toBe(404);
    expectSafeHeaders(res);
  });

  test("레포의 편집 설정이 없으면 404다", async () => {
    expect((await respond("./1.png", signedIn, github(404))).status).toBe(404);
  });
});
