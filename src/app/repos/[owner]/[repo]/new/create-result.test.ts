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

    expect(createResultState(result, href)).toMatchObject({
      status: "error",
      message: "입력한 값을 확인해 주세요. 표시된 항목을 고친 뒤 다시 만들어 주세요.",
      fields: { title: "같은 이름의 글 폴더가 이미 있어요. 제목을 바꿔 주세요." },
    });
  });

  test("제목이 비면 제목 옆 오류를, 설정에 없는 글 분류면 필드 없이 글 분류를 다시 고르라는 안내를 돌려준다", async () => {
    const { client } = setup();

    const empty = await createPost(client, REPO, config, { collection: "게시판", title: "" }, NOW);
    const missing = await createPost(client, REPO, config, { collection: "없는 컬렉션", title: "글" }, NOW);

    expect(createResultState(empty, href)).toMatchObject({
      status: "error",
      fields: { title: "제목을 입력해 주세요." },
    });
    expect(createResultState(missing, href)).toEqual({
      status: "error",
      message: "고른 글 분류가 레포의 편집 설정에 없어요. 글 목록에서 글 분류를 다시 골라 주세요.",
    });
  });
});
