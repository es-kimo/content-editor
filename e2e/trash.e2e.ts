import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { FIELD_PREFIX } from "@/lib/metadata-form";

import { startApp, type App } from "./app";

const REPO = "es-kimo/trash";
/** 휴지통으로 옮겼다가 복구해 보는 게시 대상 글. 이미지가 있다. */
const POST = "content/게시판/휴진/page.mdx";
const IMAGE = "content/게시판/휴진/1.png";
/** 미저장 입력이 있을 때 먼저 저장해 보는 초안. */
const DRAFT = "content/게시판/초안/page.mdx";
/** 휴지통 목록에 처음부터 있는 글. 먼저 지운 글이라 목록 아래에 온다. */
const OLD_TRASH = "content/게시판/예전/page.mdx";
/** 두 탭에서 휴지통으로 옮겨 보는 글. */
const TWICE = "content/게시판/두번/page.mdx";
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
      components: ["Image"],
      editor: "wysiwyg",
    },
  ],
};
const source = (title: string, status: string, trashedAt?: string) => `import image1 from "./1.png";

export const metadata = {
  title: '${title}',
  other: { status: '${status}'${trashedAt ? `, trashedAt: '${trashedAt}'` : ""} },
};

# ${title}

<Image src={image1} alt="" />
`;

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    { path: POST, content: source("11월 휴진 안내", "ready") },
    { path: IMAGE, content: "png" },
    { path: DRAFT, content: source("쓰던 초안", "draft") },
    { path: OLD_TRASH, content: source("예전에 지운 글", "draft", "2020-01-01T00:00:00Z") },
    { path: TWICE, content: source("두 번 지울 글", "draft") },
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
const listUrl = () => `${app.origin}/repos/${REPO}?${new URLSearchParams({ collection: "게시판" })}`;
const button = (name: string) => page.getByRole("button", { name, exact: true });
const input = (key: string) => page.locator(`input[name="${FIELD_PREFIX}${key}"]`);
const statusLine = () => page.locator("main > header").getByText(/^상태: /);
const dialog = (name: string) => page.getByRole("dialog", { name });
const focused = (locator: ReturnType<Page["locator"]>) => locator.evaluate((el) => el === document.activeElement);
// 떠난 화면은 숨겨진 채 남아 있어 지금 보이는 표의 줄만 고른다.
const rows = () => page.locator("tbody tr").filter({ visible: true });
const row = (title: string) => rows().filter({ has: page.getByRole("link", { name: title }) });

