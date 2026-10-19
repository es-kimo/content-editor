import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { parseEditorConfig } from "@/lib/editor-config";
import { createGitHubClient, type GitHubClient } from "@/lib/github";
import { testConfig } from "@/test/config";
import { fakeGitHub } from "@/test/fake-github";
import { loadFixtures } from "@/test/fixtures";

import { fetchTree, listPosts } from "./posts";

const REPO = "es-kimo/yjshd";

const meta = (fields: string) => `export const metadata = { ${fields} };\n\n# 본문\n`;

const boardConfig = (branch = "main") =>
  testConfig([{ name: "게시판", path: "content/4.게시판/{slug}/page.mdx" }], branch);

const listBoard = (client: GitHubClient, config = boardConfig()) =>
  listPosts(client, REPO, config, config.collections[0]);

describe("listPosts", () => {
  test("path 패턴에 맞는 파일만 목록에 넣고 metadata의 title·status·createdAt을 보인다", async () => {
    const fetch = fakeGitHub(REPO, "main", [
      {
        path: "content/4.게시판/1.휴진/page.mdx",
        content: meta(`title: '휴진 안내', other: { status: "ready", createdAt: "2020-11-20T00:00:00Z" }`),
      },
      { path: "content/4.게시판/1.휴진/1.png", content: new Uint8Array([137, 80, 78, 71]) },
      { path: "content/4.게시판/page.mdx", content: meta(`title: "패턴보다 얕다"`) },
      { path: "content/4.게시판/a/b/page.mdx", content: meta(`title: "패턴보다 깊다"`) },
      { path: "content/3.강좌/x/page.mdx", content: meta(`title: "다른 컬렉션"`) },
      { path: "content/4.게시판/2.메모/notes.md", content: "# 다른 파일" },
    ]);
    const client = createGitHubClient("ghu_token", fetch);

    const posts = await listBoard(client);

    expect(posts).toEqual([
      {
        path: "content/4.게시판/1.휴진/page.mdx",
        params: { slug: "1.휴진" },
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        title: "휴진 안내",
        titleFromMetadata: true,
        status: "ready",
        createdAt: "2020-11-20T00:00:00Z",
        problem: null,
      },
    ]);
    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer ghu_token");
  });

  test("트리 1번과 GraphQL 1번으로 끝나고, 호출 수를 센다", async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `content/4.게시판/${i}/page.mdx`,
      content: meta(`title: "글 ${i}"`),
    }));
    const fetch = fakeGitHub(REPO, "main", files);
    const client = createGitHubClient("t", fetch);

    const posts = await listBoard(client);

    expect(posts).toHaveLength(30);
    expect(client.calls).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      `/repos/${REPO}/git/trees/main`,
      "/graphql",
    ]);
  });

  test("글이 100편을 넘으면 GraphQL을 100편씩 나눠 부른다", async () => {
    const files = Array.from({ length: 150 }, (_, i) => ({
      path: `content/4.게시판/${i}/page.mdx`,
      content: meta(`title: "글 ${i}"`),
    }));
    const client = createGitHubClient("t", fakeGitHub(REPO, "main", files));

    const posts = await listBoard(client);

    expect(posts).toHaveLength(150);
    expect(posts.every((p) => p.titleFromMetadata)).toBe(true);
    expect(client.calls).toBe(3);
  });

  test("metadata를 읽지 못하면 title은 파일명(slug)이고 이유를 남긴다", async () => {
    const client = createGitHubClient(
      "t",
      fakeGitHub(REPO, "main", [
        { path: "content/4.게시판/식/page.mdx", content: meta(`title: someVariable`) },
        { path: "content/4.게시판/없음/page.mdx", content: "# metadata 없는 글\n" },
        { path: "content/4.게시판/깨짐/page.mdx", content: "<div>\n" },
        { path: "content/4.게시판/제목없음/page.mdx", content: meta(`other: { status: "draft" }`) },
      ]),
    );

    const posts = await listBoard(client);
    const bySlug = Object.fromEntries(posts.map((p) => [p.params.slug, p]));

    expect(bySlug["식"]).toMatchObject({
      title: "식",
      titleFromMetadata: false,
      problem: expect.stringContaining("Identifier"),
    });
    expect(bySlug["없음"]).toMatchObject({
      title: "없음",
      titleFromMetadata: false,
      problem: "metadata export가 없다",
    });
    expect(bySlug["깨짐"]).toMatchObject({ title: "깨짐", titleFromMetadata: false });
    expect(bySlug["깨짐"].problem).toBeTruthy();
    expect(bySlug["제목없음"]).toMatchObject({ title: "제목없음", titleFromMetadata: false, status: "draft" });
  });

  test("createdAt 내림차순, 없는 글은 뒤에, 같으면 경로순으로 정렬한다", async () => {
    const at = (date: string) => meta(`title: "${date}", other: { createdAt: "${date}" }`);
    const client = createGitHubClient(
      "t",
      fakeGitHub(REPO, "main", [
        { path: "content/4.게시판/a/page.mdx", content: at("2020-01-01T00:00:00Z") },
        { path: "content/4.게시판/b/page.mdx", content: meta(`title: "날짜 없음 b"`) },
        { path: "content/4.게시판/c/page.mdx", content: at("2024-05-01T00:00:00Z") },
        { path: "content/4.게시판/d/page.mdx", content: meta(`title: "날짜 없음 d"`) },
        { path: "content/4.게시판/e/page.mdx", content: at("2022-03-01T00:00:00Z") },
      ]),
    );

    const posts = await listBoard(client);

    expect(posts.map((p) => p.params.slug)).toEqual(["c", "e", "a", "b", "d"]);
  });

  test("config의 branch로 트리를 읽는다", async () => {
    const fetch = fakeGitHub(REPO, "blog", [{ path: "content/4.게시판/a/page.mdx", content: meta(`title: "a"`) }]);
    const posts = await listBoard(createGitHubClient("t", fetch), boardConfig("blog"));
    expect(posts).toHaveLength(1);
    expect(String(fetch.mock.calls[0][0])).toContain("/git/trees/blog?recursive=1");
  });

  test("트리가 잘려 오면 일부만 보여 주지 않고 실패한다", async () => {
    const client = createGitHubClient("t", fakeGitHub(REPO, "main", [], { truncated: true }));
    await expect(fetchTree(client, REPO, "main")).rejects.toThrow("잘렸다");
  });

  test("API가 실패하면 상태 코드와 함께 던진다", async () => {
    const client = createGitHubClient("t", async () => Response.json({ message: "Bad credentials" }, { status: 401 }));
    await expect(listBoard(client)).rejects.toMatchObject({ name: "GitHubApiError", status: 401 });
  });

  test("GraphQL이 errors를 돌려주면 던진다", async () => {
    const tree = fakeGitHub(REPO, "main", [{ path: "content/4.게시판/a/page.mdx", content: meta(`title: "a"`) }]);
    const client = createGitHubClient("t", async (input, init) =>
      String(input).endsWith("/graphql")
        ? Response.json({ errors: [{ message: "rate limited" }] })
        : tree(input as string, init),
    );
    await expect(listBoard(client)).rejects.toThrow("rate limited");
  });
});

