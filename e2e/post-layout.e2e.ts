import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { FIELD_PREFIX } from "@/lib/metadata-form";

import { startApp, type App } from "./app";

const REPO = "es-kimo/layout";
const POST = "content/게시판/구성/page.mdx";
const UNTITLED = "content/게시판/제목없음/page.mdx";
const SOURCE_ONLY = "content/게시판/원문만/page.mdx";
/** 저장해 보는 글. 다른 테스트가 여는 글의 내용을 바꾸지 않게 따로 둔다. */
const SAVED_POST = "content/게시판/저장/page.mdx";
const CONFIG = {
  branch: "main",
  syntax: { gfm: false, math: false },
  collections: [
    {
      name: "게시판",
      path: "content/게시판/{slug}/page.mdx",
      metadata: {
        title: { type: "string", label: "제목", required: true },
        description: { type: "text", label: "요약", required: true },
        // 글의 값이 배열이 아닌 문자열이라 잠긴다.
        keywords: { type: "string[]", label: "검색어" },
        // 라벨이 없는, 알려지지 않은 필드.
        "other.code": { type: "string" },
        "other.status": { type: "select", label: "상태", options: ["ready", "draft"] },
      },
      editor: "wysiwyg",
    },
  ],
};
const source = (title: string) => `export const metadata = {
  title: ${title},
  description: '요약 한 줄',
  keywords: '문자열 검색어',
  other: { code: 'A-1', status: 'ready' },
};

# 머리말

본문 첫 문단.
`;

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    { path: POST, content: source("'구성 볼 글'") },
    { path: UNTITLED, content: source("''") },
    { path: SOURCE_ONLY, content: source("foo") },
    { path: SAVED_POST, content: source("'저장해 볼 글'") },
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
// 본문의 `# 머리말`도 h1이라 화면 머리글 안에서 찾는다.
const heading = () => page.locator("main > header").getByRole("heading", { level: 1 });
const input = (key: string) => page.locator(`[name="${FIELD_PREFIX}${key}"]`);
const details = (name: string) => page.locator("details", { has: page.locator("summary", { hasText: name }) });
const settings = () => details("글 설정");
const settingsSummary = () => settings().locator("summary");
const techDetails = () => details("기술 상세");
const isOpen = (locator: ReturnType<Page["locator"]>) => locator.evaluate((el) => (el as HTMLDetailsElement).open);
const UNSAVED_SETTINGS = "저장하지 않은 변경이 있다. 바뀐 영역: 글 설정";

async function openPost(path: string) {
  await page.goto(postUrl(path));
  await page.locator(".body-editor-content").waitFor();
}

describe("글 화면 구성", () => {
  test("저장된 제목이 화면 제목이고, 제목 입력·본문·저장 버튼이 보이며 글 설정·기술 상세는 닫혀 있다", async () => {
    await openPost(POST);

    expect(await heading().textContent()).toBe("구성 볼 글");
    expect(await input("title").inputValue()).toBe("구성 볼 글");
    expect(await input("title").isVisible()).toBe(true);
    expect(await page.locator(".body-editor-content").getByText("본문 첫 문단.").isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "글 설정 저장" }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "본문 저장" }).isVisible()).toBe(true);

    expect(await isOpen(settings())).toBe(false);
    expect(await input("description").isVisible()).toBe(false);
    expect(await isOpen(techDetails())).toBe(false);
    expect(await page.getByText(POST).isVisible()).toBe(false);

    // 제목 입력이 본문보다 앞이고, 글 설정과 기술 상세는 본문 다음이다.
    const top = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!.y;
    const body = await top(page.locator(".body-editor-content"));
    expect(await top(input("title"))).toBeLessThan(body);
    expect(await top(settingsSummary())).toBeGreaterThan(body);
    expect(await top(techDetails())).toBeGreaterThan(await top(settingsSummary()));

    await techDetails().locator("summary").click();
    expect(await page.getByText(POST).isVisible()).toBe(true);
  });

  test("제목이 없는 글은 글 화면과 목록에서 '제목 없는 글'로 보인다", async () => {
    await openPost(UNTITLED);
    expect(await heading().textContent()).toBe("제목 없는 글");

    await page.goto(`${app.origin}/repos/${REPO}?${new URLSearchParams({ collection: "게시판" })}`);
    await page.getByRole("link", { name: "구성 볼 글" }).waitFor();
    // 제목이 빈 글과 metadata를 읽을 수 없는 글 모두 파일명 대신 '제목 없는 글'이다.
    expect(await page.getByRole("link", { name: "제목 없는 글" }).count()).toBe(2);
    expect(await page.getByRole("link", { name: "제목없음" }).count()).toBe(0);
    expect(await page.getByText(/API 호출/).isVisible()).toBe(false);
  });

  test("일반 편집 제한과 그 이유는 기술 상세를 펼치지 않아도 보인다", async () => {
    await page.goto(postUrl(SOURCE_ONLY));
    await heading().waitFor();

    expect(await heading().textContent()).toBe("제목 없는 글");
    expect(await page.getByText(/원문 모드로만 고친다: /).isVisible()).toBe(true);
    expect(await isOpen(techDetails())).toBe(false);
  });
});