describe("휴지통", () => {
  test("게시 대상 글을 확인한 뒤 휴지통으로 옮기면 목록에서 빠지고 휴지통에 보이며, 복구하면 초안이 된다", async () => {
    const trashDialog = () => dialog("‘11월 휴진 안내’을 휴지통으로 옮길까요?");
    await page.goto(postUrl(POST));
    await page.getByText("고친 내용은 ‘수정 반영’을 눌러야 레포에 저장돼요.").waitFor();
    await button("삭제").click();
    await trashDialog().waitFor();
    expect(await focused(trashDialog().getByRole("button", { name: "계속 편집" }))).toBe(true);
    for (const text of [
      "휴지통에서 초안으로 복구할 수 있어요",
      "첨부 이미지는 지우지 않아요",
      "기간 제한 없이 남고 자동으로 지워지지 않아요",
      "사이트에서 사라지기까지 시간이 걸릴 수 있어요",
    ]) {
      expect(await trashDialog().getByText(text, { exact: false }).isVisible()).toBe(true);
    }
    await trashDialog().getByRole("button", { name: "계속 편집" }).click();
    expect(newCommits()).toBe(0);

    await button("삭제").click();
    await trashDialog().getByRole("button", { name: "삭제" }).click();
    await page.getByText("휴지통으로 옮겼어요. 휴지통에서 초안으로 복구할 수 있어요.").waitFor();
    expect(newCommits()).toBe(1);
    expect(app.file(POST)).toContain("trashedAt");
    expect(app.file(IMAGE)).toBe("png");
    // 휴지통 글 화면은 편집 대신 안내와 ‘복구’만 보인다.
    expect(await statusLine().textContent()).toBe("상태: 휴지통");
    expect(await page.getByText("휴지통에 있는 글이에요. 복구한 뒤에 고칠 수 있어요.").isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: /^(수정 반영|게시 내리기|임시저장|게시|삭제)$/ }).count()).toBe(0);
    expect(await input("title").count()).toBe(0);
    expect(await button("복구").isVisible()).toBe(true);

    await page.goto(listUrl());
    await page.getByRole("link", { name: "휴지통", exact: true }).click();
    await page.getByRole("heading", { name: "휴지통", level: 1 }).waitFor();
    await page.getByText("자동으로 지워지지 않아요. 글과 첨부 이미지 파일은 레포에").waitFor();
    // 최근에 지운 글이 위다.
    const titles = await rows().locator("td:first-child").allTextContents();
    expect(titles).toEqual(["11월 휴진 안내", "예전에 지운 글"]);
    expect(await row("예전에 지운 글").getByRole("cell").nth(1).textContent()).toBe("2020-01-01 09:00");

    await row("11월 휴진 안내").getByRole("button", { name: "복구" }).click();
    await page.getByText("초안으로 복구했어요. 게시하려면 ‘게시’를 눌러 주세요.").waitFor();
    expect(newCommits()).toBe(2);
    expect(app.file(POST)).not.toContain("trashedAt");
    expect(app.file(POST)).toContain("status: 'draft'");
    expect(await statusLine().textContent()).toBe("상태: 초안");
    expect(await button("게시").isVisible()).toBe(true);

    await page.goto(listUrl());
    await row("11월 휴진 안내").waitFor();
    expect(await row("11월 휴진 안내").getByRole("cell").nth(1).textContent()).toBe("초안");
  });

  test("미저장 입력이 있으면 먼저 저장하거나 버리기를 고르고, 버리면 입력 없이 휴지통으로 옮긴다", async () => {
    const unsavedDialog = () => dialog("저장하지 않은 변경이 있어요.");
    await page.goto(postUrl(DRAFT));
    await input("title").fill("버릴 제목");
    await button("삭제").click();
    await unsavedDialog().waitFor();
    expect(
      await unsavedDialog()
        .getByText(/바뀐 곳: 글 설정/)
        .isVisible(),
    ).toBe(true);
    expect(await unsavedDialog().getByRole("button", { name: "임시저장" }).isVisible()).toBe(true);

    await unsavedDialog().getByRole("button", { name: "변경 버리기" }).click();
    const trashDialog = () => dialog("‘쓰던 초안’을 휴지통으로 옮길까요?");
    await trashDialog().waitFor();
    expect(await focused(trashDialog().getByRole("button", { name: "계속 편집" }))).toBe(true);
    expect(newCommits()).toBe(0);
    await trashDialog().getByRole("button", { name: "삭제" }).click();
    await page.getByText("휴지통으로 옮겼어요. 휴지통에서 초안으로 복구할 수 있어요.").waitFor();
    expect(newCommits()).toBe(1);
    expect(app.file(DRAFT)).toContain("title: '쓰던 초안'");
    expect(app.file(DRAFT)).toContain("trashedAt");
    expect(await page.getByText(/저장하지 않은 변경이 있/).count()).toBe(0);
  });

  test("다른 탭에서 먼저 휴지통으로 옮긴 글을 다시 옮기면 덮어쓰지 않고 다시 열어 확인하게 한다", async () => {
    const other = await context.newPage();
    await other.goto(postUrl(TWICE));
    await page.goto(postUrl(TWICE));
    await button("삭제").click();
    await dialog("‘두 번 지울 글’을 휴지통으로 옮길까요?").getByRole("button", { name: "삭제" }).click();
    await statusLine().filter({ hasText: "휴지통" }).waitFor();

    await other.getByRole("button", { name: "삭제", exact: true }).click();
    await other
      .getByRole("dialog", { name: "‘두 번 지울 글’을 휴지통으로 옮길까요?" })
      .getByRole("button", { name: "삭제" })
      .click();
    await other
      .getByText("화면을 연 뒤 다른 곳에서 글이 바뀌었어요. 글을 다시 열어 바뀐 내용을 확인해 주세요.")
      .waitFor();
    expect(newCommits()).toBe(1);
  });
});

describe("작성 취소", () => {
  test("저장한 적 없는 새 글은 ‘삭제’ 대신 ‘작성 취소’가 있고, 확인하면 커밋 없이 입력을 버리고 목록으로 간다", async () => {
    await page.goto(`${app.origin}/repos/${REPO}/new?${new URLSearchParams({ collection: "게시판" })}`);
    await input("title").fill("쓰다 만 글");
    expect(await button("삭제").count()).toBe(0);

    await button("작성 취소").click();
    const cancelDialog = dialog("작성을 취소할까요?");
    await cancelDialog.waitFor();
    expect(await cancelDialog.getByText("이 브라우저에 보관한 입력도 지워져요.").isVisible()).toBe(true);
    await cancelDialog.getByRole("button", { name: "계속 편집" }).click();
    expect(await input("title").inputValue()).toBe("쓰다 만 글");

    await button("작성 취소").click();
    await cancelDialog.getByRole("button", { name: "작성 취소" }).click();
    await page.waitForURL(listUrl());
    // 이탈 확인을 다시 띄우지 않는다.
    expect(await page.getByRole("dialog").filter({ visible: true }).count()).toBe(0);
    expect(newCommits()).toBe(0);

    await page.goBack();
    await input("title").waitFor();
    expect(await input("title").inputValue()).toBe("");
  });
});
