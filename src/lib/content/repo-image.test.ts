import { describe, expect, test } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { testConfig } from "@/test/config";
import { fakeGitHub, type FakeFile } from "@/test/fake-github";

import { readRepoImage, repoImageHref } from "./repo-image";

const REPO = "es-kimo/yjshd";
const POST = "content/게시판/일반/page.mdx";

const config = testConfig([{ name: "게시판", path: "content/게시판/{slug}/page.mdx" }], "release");

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";

const files: FakeFile[] = [
  { path: POST, content: "# 일반\n" },
  { path: "content/게시판/일반/1.png", content: png },
  { path: "content/게시판/일반/img/로고.SVG", content: svg },
  { path: "content/게시판/공용.jpg", content: new Uint8Array([0xff, 0xd8, 0xff]) },
  { path: "루트.gif", content: new Uint8Array([71, 73, 70]) },
];

const read = (postPath: string, importPath: string) => {
  const client = createGitHubClient("token", fakeGitHub(REPO, "release", files));
  return { client, result: readRepoImage(client, REPO, config, postPath, importPath) };
};

describe("readRepoImage", () => {
  test("글 폴더의 이미지를 import 경로로 읽으면 config 브랜치의 바이트와 확장자에 맞는 Content-Type을 돌려준다", async () => {
    const image = await read(POST, "./1.png").result;
    expect(image).toEqual({ ok: true, bytes: png, contentType: "image/png" });
  });

  test("하위 폴더와 상위 폴더의 이미지도 글 폴더 기준으로 읽는다", async () => {
    const nested = await read(POST, "./img/로고.SVG").result;
    expect(nested).toMatchObject({ ok: true, contentType: "image/svg+xml" });
    if (nested.ok) expect(new TextDecoder().decode(nested.bytes)).toBe(svg);

    expect(await read(POST, "../공용.jpg").result).toMatchObject({ ok: true, contentType: "image/jpeg" });
  });

  test.each([
    ["레포 루트를 넘는 경로", POST, "./../../../../x.png", "outside-repo"],
    ["글 폴더 기준 상대 경로가 아닌 경로", POST, "/etc/x.png", "outside-repo"],
    ["이미지가 아닌 파일", POST, "./a.mdx", "not-image"],
    ["어느 컬렉션에도 맞지 않는 글 경로", "README.mdx", "./1.png", "not-post"],
  ])("%s는 GitHub를 부르지 않고 실패한다", async (_, postPath, importPath, reason) => {
    const { client, result } = read(postPath, importPath);
    expect(await result).toEqual({ ok: false, reason });
    expect(client.calls).toBe(0);
  });

  test("레포 루트까지만 올라가는 경로는 레포 안이므로 읽는다", async () => {
    expect(await read(POST, "./../../../루트.gif").result).toMatchObject({ ok: true, contentType: "image/gif" });
  });

  test.each([
    ["폴더에 없는 파일", "./2.png"],
    ["없는 폴더의 파일", "./없는/1.png"],
  ])("%s은 파일 없음으로 실패한다", async (_, importPath) => {
    expect(await read(POST, importPath).result).toEqual({ ok: false, reason: "missing" });
  });
});

describe("repoImageHref", () => {
  test("레포 이미지 라우트 주소에 글 경로와 import 경로를 담는다", () => {
    const href = new URL(repoImageHref(REPO, POST, "./1.png"), "https://editor.test");
    expect(href.pathname).toBe(`/repos/${REPO}/image`);
    expect(href.searchParams.get("post")).toBe(POST);
    expect(href.searchParams.get("src")).toBe("./1.png");
  });
});
