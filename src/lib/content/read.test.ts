import { describe, expect, test } from "vitest";

import { parseEditorConfig, type EditorConfig } from "@/lib/editor-config";
import { printMdx } from "@/lib/mdx-doc";
import { blobSha, fakeGitHub, type FakeFile } from "@/test/fake-github";

import { createGitHubClient } from "./client";
import { isImageFile, readPost } from "./read";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";

const SOURCE = `import image1 from "./1.png";

export const metadata = {
  title: '11월 휴진 안내',
  other: { status: "ready", createdAt: "2020-11-20T00:00:00Z" },
};

# 11월 휴진 안내

본문 <Image src={image1} alt="" />
`;

const config: EditorConfig = (() => {
  const result = parseEditorConfig(
    JSON.stringify({
      branch: "main",
      collections: [
        { name: "게시판", path: "content/4.게시판/{slug}/page.mdx", editor: "wysiwyg" },
        { name: "강좌", path: "content/3.강좌/{submenu}/{slug}/page.mdx", editor: "wysiwyg" },
      ],
    }),
  );
  if (!result.ok) throw new Error("config 오류");
  return result.config;
})();

const png = new Uint8Array([137, 80, 78, 71]);

const files: FakeFile[] = [
  { path: POST, content: SOURCE },
  { path: "content/4.게시판/1.휴진/10.png", content: png },
  { path: "content/4.게시판/1.휴진/2.JPG", content: new Uint8Array([1]) },
  { path: "content/4.게시판/1.휴진/1.png", content: new Uint8Array([2]) },
  { path: "content/4.게시판/1.휴진/notes.txt", content: "메모" },
  { path: "content/4.게시판/1.휴진/sub/3.png", content: new Uint8Array([3]) },
  { path: "content/4.게시판/2.다른글/page.mdx", content: "# 다른 글\n" },
  { path: "content/4.게시판/2.다른글/9.png", content: new Uint8Array([4]) },
];

describe("readPost", () => {
  test("metadata와 본문을 나눠 주고, 읽은 blob sha를 함께 돌려준다", async () => {
    const client = createGitHubClient("t", fakeGitHub(REPO, "main", files));
    const post = await readPost(client, REPO, config, POST);

    expect(post).not.toBeNull();
    expect(post!.collection.name).toBe("게시판");
    expect(post!.params).toEqual({ slug: "1.휴진" });
    expect(post!.sha).toBe(blobSha(SOURCE));
    expect(post!.source).toBe(SOURCE);
    expect(post!.metadata).toEqual({
      editable: true,
      value: { title: "11월 휴진 안내", other: { status: "ready", createdAt: "2020-11-20T00:00:00Z" } },
    });
    expect(post!.doc.ok && post!.doc.body).toBe('# 11월 휴진 안내\n\n본문 <Image src={image1} alt="" />\n');
    expect(printMdx(post!.doc)).toBe(SOURCE);
    // 글 폴더 목록 1번 + blob 1번
    expect(client.calls).toBe(2);
  });

  test("글 폴더 바로 안의 이미지만 이름순(숫자 순서)으로 돌려준다", async () => {
    const client = createGitHubClient("t", fakeGitHub(REPO, "main", files));
    const post = await readPost(client, REPO, config, POST);

    expect(post!.images).toEqual([
      { name: "1.png", path: "content/4.게시판/1.휴진/1.png", sha: blobSha(new Uint8Array([2])), size: 1 },
      { name: "2.JPG", path: "content/4.게시판/1.휴진/2.JPG", sha: blobSha(new Uint8Array([1])), size: 1 },
      { name: "10.png", path: "content/4.게시판/1.휴진/10.png", sha: blobSha(png), size: 4 },
    ]);
  });

  test("config의 branch에서 읽는다", async () => {
    const fetch = fakeGitHub(REPO, "blog", files);
    const post = await readPost(createGitHubClient("t", fetch), REPO, { ...config, branch: "blog" }, POST);
    expect(post?.sha).toBe(blobSha(SOURCE));
    expect(decodeURIComponent(String(fetch.mock.calls[0][0]))).toBe(
      `https://api.github.com/repos/${REPO}/contents/content/4.게시판/1.휴진?ref=blog`,
    );
  });

  test("submenu가 있는 컬렉션도 연다", async () => {
    const path = "content/3.강좌/1.예방/2.당뇨/page.mdx";
    const client = createGitHubClient("t", fakeGitHub(REPO, "main", [{ path, content: SOURCE }]));
    const post = await readPost(client, REPO, config, path);
    expect(post).toMatchObject({ collection: { name: "강좌" }, params: { submenu: "1.예방", slug: "2.당뇨" } });
  });

  test("metadata를 폼으로 읽을 수 없으면 이유를 돌려준다", async () => {
    const source = "export const metadata = { title: someVariable };\n\n본문\n";
    const client = createGitHubClient("t", fakeGitHub(REPO, "main", [{ path: POST, content: source }]));
    const post = await readPost(client, REPO, config, POST);
    expect(post!.metadata).toMatchObject({ editable: false, reason: expect.stringContaining("Identifier") });
    expect(post!.doc.ok && post!.doc.body).toBe("본문\n");
  });

  test("구간으로 나눌 수 없는 글은 metadata가 null이고 원문은 그대로 있다", async () => {
    const source = "# 본문\n\nexport const metadata = { title: 'a' };\n";
    const client = createGitHubClient("t", fakeGitHub(REPO, "main", [{ path: POST, content: source }]));
    const post = await readPost(client, REPO, config, POST);
    expect(post).toMatchObject({ metadata: null, source, doc: { ok: false, reason: "esm-after-content" } });
  });

  test("컬렉션에 없는 경로는 API를 부르지 않고 null", async () => {
    const fetch = fakeGitHub(REPO, "main", files);
    const client = createGitHubClient("t", fetch);
    for (const path of ["content/1.소개/a/page.mdx", "content/4.게시판/1.휴진/1.png", "../secret/page.mdx"]) {
      expect(await readPost(client, REPO, config, path)).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  test("글 폴더나 파일이 없으면 null", async () => {
    const client = createGitHubClient("t", fakeGitHub(REPO, "main", files));
    expect(await readPost(client, REPO, config, "content/4.게시판/없는글/page.mdx")).toBeNull();
    const onlyImage = createGitHubClient(
      "t",
      fakeGitHub(REPO, "main", [{ path: "content/4.게시판/1.휴진/1.png", content: png }]),
    );
    expect(await readPost(onlyImage, REPO, config, POST)).toBeNull();
  });

  test("404가 아닌 실패는 던진다", async () => {
    const client = createGitHubClient("t", async () => Response.json({ message: "Server Error" }, { status: 502 }));
    await expect(readPost(client, REPO, config, POST)).rejects.toMatchObject({ status: 502 });
  });
});

describe("isImageFile", () => {
  test.each([
    ["1.png", true],
    ["a.JPEG", true],
    ["b.webp", true],
    ["c.svg", true],
    ["page.mdx", false],
    ["png", false],
    ["notes.txt", false],
  ])("%s → %s", (name, expected) => {
    expect(isImageFile(name)).toBe(expected);
  });
});
