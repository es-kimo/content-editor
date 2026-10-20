import { describe, expect, test } from "vitest";

import { createPost } from "@/lib/content";
import { createGitHubClient } from "@/lib/github";
import { yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";

import { createResultState } from "./create-result";

const REPO = "es-kimo/yjshd";
const NOW = new Date("2026-10-19T03:04:05.678Z");
const config = yjshdConfig();
const EXISTING = "content/4.게시판/10월 휴진 안내/page.mdx";

const setup = () => {
  const repo = fakeGitRepo(REPO, "main", [
    { path: EXISTING, content: `export const metadata = { title: "10월 휴진 안내" };\n\n# 10월 휴진 안내\n` },
  ]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const href = (path: string, commit: string) => `/repos/${REPO}/post?path=${path}&saved=${commit}`;

describe("createResultState", () => {
  test("만들면 만든 글의 편집 화면 주소를 돌려준다", async () => {
    const { repo, client } = setup();

    const result = await createPost(client, REPO, config, { collection: "게시판", title: "11월 휴진 안내" }, NOW);

    expect(createResultState(result, href)).toEqual({
      status: "saved",
      href: href("content/4.게시판/11월 휴진 안내/page.mdx", repo.head()),
    });
  });

  test("같은 글 폴더가 이미 있으면 제목 옆에 오류를 보인다", async () => {
    const { client } = setup();

    const result = await createPost(client, REPO, config, { collection: "게시판", title: "10월 휴진 안내" }, NOW);

    expect(createResultState(result, href)).toMatchObject({ status: "error", fields: { title: expect.any(String) } });
  });

  test("제목이 비면 필드 오류를, config에 없는 컬렉션이면 필드 없는 안내를 돌려준다", async () => {
    const { client } = setup();

    const empty = await createPost(client, REPO, config, { collection: "게시판", title: "" }, NOW);
    const missing = await createPost(client, REPO, config, { collection: "없는 컬렉션", title: "글" }, NOW);

    expect(createResultState(empty, href)).toMatchObject({ status: "error", fields: { title: expect.any(String) } });
    expect(createResultState(missing, href)).toMatchObject({ status: "error", fields: undefined });
  });
});