describe("listPosts: yjshd 픽스처", () => {
  const fixtures = loadFixtures("yjshd");
  const yjshdConfig = () => {
    const file = path.resolve(import.meta.dirname, "../../../docs/editor-config/yjshd.editor.config.json");
    const result = parseEditorConfig(readFileSync(file, "utf8"));
    if (!result.ok) throw new Error("yjshd config 오류");
    return result.config;
  };

  test.skipIf(!fixtures)("게시판 47편을 API 2번으로 읽고 모두 metadata의 title을 보인다", async () => {
    const files = fixtures!.map((f) => ({ path: `content/${f.path.split(path.sep).join("/")}`, content: f.source }));
    const client = createGitHubClient("t", fakeGitHub(REPO, "main", files));
    const config = yjshdConfig();
    const board = config.collections.find((c) => c.name === "게시판")!;

    const started = performance.now();
    const posts = await listPosts(client, REPO, config, board);
    const elapsed = performance.now() - started;

    expect(posts).toHaveLength(47);
    expect(posts.filter((p) => !p.titleFromMetadata).map((p) => [p.path, p.problem])).toEqual([]);
    expect(posts.every((p) => p.status !== null && p.createdAt !== null)).toBe(true);
    expect(client.calls).toBe(2);
    // 네트워크를 뺀 처리 시간. 실제 화면 시간은 여기에 API 2번의 왕복이 더해진다.
    expect(elapsed).toBeLessThan(1000);
  });
});