describe("제목과 글 설정 저장", () => {
  test("제목을 바꾸면 글 설정의 미저장 변경이고, 본문 저장 뒤에도 남으며, 글 설정 저장 뒤 다시 열면 바뀐 제목이다", async () => {
    await openPost(SAVED_POST);
    await input("title").fill("바뀐 제목");
    await page.getByText(UNSAVED_SETTINGS).waitFor();
    expect(await settingsSummary().getByText("저장하지 않은 변경이 있어요").isVisible()).toBe(true);
    expect(await isOpen(settings())).toBe(false);

    await page.locator(".body-editor-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" 덧붙임");
    await page.getByText("저장하지 않은 변경이 있다. 바뀐 영역: 글 설정, 본문").waitFor();
    await page.getByRole("button", { name: "본문 저장" }).click();
    await page.getByText(/^저장했어요\./).waitFor();
    await page.getByText(UNSAVED_SETTINGS, { exact: true }).waitFor();
    expect(newCommits()).toBe(1);
    expect(await input("title").inputValue()).toBe("바뀐 제목");
    expect(await heading().textContent()).toBe("저장해 볼 글");

    await page.getByRole("button", { name: "글 설정 저장" }).click();
    await heading().filter({ hasText: "바뀐 제목" }).waitFor();
    expect(newCommits()).toBe(2);

    await openPost(SAVED_POST);
    expect(await heading().textContent()).toBe("바뀐 제목");
    expect(await page.getByText(/저장하지 않은 변경이 있/).count()).toBe(0);
  });

  test("글 설정을 접었다 펼쳐도 입력이 남고, 잠긴 필드와 라벨 없는 필드도 빠지지 않는다", async () => {
    await openPost(POST);
    await settingsSummary().click();
    await input("description").fill("고친 요약");
    await settingsSummary().click();
    expect(await isOpen(settings())).toBe(false);
    expect(await settingsSummary().getByText("저장하지 않은 변경이 있어요").isVisible()).toBe(true);
    await settingsSummary().click();
    expect(await input("description").inputValue()).toBe("고친 요약");

    expect(await input("keywords").isDisabled()).toBe(true);
    expect(await input("keywords").inputValue()).toBe("");
    expect(
      await settings()
        .getByText(/원문 모드에서만 고칠 수 있다/)
        .isVisible(),
    ).toBe(true);
    expect(await input("other.code").inputValue()).toBe("A-1");
    expect(await settings().getByText("other.code").count()).toBeGreaterThan(0);
    expect(await input("other.status").inputValue()).toBe("ready");
  });

  test("접힌 필수 필드를 비운 채 저장하면 글 설정을 펼쳐 필드 옆에 오류를 보이고 커밋하지 않는다", async () => {
    await openPost(POST);
    await settingsSummary().click();
    await input("description").fill("");
    await settingsSummary().click();

    await page.getByRole("button", { name: "글 설정 저장" }).click();
    await settings().getByText("값을 입력해 주세요.").waitFor();
    expect(await isOpen(settings())).toBe(true);

    // 다시 접어도 요약 줄에 오류가 보인다.
    await settingsSummary().click();
    expect(await settingsSummary().getByText("확인할 항목이 있어요").isVisible()).toBe(true);
    expect(newCommits()).toBe(0);
  });

  test("서버가 숨긴 필드의 입력을 거절하면 저장 실패는 기본 화면에, 필드 오류는 펼친 글 설정에 보인다", async () => {
    await openPost(POST);
    // 화면이 막는 값을 직접 보낸 경우처럼 선택지에 없는 값을 고른다.
    await input("other.status").evaluate((select) => {
      const option = Object.assign(document.createElement("option"), { value: "hidden", textContent: "hidden" });
      select.append(option);
      (select as HTMLSelectElement).value = "hidden";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(await isOpen(settings())).toBe(false);

    await page.getByRole("button", { name: "글 설정 저장" }).click();
    await settings()
      .getByText(/선택지에 없는 값이다/)
      .waitFor();
    expect(await isOpen(settings())).toBe(true);
    expect(await page.getByText("입력을 확인한다.").isVisible()).toBe(true);
    expect(newCommits()).toBe(0);
  });
});
