import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { FIELD_PREFIX } from "@/lib/metadata-form";

import { startApp, type App } from "./app";

const REPO = "es-kimo/e2e";
const POST = "content/게시판/휴진/page.mdx";
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
      components: ["Image"],
      editor: "wysiwyg",
    },
    {
      name: "공지",
      path: "content/공지/{slug}/page.mdx",
      metadata: { title: { type: "string", label: "제목", required: true } },
      editor: "wysiwyg",
    },
    {
      name: "각주",
      path: "content/각주/{slug}/page.mdx",
      metadata: { title: { type: "string", label: "제목", required: true } },
      components: ["Footnote"],
      editor: "source",
    },
  ],
};
/** 원문 편집으로 열고 각주를 폼으로 고쳐 보는 글. */
const FOOTNOTE_POST = "content/각주/휴진/page.mdx";
const SOURCE = `export const metadata = {
  title: '휴진 안내',
};

# 휴진 안내

이번 주는 쉰다.
`;
// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const LEAVE_TITLE = "저장하지 않은 변경이 있어요. 나가면 입력이 사라져요.";
const postUrl = (app: App, path = POST) => `${app.origin}/repos/${REPO}/post?${new URLSearchParams({ path })}`;
const listUrl = (app: App, collection: string) => `${app.origin}/repos/${REPO}?${new URLSearchParams({ collection })}`;
const newUrl = (app: App, collection: string) =>
  `${app.origin}/repos/${REPO}/new?${new URLSearchParams({ collection })}`;

let app: App;
let context: BrowserContext;
let page: Page;
/** 브라우저 기본 경고(beforeunload)와 그 밖의 브라우저 대화상자. 받은 것은 닫아 머무른다. */
let browserDialogs: string[];
let commitsBefore: number;
/** 이 테스트에서 가짜 레포에 생긴 커밋 수. */
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    { path: POST, content: SOURCE },
    { path: SAVED_POST, content: SOURCE.replaceAll("휴진 안내", "저장해 볼 글") },
    { path: "content/공지/안내/page.mdx", content: "export const metadata = {\n  title: '안내',\n};\n\n# 안내\n" },
    { path: FOOTNOTE_POST, content: SOURCE.replace("쉰다.", '쉰다<Footnote id="1">공휴일</Footnote>.') },
  ]);
});
afterAll(async () => app?.close());

beforeEach(async () => {
  context = await app.context();
  page = await context.newPage();
  browserDialogs = [];
  commitsBefore = app.commits();
  page.on("dialog", (dialog) => {
    browserDialogs.push(dialog.type());
    void dialog.dismiss();
  });
});
afterEach(async () => context.close());

const leaveDialog = () => page.getByRole("dialog", { name: LEAVE_TITLE });
const keepButton = () => leaveDialog().getByRole("button", { name: "계속 편집" });
const leaveButton = () => leaveDialog().getByRole("button", { name: "변경 버리고 나가기" });
const titleInput = () => page.locator(`input[name="${FIELD_PREFIX}title"]`);
const newTitleInput = () => page.locator('input[name="title"]');
const listLink = (collection = "게시판") => page.getByRole("link", { name: `${REPO} · ${collection}` });
const isFocused = (locator: ReturnType<Page["locator"]>) => locator.evaluate((el) => el === document.activeElement);
const sourceMode = () => page.getByRole("button", { name: "원문 편집", exact: true });
const historyIndex = () => page.evaluate(() => history.length);

async function openPost(path = POST) {
  await page.goto(postUrl(app, path));
  await page.locator(".body-editor-content").waitFor();
}

const POST_EDITED = "저장하지 않은 변경이 있어요. 바뀐 곳: 글 설정, 본문, 첨부 이미지";

/** 본문 끝에 이미지를 넣는다. 도구 막대의 이미지 버튼처럼 본문에 커서를 둔 채 파일을 고른다. */
async function attachImage() {
  await page.locator(".body-editor-content").click();
  await page.keyboard.press("Control+End");
  await page.locator('input[type="file"]').setInputFiles({ name: "사진.png", mimeType: "image/png", buffer: PNG });
  await page.getByText(/넣은 이미지: /).waitFor();
}

