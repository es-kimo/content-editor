import { describe, expect, test } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { testConfig, yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha, type FakeFile } from "@/test/fake-github";
import { PNG } from "@/test/upload-images";

import { listSubmenus } from "./create-post";
import { listPosts, listTrash } from "./posts";
import { restorePost, trashPost } from "./trash";

const REPO = "es-kimo/yjshd";
const NOW = new Date("2026-10-20T09:30:15.678Z");
const TRASHED_AT = "2026-10-20T09:30:15Z";
/** 실제 yjshd에 넣을 config 예시. */
const config = yjshdConfig();
const [board, lecture] = config.collections;

const DRAFT_POST = "content/4.게시판/1.휴진/page.mdx";
const READY_POST = "content/4.게시판/2.진료/page.mdx";
const IMAGE = "content/4.게시판/1.휴진/1.png";
const OTHER = "content/4.게시판/3.다른 글/page.mdx";

/** `other` 안의 줄. 휴지통 표시가 있으면 status 다음 줄이다. */
const post = (title: string, status: string, trashedAt?: string) => `import image1 from "./1.png";

export const metadata = {
  title: "${title}",
  description: "",
  keywords: [],
  other: {
    createdAt: "2020-11-20T00:00:00Z",
    status: "${status}",${trashedAt === undefined ? "" : `\n    trashedAt: "${trashedAt}",`}
  },
};

# ${title}

<Image src={image1} alt="" />
`;

const OTHER_SOURCE = post("다른 글", "ready");

const setup = (files: FakeFile[]) => {
  const repo = fakeGitRepo(REPO, "main", [
    ...files,
    { path: IMAGE, content: PNG },
    { path: OTHER, content: OTHER_SOURCE },
    { path: "README.md", content: "# yjshd\n" },
  ]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

describe("trashPost", () => {
  test.each([
    ["초안", "draft"],
    ["게시 대상", "ready"],
  ])(
    "%s 글을 휴지통으로 옮기면 커밋 1개에 상태 draft와 삭제 시각만 들어가고 경로·본문·이미지·다른 글은 그대로다",
    async (_, status) => {
      const source = post("11월 휴진 안내", status);
      const { repo, client } = setup([{ path: DRAFT_POST, content: source }]);
      const before = repo.head();
      const paths = repo.paths();

      const result = await trashPost(client, REPO, config, { path: DRAFT_POST, baseSha: blobSha(source) }, NOW);

      expect(result).toEqual({ ok: true, commit: repo.head(), parent: before });
      expect(repo.log()).toHaveLength(2);
      expect(text(repo.file(DRAFT_POST))).toBe(post("11월 휴진 안내", "draft", TRASHED_AT));
      expect(repo.paths()).toEqual(paths);
      expect(repo.file(IMAGE)).toEqual(PNG);
      expect(text(repo.file(OTHER))).toBe(OTHER_SOURCE);
    },
  );

  test("휴지통 글은 글 목록에서 빠지고 휴지통 목록에 제목·삭제 시각과 함께 나온다", async () => {
    const source = post("11월 휴진 안내", "ready");
    const { client } = setup([{ path: DRAFT_POST, content: source }]);

    await trashPost(client, REPO, config, { path: DRAFT_POST, baseSha: blobSha(source) }, NOW);

    expect((await listPosts(client, REPO, config, board!)).map((p) => p.path)).toEqual([OTHER]);
    const trash = await listTrash(client, REPO, config, board!);
    expect(trash.map(({ path, title, trashedAt }) => ({ path, title, trashedAt }))).toEqual([
      { path: DRAFT_POST, title: "11월 휴진 안내", trashedAt: TRASHED_AT },
    ]);
  });

  test("휴지통 글만 남은 하위 메뉴는 메뉴 목록에서 빠지고 초안만 있는 메뉴는 남는다", async () => {
    const trashed = "content/3.강좌/AI/첫 글/page.mdx";
    const drafted = "content/3.강좌/초안 메뉴/글/page.mdx";
    const source = post("첫 글", "ready");
    const { client } = setup([
      { path: trashed, content: source },
      { path: drafted, content: post("글", "draft") },
    ]);
    expect(await listSubmenus(client, REPO, config, lecture!)).toEqual(["초안 메뉴", "AI"]);

    await trashPost(client, REPO, config, { path: trashed, baseSha: blobSha(source) }, NOW);

    expect(await listSubmenus(client, REPO, config, lecture!)).toEqual(["초안 메뉴"]);
  });

  test("이미 휴지통에 있는 글을 다시 옮기면 커밋 없이 unchanged다", async () => {
    const source = post("11월 휴진 안내", "draft", TRASHED_AT);
    const { repo, client } = setup([{ path: DRAFT_POST, content: source }]);
    const before = repo.head();

    const result = await trashPost(client, REPO, config, { path: DRAFT_POST, baseSha: blobSha(source) }, NOW);

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head()).toBe(before);
  });
});

describe("restorePost", () => {
  test("이전에 게시 대상이었던 글도 복구하면 커밋 1개로 삭제 시각이 빠지고 draft가 되며 경로·본문·이미지는 그대로다", async () => {
    const source = post("11월 휴진 안내", "ready", TRASHED_AT);
    const { repo, client } = setup([{ path: READY_POST, content: source }]);
    const before = repo.head();
    const paths = repo.paths();

    const result = await restorePost(client, REPO, config, { path: READY_POST, baseSha: blobSha(source) });

    expect(result).toEqual({ ok: true, commit: repo.head(), parent: before });
    expect(repo.log()).toHaveLength(2);
    expect(text(repo.file(READY_POST))).toBe(post("11월 휴진 안내", "draft"));
    expect(repo.paths()).toEqual(paths);
    expect(repo.file(IMAGE)).toEqual(PNG);
    expect(text(repo.file(OTHER))).toBe(OTHER_SOURCE);
  });

  test("게시 대상 글을 옮겼다가 복구하면 원래 원문에서 상태만 draft로 바뀌고 글 목록에 초안으로 돌아온다", async () => {
    const source = post("11월 휴진 안내", "ready");
    const { repo, client } = setup([{ path: DRAFT_POST, content: source }]);

    await trashPost(client, REPO, config, { path: DRAFT_POST, baseSha: blobSha(source) }, NOW);
    const trashed = text(repo.file(DRAFT_POST));
    await restorePost(client, REPO, config, { path: DRAFT_POST, baseSha: blobSha(trashed) });

    expect(repo.log()).toHaveLength(3);
    expect(text(repo.file(DRAFT_POST))).toBe(post("11월 휴진 안내", "draft"));
    const restored = (await listPosts(client, REPO, config, board!)).find((p) => p.path === DRAFT_POST);
    expect(restored).toMatchObject({ status: "draft", trashed: false });
    expect(await listTrash(client, REPO, config, board!)).toEqual([]);
  });

  test("휴지통에 없는 글을 복구하면 커밋 없이 unchanged다", async () => {
    const source = post("11월 휴진 안내", "draft");
    const { repo, client } = setup([{ path: DRAFT_POST, content: source }]);
    const before = repo.head();

    const result = await restorePost(client, REPO, config, { path: DRAFT_POST, baseSha: blobSha(source) });

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head()).toBe(before);
  });
});

