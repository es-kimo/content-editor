import { describe, expect, test } from "vitest";

import { createPost, newPostFromSource, newPostSource, type CreatePostInput, type NewPostAction } from "@/lib/content";
import { createGitHubClient } from "@/lib/github";
import { REQUIRED_MESSAGE } from "@/lib/metadata-form";
import { yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";

import { savedMessage } from "../post/save-result";
import { createResultState, sourceProblemState } from "./create-result";

const REPO = "es-kimo/yjshd";
const NOW = new Date("2026-10-19T03:04:05.678Z");
const config = yjshdConfig();
const lecture = config.collections.find((c) => c.name === "강좌")!;
const EXISTING = "content/4.게시판/10월 휴진 안내/page.mdx";

const setup = () => {
  const repo = fakeGitRepo(REPO, "main", [
    { path: EXISTING, content: `export const metadata = { title: "10월 휴진 안내" };\n\n# 10월 휴진 안내\n` },
    { path: "content/3.강좌/2.콩팥질환 정보/우울해요/page.mdx", content: "# 우울해요\n" },
  ]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

/** 게시판에 제목과 본문을 넣어 처음 저장하는 새 글. */
const input = (title: string, rest: Partial<CreatePostInput> = {}): CreatePostInput => ({
  collection: "게시판",
  action: "save-draft",
  values: { title },
  body: "휴진을 알려 드립니다.\n",
  ...rest,
});

const postHref = (path: string) => `/repos/${REPO}/post?${new URLSearchParams({ path })}`;

const create = async (value: CreatePostInput) => {
  const { repo, client } = setup();
  const result = await createPost(client, REPO, config, value, NOW);
  return { repo, state: createResultState(result, value.action, postHref) };
};

describe("createResultState", () => {
  test.each<[NewPostAction, string]>([
    ["save-draft", "임시저장했어요. 게시하기 전에는 사이트에 보이지 않아요."],
    ["publish", "게시 대상으로 저장했어요. 사이트에 반영되기까지 시간이 걸릴 수 있어요."],
  ])("%s에 성공하면 저장한 글 화면으로 가고 그 화면이 행동에 맞는 성공 문구를 보인다", async (action, message) => {
    const { repo, state } = await create(input("11월 휴진 안내", { action }));
    if (state.status !== "saved") throw new Error(state.status);
    const params = new URL(state.href, "https://editor.test").searchParams;

    expect(params.get("path")).toBe("content/4.게시판/11월 휴진 안내/page.mdx");
    expect(params.get("saved")).toBe(repo.head());
    expect(savedMessage(params.get("action") ?? undefined)).toBe(message);
  });

  test("같은 글 폴더가 이미 있으면 제목 옆에 제목을 바꾸라는 오류를 보인다", async () => {
    const { state } = await create(input("10월 휴진 안내"));

    expect(state).toMatchObject({
      status: "error",
      message: "입력한 값을 확인해 주세요. 표시된 항목을 고친 뒤 다시 저장해 주세요.",
      fields: { title: "같은 이름의 글 폴더가 이미 있어요. 제목을 바꿔 주세요." },
    });
  });

  test("새 하위 메뉴 이름이 기존 메뉴와 같으면 하위 메뉴 옆에 기존 메뉴를 고르라는 오류를 보인다", async () => {
    const { state } = await create(
      input("새 글", { collection: "강좌", submenu: { kind: "new", name: " 2.콩팥질환 정보 " } }),
    );

    expect(state).toMatchObject({
      status: "error",
      fields: { submenu: "‘2.콩팥질환 정보’ 하위 메뉴가 이미 있어요. 새로 만들지 말고 목록에서 골라 주세요." },
    });
  });

  test("새 하위 메뉴 이름에 쓸 수 없는 문자가 있으면 하위 메뉴 옆에 이름을 바꾸라는 오류를 보이고 저장하지 않는다", async () => {
    const { repo, state } = await create(
      input("새 글", { collection: "강좌", submenu: { kind: "new", name: "AI/ML" } }),
    );

    expect(state).toMatchObject({
      status: "error",
      fields: { submenu: expect.stringContaining("이름을 바꿔 주세요") },
    });
    expect(repo.log()).toHaveLength(1);
  });

  test("제목이 비면 제목 옆에, 게시할 때 본문이 비면 본문 오류를 보인다", async () => {
    const empty = await create(input(""));
    const publishEmpty = await create(input("11월 휴진 안내", { action: "publish", body: "" }));
    const draftEmpty = await create(input("11월 휴진 안내", { body: "" }));

    expect(empty.state).toMatchObject({ status: "error", fields: { title: REQUIRED_MESSAGE } });
    expect(publishEmpty.state).toMatchObject({ status: "error", fields: { body: REQUIRED_MESSAGE } });
    expect(draftEmpty.state.status).toBe("saved");
  });

  test("설정에 초안·게시 상태가 없으면 설정을 확인하라는 안내를 돌려준다", () => {
    expect(createResultState({ ok: false, reason: "status-options" }, "save-draft", postHref)).toMatchObject({
      status: "error",
      message: expect.stringContaining("편집 설정을 확인"),
    });
  });

  test("설정에 없는 글 분류면 필드 없이 글 분류를 다시 고르라는 안내를 돌려준다", async () => {
    const { state } = await create(input("글", { collection: "없는 컬렉션" }));

    expect(state).toEqual({
      status: "error",
      message: "고른 글 분류가 레포의 편집 설정에 없어요. 글 목록에서 글 분류를 다시 골라 주세요.",
    });
  });
});

describe("sourceProblemState", () => {
  test("원문 편집으로 쓴 새 글에 일반 편집이 담을 수 없는 것이 있으면 그 부분을 지우라고 안내한다", () => {
    const source = `import x from "./x.js";\n\n${newPostSource(lecture, config.syntax, NOW)}`;
    const problem = newPostFromSource(lecture, config.syntax, { source, images: [] }, NOW);
    if (problem.ok) throw new Error("바꿀 수 없는 원문이어야 한다");

    expect(sourceProblemState(problem)).toMatchObject({
      status: "error",
      message: expect.stringContaining("그 부분을 지운 뒤 다시 저장해 주세요"),
    });
  });
});