/** 제목을 바꾸고 이미지를 넣고 원문 모드로 바꾼다. 모드 전환은 입력을 유지하므로 묻지 않아야 한다. */
async function editPost() {
  await titleInput().fill("휴진 안내 (수정)");
  await attachImage();
  await page.getByText(POST_EDITED).waitFor();
  await sourceMode().click();
  expect(await leaveDialog().isVisible()).toBe(false);
}

/** 취소한 뒤 주소·입력·첨부·모드가 그대로인지. */
async function expectPostKept() {
  expect(page.url()).toBe(postUrl(app));
  expect(await titleInput().inputValue()).toBe("휴진 안내 (수정)");
  expect(await page.getByText(POST_EDITED).count()).toBe(1);
  // 원문 모드라 WYSIWYG 쪽은 숨어 있지만 넣은 이미지는 남아 있다.
  expect(await page.getByText(/넣은 이미지: /).count()).toBe(1);
  expect(await sourceMode().getAttribute("aria-pressed")).toBe("true");
}

/** 이력 이동을 막으면 Playwright가 이동을 기다리다 끝나므로 기다리지 않는다. */
const back = () => page.goBack({ timeout: 1000 }).catch(() => null);
const forward = () => page.goForward({ timeout: 1000 }).catch(() => null);

