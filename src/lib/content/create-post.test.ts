import { describe, expect, test } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { fakeGitHub, type FakeFile } from "@/test/fake-github";

import { createPost, listSubmenus } from "./create-post";
import { listPosts } from "./posts";
import { readPost } from "./read";

const REPO = "es-kimo/yjshd";
const NOW = new Date("2026-10-19T03:04:05.678Z");
const config = yjshdConfig();
const [board, lecture] = config.collections;

const EXISTING = "content/4.게시판/10월 휴진 안내/page.mdx";
const LECTURE = "content/3.강좌/2.콩팥질환 정보/우울해요/page.mdx";

const setup = (files: FakeFile[] = []) => {
  const repo = fakeGitRepo(REPO, "main", [
    { path: EXISTING, content: `export const metadata = { title: "10월 휴진 안내" };\n\n# 10월 휴진 안내\n` },
    { path: LECTURE, content: `export const metadata = { title: "우울해요" };\n\n# 우울해요\n` },
    ...files,
  ]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);

describe("createPost", () => {
  test("게시판에 새 공지를 만들면 커밋 1개로 글이 생기고 글 목록에 나타난다", async () => {
    const { repo, client } = setup();
    const before = repo.head();

    const result = await createPost(client, REPO, config, { collection: "게시판", title: "11월 휴진 안내" }, NOW);

    const path = "content/4.게시판/11월 휴진 안내/page.mdx";
    expect(result).toEqual({ ok: true, path, commit: repo.head() });
    expect(repo.log()).toHaveLength(2);
    expect(repo.log()[0]).toMatchObject({ parents: [before], message: "post: 11월 휴진 안내" });

    const files = repo.paths().map((p) => ({ path: p, content: text(repo.file(p))! }));
    const listed = await listPosts(
      createGitHubClient("ghu_token", fakeGitHub(REPO, "main", files)),
      REPO,
      config,
      board!,
    );
    expect(listed.find((post) => post.path === path)).toMatchObject({
      title: "11월 휴진 안내",
      status: "ready",
      createdAt: "2026-10-19T03:04:05Z",
      problem: null,
    });
  });

  test("만든 글은 편집 화면에서 metadata 폼으로 열린다", async () => {
    const { client } = setup();

    const result = await createPost(client, REPO, config, { collection: "게시판", title: "11월 휴진 안내" }, NOW);

    const post = await readPost(client, REPO, config, result.ok ? result.path : "");
    expect(post?.doc.ok).toBe(true);
    expect(post?.metadata).toMatchObject({ editable: true, value: { title: "11월 휴진 안내", description: "" } });
  });

  test("제목의 경로에 쓸 수 없는 문자는 폴더 이름에서만 바꾸고 metadata 제목은 그대로 둔다", async () => {
    const { repo, client } = setup();

    const result = await createPost(client, REPO, config, { collection: "게시판", title: "휴진이 있나요?" }, NOW);

    expect(result).toMatchObject({ ok: true, path: "content/4.게시판/휴진이 있나요_/page.mdx" });
    expect(text(repo.file("content/4.게시판/휴진이 있나요_/page.mdx"))).toContain(`title: "휴진이 있나요?"`);
  });

  test("하위 메뉴가 있는 컬렉션은 고른 하위 메뉴 폴더 안에 만든다", async () => {
    const { repo, client } = setup();

    const result = await createPost(
      client,
      REPO,
      config,
      { collection: "강좌", title: "불면증이 심해요", submenu: "2.콩팥질환 정보" },
      NOW,
    );

    expect(result).toMatchObject({ ok: true, path: "content/3.강좌/2.콩팥질환 정보/불면증이 심해요/page.mdx" });
    expect(repo.file("content/3.강좌/2.콩팥질환 정보/불면증이 심해요/page.mdx")).toBeDefined();
  });

  test("하위 메뉴 뒤에 고정 단계가 있는 경로 패턴이면 그 단계 아래에 만든다", async () => {
    const custom = {
      ...config,
      collections: [{ ...lecture!, path: "content/3.강좌/{submenu}/posts/{slug}/page.mdx" }],
    };
    const { repo, client } = setup([{ path: "content/3.강좌/공지/posts/첫 글/page.mdx", content: "# 첫 글\n" }]);

    const result = await createPost(client, REPO, custom, { collection: "강좌", title: "새 글", submenu: "공지" }, NOW);

    expect(result).toMatchObject({ ok: true, path: "content/3.강좌/공지/posts/새 글/page.mdx" });
    expect(repo.file("content/3.강좌/공지/posts/새 글/page.mdx")).toBeDefined();
  });

  test("같은 폴더가 이미 있으면 만들지 않는다", async () => {
    const { repo, client } = setup();

    const result = await createPost(client, REPO, config, { collection: "게시판", title: " 10월  휴진 안내 " }, NOW);

    expect(result).toEqual({ ok: false, reason: "exists", path: EXISTING });
    expect(repo.log()).toHaveLength(1);
  });

  test("글 파일 없이 이미지만 있는 폴더도 이미 있는 것으로 보고 막는다", async () => {
    const { repo, client } = setup([{ path: "content/4.게시판/11월 휴진 안내/1.png", content: new Uint8Array([1]) }]);

    const result = await createPost(client, REPO, config, { collection: "게시판", title: "11월 휴진 안내" }, NOW);

    expect(result).toMatchObject({ ok: false, reason: "exists" });
    expect(repo.log()).toHaveLength(1);
  });

  test.each([
    [{ collection: "없는 컬렉션", title: "제목" }, "collection"],
    [{ collection: "게시판", title: "  " }, "title"],
    [{ collection: "게시판", title: "???" }, "title"],
    [{ collection: "강좌", title: "제목" }, "submenu"],
    [{ collection: "강좌", title: "제목", submenu: "9.새 메뉴" }, "submenu"],
  ] as const)("입력이 잘못되면 커밋하지 않고 그 필드를 알린다: %j", async (input, key) => {
    const { repo, client } = setup();

    const result = await createPost(client, REPO, config, input, NOW);

    expect(result).toMatchObject({ ok: false, reason: "invalid", errors: [{ key }] });
    expect(repo.log()).toHaveLength(1);
  });
});

describe("listSubmenus", () => {
  test("컬렉션에 글이 있는 하위 메뉴를 겹치지 않게 이름순으로 돌려준다", async () => {
    const { client } = setup([
      { path: "content/3.강좌/3.혈액투석 1,2,3/태풍/page.mdx", content: "# 태풍\n" },
      { path: "content/3.강좌/2.콩팥질환 정보/우울해요/1.png", content: new Uint8Array([1]) },
    ]);

    expect(await listSubmenus(client, REPO, config, lecture!)).toEqual(["2.콩팥질환 정보", "3.혈액투석 1,2,3"]);
  });
});
