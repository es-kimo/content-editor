import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { FIELD_PREFIX } from "@/lib/metadata-form";

import { startApp, type App } from "./app";

const REPO = "es-kimo/e2e";
const metadata = {
  title: { type: "string", label: "제목", required: true },
  description: { type: "text", label: "요약" },
  "other.status": { type: "select", label: "상태", options: ["ready", "draft"] },
};
const CONFIG = {
  branch: "main",
  syntax: { gfm: false, math: false },
  collections: [
    // 글이 하나도 없어 고를 하위 메뉴가 없다.
    {
      name: "강좌",
      path: "content/강좌/{submenu}/{slug}/page.mdx",
      metadata,
      components: ["Image"],
      editor: "wysiwyg",
    },
    { name: "게시판", path: "content/게시판/{submenu}/{slug}/page.mdx", metadata, editor: "wysiwyg" },
  ],
};
const EXISTING = "content/게시판/공지/안내/page.mdx";

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;
/** 이 테스트에서 가짜 레포에 생긴 커밋 수. */
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    {
      path: EXISTING,
      content: "export const metadata = {\n  title: '안내',\n  other: { status: 'draft' },\n};\n\n# 안내\n",
    },
  ]);
});
afterAll(async () => app?.close());

beforeEach(async () => {
  context = await app.context();
  page = await context.newPage();
  commitsBefore = app.commits();
});
afterEach(async () => context.close());

const newUrl = (collection: string) => `${app.origin}/repos/${REPO}/new?${new URLSearchParams({ collection })}`;
// 새 글은 본문이 비어 있어 편집기가 같은 클래스의 자리 표시 문구를 함께 그린다.
const bodyEditor = () => page.locator(".body-editor-content[contenteditable='true']");
const sourceEditor = () => page.locator(".cm-content");
const titleInput = () => page.locator(`input[name="${FIELD_PREFIX}title"]`);
const modeButton = (name: "일반 편집" | "원문 편집") => page.getByRole("button", { name, exact: true });
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);

async function openNew(collection: string) {
  await page.goto(newUrl(collection));
  await bodyEditor().waitFor();
}

describe("새 글", () => {
  test("하위 메뉴가 없는 글 분류에서 새 메뉴·제목·본문을 쓰고 모드를 바꿔도 커밋하지 않고, ‘임시저장’ 한 번에 새 메뉴와 첫 글을 초안으로 저장한다", async () => {
    await openNew("강좌");
    expect(await page.getByText("하위 메뉴 폴더를 먼저").count()).toBe(0);

    await page.getByRole("textbox", { name: "하위 메뉴 *" }).fill("AI");
    await titleInput().fill("첫 강좌");
    await bodyEditor().click();
    await page.keyboard.type("AI에게 물어봐도 될까요?");
    await unsaved("하위 메뉴, 제목, 본문").waitFor();
    expect(await page.getByText("경로 content/강좌/AI/첫 강좌/page.mdx").isVisible()).toBe(true);

    await modeButton("원문 편집").click();
    const carried = await sourceEditor().innerText();
    expect(carried).toContain('title: "첫 강좌"');
    expect(carried).toContain("AI에게 물어봐도 될까요?");
    await modeButton("일반 편집").click();
    await bodyEditor().getByText("AI에게 물어봐도 될까요?").waitFor();
    expect(newCommits()).toBe(0);

    await page.getByRole("button", { name: "임시저장" }).click();
    await page.waitForURL(/\/post\?/);
    await page.getByText("임시저장했어요. 게시하기 전에는 사이트에 보이지 않아요.").waitFor();

    expect(newCommits()).toBe(1);
    const saved = app.file("content/강좌/AI/첫 강좌/page.mdx");
    expect(saved).toContain('title: "첫 강좌"');
    expect(saved).toContain('status: "draft"');
    expect(saved).toContain("AI에게 물어봐도 될까요?");
  });

  test("게시하는데 본문이 비거나 새 메뉴 이름에 쓸 수 없는 문자가 있으면 그 필드 옆에 오류를 보이고 입력을 둔 채 커밋하지 않는다", async () => {
    await openNew("게시판");
    await page.getByRole("combobox", { name: "하위 메뉴 *" }).selectOption("새 메뉴");
    await page.getByRole("textbox", { name: "새 메뉴 이름" }).fill("A/B");
    await titleInput().fill("새 안내");

    await page.getByRole("button", { name: "게시" }).click();

    await page.getByText("본문: 값을 입력해 주세요.").waitFor();
    expect(await page.getByText(/하위 메뉴 이름에 .* 쓸 수 없어요/).isVisible()).toBe(true);
    expect(await titleInput().inputValue()).toBe("새 안내");
    expect(await page.getByRole("textbox", { name: "새 메뉴 이름" }).inputValue()).toBe("A/B");
    expect(newCommits()).toBe(0);
  });
});