describe("휴지통 이동·복구의 충돌과 거절", () => {
  const actions = [
    ["휴지통 이동", post("11월 휴진 안내", "ready"), trashPost],
    ["복구", post("11월 휴진 안내", "ready", TRASHED_AT), restorePost],
  ] as const;

  test.each(actions)("%s: 글을 연 뒤 다른 곳에서 바뀌었으면 커밋하지 않고 changed다", async (_, source, act) => {
    const { repo, client } = setup([{ path: DRAFT_POST, content: source }]);
    repo.pushElsewhere([{ path: DRAFT_POST, content: source.replace("# 11월", "# 12월") }]);
    const before = repo.head();

    const result = await act(client, REPO, config, { path: DRAFT_POST, baseSha: blobSha(source) }, NOW);

    expect(result).toMatchObject({ ok: false, reason: "changed" });
    expect(repo.head()).toBe(before);
  });

  test.each(actions)("%s: 같은 화면에서 다시 실행해도 커밋이 하나만 생긴다", async (_, source, act) => {
    const { repo, client } = setup([{ path: DRAFT_POST, content: source }]);
    const input = { path: DRAFT_POST, baseSha: blobSha(source) };

    expect((await act(client, REPO, config, input, NOW)).ok).toBe(true);
    const after = repo.head();
    const again = await act(client, REPO, config, input, NOW);

    expect(again.ok).toBe(false);
    expect(repo.head()).toBe(after);
    expect(repo.log()).toHaveLength(2);
  });

  test.each(actions)("%s: 상태 필드가 없거나 draft·ready를 다 갖지 않은 설정이면 거절한다", async (_, source, act) => {
    const { repo, client } = setup([{ path: DRAFT_POST, content: source }]);
    const before = repo.head();
    const input = { path: DRAFT_POST, baseSha: blobSha(source) };
    const withStatus = (metadata: Parameters<typeof testConfig>[0][number]["metadata"]) =>
      testConfig([{ name: "게시판", path: "content/4.게시판/{slug}/page.mdx", metadata }]);

    expect(await act(client, REPO, withStatus({ title: { type: "string" } }), input, NOW)).toEqual({
      ok: false,
      reason: "status-field",
    });
    const readyOnly = withStatus({ "other.status": { type: "select", options: ["ready"] } });
    expect(await act(client, REPO, readyOnly, input, NOW)).toEqual({ ok: false, reason: "status-options" });
    expect(repo.head()).toBe(before);
  });

  test.each(actions)(
    "%s: 글의 상태가 draft·ready가 아니거나 metadata를 읽을 수 없으면 거절한다",
    async (_, source, act) => {
      for (const changed of [
        source.replace('status: "ready"', 'status: "hidden"'),
        source.replace('status: "ready",', ""),
        source.replace('title: "11월 휴진 안내"', "title: TITLE"),
      ]) {
        const { repo, client } = setup([{ path: DRAFT_POST, content: changed }]);
        const before = repo.head();

        const result = await act(client, REPO, config, { path: DRAFT_POST, baseSha: blobSha(changed) }, NOW);

        expect(result).toEqual({ ok: false, reason: "status-value" });
        expect(repo.head()).toBe(before);
      }
    },
  );

  test.each(actions)("%s: 없는 글은 not-found다", async (_, source, act) => {
    const { client } = setup([]);

    const result = await act(client, REPO, config, { path: DRAFT_POST, baseSha: blobSha(source) }, NOW);

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});
