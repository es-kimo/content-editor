import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { FIELD_PREFIX } from "@/lib/metadata-form";

import { startApp, type App } from "./app";

const REPO = "es-kimo/e2e";
const CONFIG = {
  branch: "main",
  syntax: { gfm: false, math: false },
  collections: [
    {
      name: "게시판",
      path: "content/게시판/{slug}/page.mdx",
      metadata: {
        title: { type: "string", label: "제목", required: true },
        "other.status": { type: "select", label: "상태", options: ["ready", "draft"] },
      },
      editor: "wysiwyg",
    },
  ],
};
const source = (title: string) => `export const metadata = {
  title: '${title}',
  other: { status: 'draft' },
};

# ${title}

이번 주는 쉰다.
`;
/** 테스트마다 다른 글을 열어 앞 테스트의 저장이 다음 테스트의 기준 글을 바꾸지 않게 한다. */
const POSTS = {
  restore: "content/게시판/복구/page.mdx",
  save: "content/게시판/저장/page.mdx",
  leave: "content/게시판/나가기/page.mdx",
  conflict: "content/게시판/충돌/page.mdx",
};

const postUrl = (app: App, path: string) => `${app.origin}/repos/${REPO}/post?${new URLSearchParams({ path })}`;
const newUrl = (app: App) => `${app.origin}/repos/${REPO}/new?${new URLSearchParams({ collection: "게시판" })}`;

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    ...Object.entries(POSTS).map(([name, path]) => ({ path, content: source(`${name} 글`) })),
  ]);
});
afterAll(async () => app?.close());

beforeEach(async () => {
  // 같은 브라우저 창 묶음은 IndexedDB를 함께 쓴다. 다시 여는 화면은 같은 묶음의 새 탭으로 연다.
  context = await app.context();
  page = await context.newPage();
  commitsBefore = app.commits();
  page.on("dialog", (dialog) => void dialog.accept());
});
afterEach(async () => context.close());

const titleInput = (on = page) => on.locator(`input[name="${FIELD_PREFIX}title"]`);
const archived = (on = page) => on.getByText(/^이 브라우저에 보관했어요 · /);
const restoreNotice = (on = page) => on.getByText(/에 이 브라우저에 보관한 입력이 있어요\./);

async function open(url: string, on = page) {
  await on.goto(url);
  // 빈 본문은 같은 클래스의 자리 표시가 함께 있어 편집 칸만 기다린다.
  await on.locator(".body-editor-content[contenteditable=true]").waitFor();
}

/** 같은 브라우저에서 화면을 새 탭으로 다시 연다. */
async function reopen(url: string) {
  const next = await context.newPage();
  next.on("dialog", (dialog) => void dialog.accept());
  await open(url, next);
  return next;
}

/** 다시 연 화면이 보관본을 읽을 시간을 준 뒤 안내가 없는지 본다. */
async function expectNoRestoreNotice(on: Page) {
  await on.waitForTimeout(1000);
  expect(await restoreNotice(on).count()).toBe(0);
}

