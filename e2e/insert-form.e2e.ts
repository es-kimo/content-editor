import type { BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { startApp, type App } from "./app";

const REPO = "es-kimo/inserts";
const POST = "content/게시판/각주/page.mdx";
/** 저장해 보는 글. 다른 테스트가 여는 글의 내용을 바꾸지 않게 따로 둔다. */
const SAVED_POST = "content/게시판/저장/page.mdx";
const CONFIG = {
  branch: "main",
  syntax: { gfm: false, math: false },
  collections: [
    {
      name: "게시판",
      path: "content/게시판/{slug}/page.mdx",
      metadata: { title: { type: "string", label: "제목", required: true } },
      components: ["Footnote"],
      editor: "source",
    },
  ],
};
const source = (title: string) => `export const metadata = {
  title: '${title}',
};

# ${title}

진료를 쉬어요<Footnote id="1">공휴일</Footnote>.
`;
const BLOCKED = "열려 있는 폼을 먼저 적용하거나 취소해 주세요.";
const SOURCE_EDITED = "저장하지 않은 변경이 있어요. 바뀐 곳: 원문 편집";

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    { path: POST, content: source("휴진 안내") },
    { path: SAVED_POST, content: source("저장해 볼 글") },
  ]);
});
afterAll(async () => app?.close());

beforeEach(async () => {
  context = await app.context();
  page = await context.newPage();
  commitsBefore = app.commits();
});
afterEach(async () => context.close());

const postUrl = (path: string) => `${app.origin}/repos/${REPO}/post?${new URLSearchParams({ path })}`;
const editor = () => page.locator(".cm-content");
const sourceText = () => editor().innerText();
const insertButton = () => page.getByRole("button", { name: "넣기", exact: true });
const menu = () => page.getByRole("menu", { name: "넣기" });
const form = (name: string) => page.getByRole("form", { name });
const editFootnote = () => page.getByRole("button", { name: "각주 1 수정" });
const isFocused = (locator: Locator) => locator.evaluate((el) => el === document.activeElement);

async function openPost(path = POST) {
  await page.goto(postUrl(path));
  await editor().waitFor();
}

/** 원문 편집기에서 본문 마지막 줄 끝에 커서를 둔다. */
async function cursorAtLastLine() {
  await editor().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
}

async function openInsertList() {
  await page.getByText("삽입 항목 1개").click();
  await editFootnote().waitFor();
}

describe("넣기 메뉴", () => {
  test("키보드로 메뉴를 열고 옮기고 닫을 수 있고, 닫으면 넣기 버튼으로 초점이 돌아온다", async () => {
    await openPost();
    await insertButton().focus();

    await page.keyboard.press("ArrowDown");
    await menu().waitFor();
    expect(await isFocused(menu().getByRole("menuitem", { name: "각주" }))).toBe(true);
    expect(await insertButton().getAttribute("aria-expanded")).toBe("true");
    await page.keyboard.press("End");
    expect(await isFocused(menu().getByRole("menuitem", { name: "각주" }))).toBe(true);

    await page.keyboard.press("Escape");
    await menu().waitFor({ state: "detached" });
    expect(await isFocused(insertButton())).toBe(true);
    expect(await insertButton().getAttribute("aria-expanded")).toBe("false");
  });

  test("각주 폼을 Esc로 닫으면 넣기 버튼으로 초점이 돌아오고 원문은 그대로다", async () => {
    await openPost();
    const before = await sourceText();
    await cursorAtLastLine();
    await insertButton().focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await form("각주 넣기").waitFor();
    const input = form("각주 넣기").getByRole("textbox", { name: "각주 내용" });
    expect(await isFocused(input)).toBe(true);
    await page.keyboard.type("토요일 포함");
    await page.keyboard.press("Escape");

    await form("각주 넣기").waitFor({ state: "detached" });
    expect(await isFocused(insertButton())).toBe(true);
    expect(await sourceText()).toBe(before);
    expect(await page.getByText(/저장하지 않은 변경이 있어요/).count()).toBe(0);
  });

  test("각주를 적용하면 커서 자리에 넣어 원문 편집의 미저장 변경이 되고, 원문을 저장하면 커밋된다", async () => {
    await openPost(SAVED_POST);
    await cursorAtLastLine();
    await insertButton().click();
    await menu().getByRole("menuitem", { name: "각주" }).click();
    await form("각주 넣기").getByRole("textbox", { name: "각주 내용" }).fill("토요일 포함");
    await page.keyboard.press("Enter");

    await form("각주 넣기").waitFor({ state: "detached" });
    expect(await isFocused(insertButton())).toBe(true);
    expect(await sourceText()).toContain('<Footnote id="1">공휴일</Footnote>.<Footnote id="2">토요일 포함</Footnote>');
    await page.getByText(SOURCE_EDITED).waitFor();

    await page.getByRole("button", { name: "원문 저장" }).click();
    await page.getByText(/^저장했어요\./).waitFor();
    expect(newCommits()).toBe(1);
    expect(app.file(SAVED_POST)).toContain('<Footnote id="2">토요일 포함</Footnote>');
  });
});

