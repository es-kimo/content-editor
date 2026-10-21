import { describe, expect, test } from "vitest";

import { saveEdit, STATUS_PROBLEM_MESSAGES, type EditContent, type SaveState } from "@/lib/content";
import { createGitHubClient } from "@/lib/github";
import type { PostAction } from "@/lib/metadata-form";
import { yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha } from "@/test/fake-github";

import { savedMessage, savedPostHref, saveResultState } from "./save-result";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";
const config = yjshdConfig();

const post = (status: string) => `import image1 from "./1.png";

export const metadata = {
  title: '11월 휴진 안내',
  description: '안녕하세요.',
  keywords: [],
  other: { status: "${status}", createdAt: "2020-11-20T00:00:00Z" },
};

# 11월 휴진 안내

본문 <Image src={image1} alt="" />
`;
const BODY = `# 11월 휴진 안내\n\n본문 <Image src={image1} alt="" />\n`;

const FORM = { title: "12월 휴진 안내", description: "안녕하세요.", "other.createdAt": "2020-11-20T00:00" };
const form = (values: { [key: string]: string } = {}, body = BODY): EditContent => ({
  mode: "form",
  values: { ...FORM, ...values },
  body,
});

/** `status` 글 하나가 있는 레포에서 그 글을 연 sha로 저장한다. */
const save = async (status: string, action: PostAction, content: EditContent = form()) => {
  const source = post(status);
  const repo = fakeGitRepo(REPO, "main", [{ path: POST, content: source }]);
  const client = createGitHubClient("ghu_token", repo.fetch);
  const target = { path: POST, baseSha: blobSha(source) };
  const result = await saveEdit(
    client,
    REPO,
    config,
    action === "unpublish" ? { ...target, action } : { ...target, action, content },
  );
  return { repo, result };
};

const POST_HREF = `/repos/${REPO}/post?path=${encodeURIComponent(POST)}`;

/** 저장한 글 화면이 주소에서 읽는 행동. */
const actionOf = (href: string) => new URL(href, "http://localhost").searchParams.get("action") ?? undefined;

describe("saveResultState 성공", () => {
  test.each<[PostAction, string, string]>([
    ["save-draft", "draft", "임시저장했어요. 게시하기 전에는 사이트에 보이지 않아요."],
    ["publish", "draft", "게시 대상으로 저장했어요. 사이트에 반영되기까지 시간이 걸릴 수 있어요."],
    ["update", "ready", "게시 대상으로 저장했어요. 사이트에 반영되기까지 시간이 걸릴 수 있어요."],
    ["unpublish", "ready", "초안으로 바꿨어요. 사이트에서 사라지기까지 시간이 걸릴 수 있어요."],
  ])("%s에 성공하면 저장한 글 화면이 화면 기준의 성공 문구를 보인다", async (action, status, message) => {
    const { repo, result } = await save(status, action);

    const state = saveResultState(result, (commit) => savedPostHref(POST_HREF, commit, action));

    expect(state).toEqual({ status: "saved", href: savedPostHref(POST_HREF, repo.head(), action) });
    if (state.status !== "saved") return;
    expect(new URL(state.href, "http://localhost").searchParams.get("saved")).toBe(repo.head());
    expect(savedMessage(actionOf(state.href))).toBe(message);
  });

  test("게시·수정 반영·게시 내리기 성공 문구는 사이트 반영이 늦을 수 있다고 말한다", () => {
    for (const action of ["publish", "update", "unpublish"] as const) {
      expect(savedMessage(action)).toContain("시간이 걸릴 수 있어요");
    }
  });

  test("주소의 행동을 알 수 없으면 행동을 말하지 않고 저장했다고만 알린다", () => {
    expect(savedMessage(undefined)).toBe("저장했어요.");
    expect(savedMessage("toString")).toBe("저장했어요.");
  });
});

describe("saveResultState 실패", () => {
  test("바뀐 것이 없으면 변경 없음으로 알린다", async () => {
    const { result } = await save("draft", "save-draft", form({ title: "11월 휴진 안내" }));

    expect(saveResultState(result, () => "/saved")).toEqual({ status: "unchanged" });
  });

  test("입력이 잘못되면 입력을 남기는 오류 상태로 필드별 오류를 돌려주고 표시된 항목을 고치라고 한다", async () => {
    const { result } = await save("draft", "publish", form({ title: "" }, ""));
    const state = errorState(saveResultState(result, () => "/saved"));

    expect(state.fields).toEqual({ title: "값을 입력해 주세요.", body: "값을 입력해 주세요." });
    expect(state.message).toBe("입력한 값을 확인해 주세요. 표시된 항목을 고친 뒤 다시 저장해 주세요.");
    expect(state.detail).toBeUndefined();
  });

  test("컴파일되지 않으면 입력을 남기는 오류 상태로 원문 편집에서 고치라고 하고, 오류 행과 원문은 기술 상세에 둔다", async () => {
    const broken = post("draft").replace("src={image1}", "src={image1 +}");
    const { result } = await save("draft", "save-draft", { mode: "source", source: broken });
    const state = errorState(saveResultState(result, () => "/saved"));

    expect(state.message).toBe(
      "이대로 저장하면 사이트에서 글을 보여 줄 수 없어요. 원문 편집에서 오류 표시가 있는 줄을 고친 뒤 다시 저장해 주세요.",
    );
    if (result.ok || result.reason !== "compile") throw new Error("컴파일 실패가 아니다");
    expect(state.detail).toBe(`12행: ${result.error.message}`);
    expect(state.message).not.toContain(result.error.message);
  });

  test("연 뒤 다른 곳에서 글이 바뀌었으면 입력을 남기는 오류 상태로 입력을 보관한 뒤 다시 열라고 한다", async () => {
    const source = post("ready");
    const repo = fakeGitRepo(REPO, "main", [{ path: POST, content: source }]);
    repo.pushElsewhere([{ path: POST, content: source.replace("본문", "다른 곳에서 고친 본문") }]);

    const result = await saveEdit(createGitHubClient("ghu_token", repo.fetch), REPO, config, {
      path: POST,
      baseSha: blobSha(source),
      action: "update",
      content: form(),
    });
    const state = errorState(saveResultState(result, () => "/saved"));

    expect(state.message).toBe(
      "글을 연 뒤 다른 곳에서 글이 바뀌었어요. 입력한 내용을 따로 보관한 뒤 글을 다시 열어 주세요.",
    );
    expect(state.fields).toBeUndefined();
  });

  test("상태를 읽을 수 없는 글은 다른 상태로 저장하지 않고 원문을 확인하라고 한다", async () => {
    const { repo, result } = await save("hidden", "save-draft");

    expect(saveResultState(result, () => "/saved")).toMatchObject({
      status: "error",
      message: STATUS_PROBLEM_MESSAGES["status-value"],
    });
    expect(repo.log()).toHaveLength(1);
  });
});

function errorState(state: SaveState): Extract<SaveState, { status: "error" }> {
  if (state.status !== "error") throw new Error(`오류 결과가 아니다: ${state.status}`);
  return state;
}