describe("기존 글", () => {
  test("목록 이동을 취소하면 주소·입력·첨부·모드가 남고, 버리고 나가면 목록으로 한 번 가며 커밋하지 않는다", async () => {
    await openPost();
    await editPost();
    const before = await historyIndex();

    await listLink().click();
    await leaveDialog().waitFor();
    // 기본 선택은 계속 편집이고, Esc는 계속 편집과 같다. 닫히면 누른 링크로 초점이 돌아온다.
    expect(await isFocused(keepButton())).toBe(true);
    await page.keyboard.press("Escape");
    await leaveDialog().waitFor({ state: "hidden" });
    await expectPostKept();
    expect(await isFocused(listLink())).toBe(true);

    // 키보드로 링크를 다시 열고 Enter로 기본 선택(계속 편집)을 고른다.
    await page.keyboard.press("Enter");
    await leaveDialog().waitFor();
    await page.keyboard.press("Enter");
    await leaveDialog().waitFor({ state: "hidden" });
    await expectPostKept();
    expect(await isFocused(listLink())).toBe(true);

    await listLink().click();
    await leaveButton().click();
    await page.waitForURL(listUrl(app, "게시판"));
    expect(await historyIndex()).toBe(before + 1);
    expect(newCommits()).toBe(0);
    expect(browserDialogs).toEqual([]);
  });

  test("뒤로 이동을 취소하면 주소·입력·첨부·모드가 남고, 버리고 나가면 앞 화면으로 간다", async () => {
    await page.goto(listUrl(app, "게시판"));
    await page.getByRole("link", { name: "휴진 안내" }).click();
    await page.waitForURL(postUrl(app));
    await page.locator(".body-editor-content").waitFor();
    await editPost();
    const before = await historyIndex();

    await back();
    await leaveDialog().waitFor();
    await keepButton().click();
    await expectPostKept();
    // 마지막으로 누른 모드 버튼으로 초점이 돌아온다.
    expect(await isFocused(sourceMode())).toBe(true);

    await back();
    await leaveButton().click();
    await page.waitForURL(listUrl(app, "게시판"));
    expect(await historyIndex()).toBe(before);
    expect(await leaveDialog().isVisible()).toBe(false);
    expect(newCommits()).toBe(0);
    expect(browserDialogs).toEqual([]);
  });

  test("버리고 나간 글로 뒤로 가기나 목록 링크로 돌아오면 버린 입력 없이 열리고, 새로 입력하면 다시 지킨다", async () => {
    // 버린 입력·첨부·모드가 모두 처음 상태인지.
    const expectPostOpenedFresh = async () => {
      expect(page.url()).toBe(postUrl(app));
      await page.locator(".body-editor-content").waitFor();
      expect(await titleInput().inputValue()).toBe("휴진 안내");
      expect(await page.getByText(/저장하지 않은 변경이 있어요/).count()).toBe(0);
      expect(await page.getByText(/넣은 이미지: /).count()).toBe(0);
      expect(await sourceMode().getAttribute("aria-pressed")).toBe("false");
    };
    await page.goto(listUrl(app, "게시판"));
    await page.getByRole("link", { name: "휴진 안내" }).click();
    await page.waitForURL(postUrl(app));
    await page.locator(".body-editor-content").waitFor();

    await editPost();
    await listLink().click();
    await leaveButton().click();
    await page.waitForURL(listUrl(app, "게시판"));
    await back();
    await page.waitForURL(postUrl(app));
    await expectPostOpenedFresh();

    await editPost();
    await listLink().click();
    await leaveButton().click();
    await page.waitForURL(listUrl(app, "게시판"));
    await page.getByRole("link", { name: "휴진 안내" }).click();
    await page.waitForURL(postUrl(app));
    await expectPostOpenedFresh();

    await titleInput().fill("휴진 안내 (다시 수정)");
    await listLink().click();
    await leaveDialog().waitFor();
    expect(await leaveDialog().getByText("바뀐 곳: 글 설정").count()).toBe(1);
    await keepButton().click();
    expect(newCommits()).toBe(0);
    expect(browserDialogs).toEqual([]);
  });

  test("변경 없는 화면, 새 탭 열기, 페이지 내 앵커, 미리보기 조작, 모드 전환은 묻지 않는다", async () => {
    await openPost();
    await sourceMode().click();
    await page.getByRole("button", { name: "일반 편집" }).click();
    await page
      .getByRole("button", { name: /미리보기/ })
      .first()
      .click();
    await listLink().click();
    await page.waitForURL(listUrl(app, "게시판"));
    expect(await leaveDialog().count()).toBe(0);

    await openPost();
    await titleInput().fill("휴진 안내 (수정)");
    const [opened] = await Promise.all([context.waitForEvent("page"), listLink().click({ modifiers: ["Control"] })]);
    await opened.waitForLoadState();
    expect(opened.url()).toBe(listUrl(app, "게시판"));
    await page.evaluate(() => {
      const anchor = Object.assign(document.createElement("a"), { href: "#본문", textContent: "본문으로" });
      document.querySelector("main")!.append(anchor);
    });
    await page.getByRole("link", { name: "본문으로" }).click();
    await back();
    await page
      .getByRole("button", { name: /미리보기/ })
      .first()
      .click();
    await sourceMode().click();

    expect(await leaveDialog().isVisible()).toBe(false);
    expect(page.url()).toBe(postUrl(app));
    expect(await titleInput().inputValue()).toBe("휴진 안내 (수정)");
  });

  test("metadata를 저장해 다시 열릴 때는 경고하지 않고, 남은 본문·첨부 입력은 계속 지킨다", async () => {
    await openPost(SAVED_POST);
    await titleInput().fill("휴진 안내 (수정)");
    await attachImage();
    await page.getByText(POST_EDITED).waitFor();

    await page.getByRole("button", { name: "글 설정 저장" }).click();
    // 본문·첨부 입력은 다시 열리지 않으므로 묻지 않고 저장한다.
    await page.getByText(/^저장했어요\./).waitFor();
    expect(await leaveDialog().isVisible()).toBe(false);
    expect(newCommits()).toBe(1);

    await listLink().click();
    await leaveDialog().waitFor();
    expect(await leaveDialog().getByText("바뀐 곳: 본문, 첨부 이미지").count()).toBe(1);
    await keepButton().click();
    expect(browserDialogs).toEqual([]);
  });
});