describe("삽입 항목 수정", () => {
  test("값을 그대로 적용하면 변경이 없고, 바꿔 적용하면 그 각주만 바뀌며 닫을 때마다 수정 버튼으로 초점이 돌아온다", async () => {
    await openPost();
    const before = await sourceText();
    await openInsertList();

    await editFootnote().click();
    const input = form("각주 1 수정").getByRole("textbox", { name: "각주 내용" });
    expect(await isFocused(input)).toBe(true);
    expect(await input.inputValue()).toBe("공휴일");
    await page.keyboard.press("Enter");
    await form("각주 1 수정").waitFor({ state: "detached" });
    expect(await isFocused(editFootnote())).toBe(true);
    expect(await sourceText()).toBe(before);
    expect(await page.getByText(/저장하지 않은 변경이 있어요/).count()).toBe(0);

    await page.keyboard.press("Enter");
    await input.fill("설 연휴");
    await form("각주 1 수정").getByRole("button", { name: "적용" }).click();
    await form("각주 1 수정").waitFor({ state: "detached" });
    expect(await isFocused(editFootnote())).toBe(true);
    expect(await sourceText()).toBe(before.replace(">공휴일<", ">설 연휴<"));
    await page.getByText(SOURCE_EDITED).waitFor();
    expect(newCommits()).toBe(0);
  });

  test("폼이 열려 있으면 모든 저장과 모드 전환을 막고 적용·취소를 안내한다", async () => {
    await openPost();
    await openInsertList();
    await editFootnote().click();
    await form("각주 1 수정").getByRole("textbox").fill("설 연휴");

    await page.getByRole("button", { name: "원문 저장" }).click();
    await page.getByText(BLOCKED).waitFor();
    await page.getByRole("button", { name: "글 설정 저장" }).click();
    await page.getByRole("button", { name: "일반 편집" }).click();

    // 막은 동작 옆마다 안내가 보이지만 한 번에 하나만 보인다.
    await page.getByText(BLOCKED).waitFor();
    expect(await page.getByText(BLOCKED).count()).toBe(1);
    expect(await page.getByRole("button", { name: "원문 편집", exact: true }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(await form("각주 1 수정").getByRole("textbox").inputValue()).toBe("설 연휴");
    expect(newCommits()).toBe(0);

    await form("각주 1 수정").getByRole("button", { name: "취소" }).click();
    expect(await page.getByText(BLOCKED).count()).toBe(0);
    await page.getByRole("button", { name: "일반 편집" }).click();
    expect(await page.getByRole("button", { name: "일반 편집" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("폼을 연 뒤 고칠 각주가 옮겨지면 적용하지 않고 다시 선택하라고 안내한다", async () => {
    await openPost();
    await openInsertList();
    await editFootnote().click();
    await form("각주 1 수정").getByRole("textbox").fill("설 연휴");

    await cursorAtLastLine();
    await page.keyboard.press("Home");
    await page.keyboard.type("이번 주는 ");
    await form("각주 1 수정").getByRole("button", { name: "적용" }).click();

    await page
      .getByText("고치려던 항목이 바뀌었거나 없어졌어요. 폼을 취소하고 삽입 항목에서 다시 선택해 주세요.")
      .waitFor();
    expect(await sourceText()).toContain('이번 주는 진료를 쉬어요<Footnote id="1">공휴일</Footnote>');
    expect(await sourceText()).not.toContain("설 연휴");

    await form("각주 1 수정").getByRole("button", { name: "취소" }).click();
    expect(await isFocused(editFootnote())).toBe(true);
    await editFootnote().click();
    await form("각주 1 수정").getByRole("textbox").fill("설 연휴");
    await page.keyboard.press("Enter");
    expect(await sourceText()).toContain('이번 주는 진료를 쉬어요<Footnote id="1">설 연휴</Footnote>');
  });
});