describe("자동 보관과 복구", () => {
  test("입력이 멈추면 이 브라우저에 보관했다고 보이고, 다시 열어 ‘복구’하면 저장하지 않고 입력이 미저장으로 돌아온다", async () => {
    const url = postUrl(app, POSTS.restore);
    await open(url);
    await titleInput().fill("복구할 제목");
    await archived().waitFor({ timeout: 2000 });
    expect(
      await page.getByText("자동 보관은 이 브라우저에만 30일 동안 두는 것이라 레포에는 저장되지 않아요.").isVisible(),
    ).toBe(true);

    const next = await reopen(url);
    await restoreNotice(next).waitFor();
    expect(await next.getByText("마지막으로 보관한 뒤 30일이 지나면 지워져요.").count()).toBe(1);
    expect(
      await next.getByText("다른 기기나 다른 브라우저, 브라우저 데이터를 지운 뒤에는 복구할 수 없어요.").count(),
    ).toBe(1);
    expect(await titleInput(next).inputValue()).toBe("restore 글");

    await next.getByRole("button", { name: "복구", exact: true }).click();

    await next.getByText(/^저장하지 않은 변경이 있어요\. 바뀐 곳: 글 설정/).waitFor();
    expect(await titleInput(next).inputValue()).toBe("복구할 제목");
    expect(await restoreNotice(next).count()).toBe(0);
    expect(app.commits()).toBe(commitsBefore);
  });

  test("복구 안내에서 ‘버리기’를 고르면 다음에 다시 열어도 보관본이 나오지 않는다", async () => {
    const url = postUrl(app, POSTS.restore);
    await open(url);
    await titleInput().fill("버릴 제목");
    await archived().waitFor({ timeout: 2000 });
    await page.close();

    const next = await reopen(url);
    await restoreNotice(next).waitFor();
    await next.getByRole("button", { name: "버리기" }).click();
    expect(await restoreNotice(next).count()).toBe(0);

    await expectNoRestoreNotice(await reopen(url));
  });

  test("임시저장에 성공하면 저장한 내용의 보관본을 지워 다시 열어도 복구 안내가 없다", async () => {
    const url = postUrl(app, POSTS.save);
    await open(url);
    await titleInput().fill("저장할 제목");
    await page.getByRole("button", { name: "임시저장" }).click();
    await page.getByText(/^임시저장했어요\./).waitFor();

    await expectNoRestoreNotice(await reopen(url));
  });

  test("‘변경 버리고 나가기’를 고르면 그 글의 보관본을 지운다", async () => {
    const url = postUrl(app, POSTS.leave);
    await open(url);
    await titleInput().fill("버리고 나갈 제목");
    await archived().waitFor({ timeout: 2000 });

    await page.getByRole("link", { name: `${REPO} · 게시판` }).click();
    await page.getByRole("button", { name: "변경 버리고 나가기" }).click();
    await page.waitForURL(`${app.origin}/repos/${REPO}?collection=%EA%B2%8C%EC%8B%9C%ED%8C%90`);

    await expectNoRestoreNotice(await reopen(url));
  });

  test("보관한 뒤 다른 곳에서 글이 바뀌면 복구하지 않고 지금 글과 보관한 내용을 함께 보여 복사하게 한다", async () => {
    const url = postUrl(app, POSTS.conflict);
    await open(url);
    await titleInput().fill("보관한 제목");
    await archived().waitFor({ timeout: 2000 });
    await page.close();
    app.pushElsewhere(POSTS.conflict, source("다른 곳에서 고친 글"));

    const next = await reopen(url);
    await next.getByText(/다른 곳에서 글이 바뀌어 바로 복구하지 않아요/).waitFor();
    expect(await next.getByRole("button", { name: "복구", exact: true }).count()).toBe(0);
    expect(await next.getByRole("textbox", { name: "지금 글" }).inputValue()).toContain("다른 곳에서 고친 글");
    expect(await next.getByRole("textbox", { name: "보관한 내용" }).inputValue()).toContain("제목: 보관한 제목");
    expect(await next.getByRole("button", { name: "보관 내용 복사" }).count()).toBe(1);
    expect(await titleInput(next).inputValue()).toBe("다른 곳에서 고친 글");
  });
});

describe("새 글", () => {
  test("새 글 입력을 보관해 다시 연 새 글 화면에서 복구하고, ‘작성 취소’를 확인하면 그 보관본을 지운다", async () => {
    await open(newUrl(app));
    await titleInput().fill("쓰다 만 새 글");
    await archived().waitFor({ timeout: 2000 });
    await page.close();

    const next = await reopen(newUrl(app));
    await restoreNotice(next).waitFor();
    await next.getByRole("button", { name: "복구", exact: true }).click();
    expect(await titleInput(next).inputValue()).toBe("쓰다 만 새 글");
    // 복구한 입력이 이 탭의 보관본으로 옮겨진 뒤에 취소해야 그 보관본을 지우는지 볼 수 있다.
    await archived(next).waitFor();

    await next.getByRole("button", { name: "작성 취소" }).click();
    await next.getByRole("dialog", { name: "작성을 취소할까요?" }).getByRole("button", { name: "작성 취소" }).click();
    await next.waitForURL(`${app.origin}/repos/${REPO}?collection=%EA%B2%8C%EC%8B%9C%ED%8C%90`);

    await expectNoRestoreNotice(await reopen(newUrl(app)));
    expect(app.commits()).toBe(commitsBefore);
  });
});