describe("넣기·수정 폼", () => {
  const footnoteForm = () => page.getByRole("form", { name: "각주 1 수정" });
  const footnoteInput = () => footnoteForm().getByRole("textbox", { name: "각주 내용" });
  const sourceText = () => page.locator(".cm-content").innerText();

  /** 목록에서 원문 편집으로 여는 글을 열고 각주 수정 폼에 내용을 고쳐 쓴다. 아직 적용하지 않는다. */
  async function typeInFootnoteForm() {
    await page.goto(listUrl(app, "각주"));
    await page.getByRole("link", { name: "휴진 안내" }).click();
    await page.waitForURL(postUrl(app, FOOTNOTE_POST));
    await page.locator(".cm-content").waitFor();
    await page.getByText("삽입 항목 1개").click();
    await page.getByRole("button", { name: "각주 1 수정" }).click();
    await footnoteInput().fill("설 연휴");
  }

  test("폼에 입력 중이면 목록 이동·뒤로 가기를 확인하고, 계속 편집하면 폼과 입력이 그대로 남는다", async () => {
    await typeInFootnoteForm();

    await listLink("각주").click();
    await leaveDialog().waitFor();
    expect(await leaveDialog().getByText("바뀐 곳: 원문 편집").count()).toBe(1);
    await keepButton().click();
    expect(page.url()).toBe(postUrl(app, FOOTNOTE_POST));
    expect(await footnoteInput().inputValue()).toBe("설 연휴");

    await back();
    await leaveDialog().waitFor();
    await keepButton().click();
    expect(page.url()).toBe(postUrl(app, FOOTNOTE_POST));
    expect(await footnoteInput().inputValue()).toBe("설 연휴");
    expect(await sourceText()).not.toContain("설 연휴");
    expect(newCommits()).toBe(0);
    expect(browserDialogs).toEqual([]);
  });

  test("폼을 적용하면 입력이 원문 편집의 미저장 변경으로 넘어가 계속 지키고, 버리고 나간 글로 돌아오면 입력 없이 열린다", async () => {
    await typeInFootnoteForm();
    await footnoteForm().getByRole("button", { name: "적용" }).click();
    await page.getByText("저장하지 않은 변경이 있어요. 바뀐 곳: 원문 편집").waitFor();

    await listLink("각주").click();
    await leaveDialog().waitFor();
    expect(await leaveDialog().getByText("바뀐 곳: 원문 편집").count()).toBe(1);
    await leaveButton().click();
    await page.waitForURL(listUrl(app, "각주"));
    await back();
    await page.waitForURL(postUrl(app, FOOTNOTE_POST));
    await page.locator(".cm-content").waitFor();

    expect(await sourceText()).toContain('<Footnote id="1">공휴일</Footnote>');
    expect(await footnoteForm().count()).toBe(0);
    expect(await page.getByText(/저장하지 않은 변경이 있어요/).count()).toBe(0);
    expect(newCommits()).toBe(0);
    expect(browserDialogs).toEqual([]);
  });

  test("폼에 입력 중이면 새로고침에 기본 경고를 요청하고, 취소하면 요청하지 않는다", async () => {
    await typeInFootnoteForm();

    await page.reload({ timeout: 2000 }).catch(() => null);
    await vi.waitFor(() => expect(browserDialogs).toEqual(["beforeunload"]));
    expect(await footnoteInput().inputValue()).toBe("설 연휴");

    await footnoteForm().getByRole("button", { name: "취소" }).click();
    await page.reload();
    await page.locator(".cm-content").waitFor();
    expect(browserDialogs).toEqual(["beforeunload"]);
  });
});

describe("새 글", () => {
  test("목록·컬렉션 이동을 취소하면 주소와 입력이 남고, 버리고 나가면 고른 컬렉션으로 한 번 간다", async () => {
    await page.goto(newUrl(app, "게시판"));
    await newTitleInput().fill("새 휴진 안내");
    const before = await historyIndex();

    await page.getByRole("link", { name: "공지", exact: true }).click();
    await leaveDialog().waitFor();
    await page.keyboard.press("Escape");
    await leaveDialog().waitFor({ state: "hidden" });
    expect(page.url()).toBe(newUrl(app, "게시판"));
    expect(await newTitleInput().inputValue()).toBe("새 휴진 안내");
    expect(await isFocused(page.getByRole("link", { name: "공지", exact: true }))).toBe(true);

    await listLink().click();
    await keepButton().click();
    expect(page.url()).toBe(newUrl(app, "게시판"));
    expect(await newTitleInput().inputValue()).toBe("새 휴진 안내");

    await page.getByRole("link", { name: "공지", exact: true }).click();
    await leaveButton().click();
    await page.waitForURL(newUrl(app, "공지"));
    expect(await newTitleInput().inputValue()).toBe("");
    expect(await historyIndex()).toBe(before + 1);

    // 옮긴 컬렉션에서 새로 입력하면 다시 지킨다.
    await newTitleInput().fill("공지 초안");
    await listLink("공지").click();
    await leaveDialog().waitFor();
    await keepButton().click();
    expect(newCommits()).toBe(0);
    expect(browserDialogs).toEqual([]);
  });

  test("앞으로 이동을 취소하면 주소와 입력이 남고, 버리고 나가면 다음 화면으로 간다", async () => {
    await page.goto(newUrl(app, "게시판"));
    await page.getByRole("link", { name: "공지", exact: true }).click();
    await page.waitForURL(newUrl(app, "공지"));
    await back();
    await page.waitForURL(newUrl(app, "게시판"));
    await newTitleInput().fill("새 휴진 안내");

    await forward();
    await leaveDialog().waitFor();
    expect(await isFocused(keepButton())).toBe(true);
    await page.keyboard.press("Escape");
    await leaveDialog().waitFor({ state: "hidden" });
    expect(page.url()).toBe(newUrl(app, "게시판"));
    expect(await newTitleInput().inputValue()).toBe("새 휴진 안내");
    expect(await isFocused(newTitleInput())).toBe(true);

    await forward();
    await leaveButton().click();
    await page.waitForURL(newUrl(app, "공지"));
    expect(await newTitleInput().inputValue()).toBe("");
    expect(newCommits()).toBe(0);
    expect(browserDialogs).toEqual([]);
  });

  test("목록으로 버리고 나간 새 글 화면으로 뒤로 가면 버린 입력 없이 열린다", async () => {
    await page.goto(newUrl(app, "게시판"));
    await newTitleInput().fill("새 휴진 안내");

    await listLink().click();
    await leaveButton().click();
    await page.waitForURL(listUrl(app, "게시판"));
    await back();
    await page.waitForURL(newUrl(app, "게시판"));

    expect(await newTitleInput().inputValue()).toBe("");
    expect(await page.getByText(/저장하지 않은 변경이 있어요/).count()).toBe(0);
    await listLink().click();
    await page.waitForURL(listUrl(app, "게시판"));
    expect(await leaveDialog().count()).toBe(0);
    expect(browserDialogs).toEqual([]);
  });

  test("새 글을 만들어 편집 화면으로 갈 때는 경고하지 않는다", async () => {
    await page.goto(newUrl(app, "공지"));
    await newTitleInput().fill("새 공지");

    await page.getByRole("button", { name: "만들기" }).click();
    await page.waitForURL(/\/post\?/);
    await page.locator(".body-editor-content").waitFor();

    expect(await leaveDialog().isVisible()).toBe(false);
    expect(browserDialogs).toEqual([]);
    await listLink("공지").click();
    await page.waitForURL(listUrl(app, "공지"));
  });
});

describe("브라우저 기본 경고", () => {
  test("미저장이면 새로고침·외부 이동·탭 닫기에 기본 경고만 요청하고, 되돌리면 요청하지 않는다", async () => {
    await openPost();
    // 브라우저는 사용자가 누른 적이 있는 화면에만 기본 경고를 띄운다.
    await titleInput().click();
    await titleInput().fill("휴진 안내 (수정)");
    await page.getByText("저장하지 않은 변경이 있어요. 바뀐 곳: 글 설정").waitFor();

    await page.reload({ timeout: 2000 }).catch(() => null);
    await vi.waitFor(() => expect(browserDialogs).toEqual(["beforeunload"]));
    expect(await leaveDialog().isVisible()).toBe(false);
    expect(await titleInput().inputValue()).toBe("휴진 안내 (수정)");

    await page.evaluate(() => (window.location.href = "https://example.com/"));
    await vi.waitFor(() => expect(browserDialogs).toEqual(["beforeunload", "beforeunload"]));
    expect(await leaveDialog().isVisible()).toBe(false);
    expect(page.url()).toBe(postUrl(app));

    await page.close({ runBeforeUnload: true });
    await vi.waitFor(() => expect(browserDialogs).toEqual(["beforeunload", "beforeunload", "beforeunload"]));
    expect(page.isClosed()).toBe(false);

    await titleInput().fill("휴진 안내");
    await page.getByText(/저장하지 않은 변경이 있어요/).waitFor({ state: "detached" });
    await page.reload();
    await page.locator(".body-editor-content").waitFor();
    expect(browserDialogs).toHaveLength(3);
  });

  test("변경 없는 화면은 기본 경고를 요청하지 않는다", async () => {
    await openPost();

    await page.reload();
    await page.locator(".body-editor-content").waitFor();
    await page.close({ runBeforeUnload: true });

    expect(browserDialogs).toEqual([]);
  });
});
