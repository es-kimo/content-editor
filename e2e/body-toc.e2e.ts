import type { BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { startApp, type App } from "./app";

const REPO = "es-kimo/body-toc";
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
      components: ["TOC"],
      editor: "wysiwyg",
    },
  ],
};
const source = (title: string, body: string) => `export const metadata = {
  title: '${title}',
  other: { status: 'draft' },
};

# ${title}

${body}
`;
const TOC = "<TOC items={toc} />";
const HOURS = [TOC, "", "## 진료 시간", "", "평일은 9시부터 진료해요.", "", "### 토요일", "", "오전만 진료해요."].join(
  "\n",
);
const NEEDS_HEADING = "글에 제목을 추가하면 목차가 채워져요.";

/** 글마다 다른 파일을 열어 앞 테스트의 저장이 섞이지 않게 한다. */
const POSTS = {
  shown: "content/게시판/보기/page.mdx",
  edit: "content/게시판/제목-고치기/page.mdx",
  empty: "content/게시판/제목-없음/page.mdx",
  remove: "content/게시판/제거/page.mdx",
  custom: "content/게시판/직접-목차/page.mdx",
};
const FILES: { [post in keyof typeof POSTS]: string } = {
  shown: source("보기", HOURS),
  edit: source("제목 고치기", HOURS),
  empty: source("제목 없음", `${TOC}\n\n본문만 있어요.`),
  remove: source("제거", `앞 문단이에요.\n\n${HOURS}`),
  custom: source(
    "직접 목차",
    '<TOC items={[{ title: "진료 시간", url: "#진료-시간" }]} />\n\n## 진료 시간\n\n본문이에요.',
  ),
};

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    ...(Object.keys(POSTS) as (keyof typeof POSTS)[]).map((post) => ({ path: POSTS[post], content: FILES[post] })),
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
const bodyEditor = () => page.locator(".body-editor-content[contenteditable='true']");
const toc = () => bodyEditor().getByRole("button", { name: /^목차/ });
const actions = () => bodyEditor().getByRole("group", { name: "목차 관리" });
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);
const isFocused = (locator: Locator) => locator.evaluate((el) => el === document.activeElement);
const focusedText = () => page.evaluate(() => document.activeElement?.textContent ?? "");
/** 목차 자리에 보이는 줄. 첫 줄은 ‘목차’다. */
const tocLines = async () => (await toc().innerText()).split("\n").filter((line) => line.trim() !== "");
const lineX = async (text: string) => (await toc().getByText(text, { exact: true }).boundingBox())!.x;
/** 본문에서 `text`가 든 블록 끝에 커서를 둔다. 목차에 같은 글자가 보여도 본문의 글자를 누른다. */
async function caretAtEnd(text: string) {
  const exact = new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  await bodyEditor().locator("[data-lexical-text]", { hasText: exact }).click();
  await page.keyboard.press("End");
  // 편집기는 옮긴 커서를 다음 프레임에 읽으므로 그 전에 키를 누르면 이전 커서 자리에 들어간다.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function openPost(path: string) {
  await page.goto(postUrl(path));
  await bodyEditor().waitFor();
}

/** 임시저장하고 저장한 커밋으로 글 화면이 다시 열릴 때까지 기다린다. */
async function saveAndReopen() {
  const before = page.url();
  await page.getByRole("button", { name: "임시저장" }).click();
  await page.waitForURL((url) => url.href !== before && url.searchParams.has("saved"));
  await page.getByText(/^임시저장했어요\./).waitFor();
}

describe("본문 목차", () => {
  test("자동 목차 자리에 ‘목차’와 소제목이 원문 순서와 깊이대로 보이고 컴포넌트 이름은 보이지 않는다", async () => {
    await openPost(POSTS.shown);

    expect(await tocLines()).toEqual(["목차", "진료 시간", "토요일"]);
    // ‘###’ 제목은 ‘##’ 제목보다 들여 보인다.
    expect(await lineX("토요일")).toBeGreaterThan(await lineX("진료 시간"));
    expect(await bodyEditor().innerText()).not.toContain("TOC");
    // 고르기 전에는 ‘제거’를 보이지 않는다.
    expect(await actions().count()).toBe(0);
  });

  test("본문에서 제목을 추가·수정·삭제하면 저장하지 않아도 목록이 따라 바뀌고, 저장한 원문의 목차 태그는 그대로다", async () => {
    const original = app.file(POSTS.edit)!;
    await openPost(POSTS.edit);

    // 수정
    await caretAtEnd("진료 시간");
    await page.keyboard.type(" 안내");
    await unsaved("본문").waitFor();
    expect(await tocLines()).toEqual(["목차", "진료 시간 안내", "토요일"]);

    // 추가
    await caretAtEnd("오전만 진료해요.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("## 오시는 길");
    await toc().getByText("오시는 길", { exact: true }).waitFor();
    expect(await tocLines()).toEqual(["목차", "진료 시간 안내", "토요일", "오시는 길"]);

    // 삭제: ‘토요일’ 제목의 글자를 모두 지우고 제목을 문단으로 되돌린다.
    await caretAtEnd("토요일");
    for (let i = 0; i < "토요일".length + 1; i++) await page.keyboard.press("Backspace");
    await expect.poll(tocLines).toEqual(["목차", "진료 시간 안내", "오시는 길"]);
    expect(newCommits()).toBe(0);

    await saveAndReopen();
    const saved = app.file(POSTS.edit)!;
    expect(saved).toContain(`\n${TOC}\n`);
    expect(saved.split(TOC).length).toBe(2);
    expect(saved).toContain("## 진료 시간 안내");
    expect(saved).toContain("## 오시는 길");
    expect(saved).not.toContain("토요일");
    // 원문에 제목 ID나 목차 배열을 더하지 않는다.
    expect(saved).not.toMatch(/\{#|items=\{\[/);
    expect(saved.slice(0, saved.indexOf(TOC))).toBe(original.slice(0, original.indexOf(TOC)));
    expect(await tocLines()).toEqual(["목차", "진료 시간 안내", "오시는 길"]);
  });

  test("소제목이 없는 글의 목차 자리에 제목을 추가하라는 안내가 보인다", async () => {
    await openPost(POSTS.empty);

    expect(await tocLines()).toEqual(["목차", NEEDS_HEADING]);
    // 글 제목(#)은 목차에 들지 않는다.
    expect(await toc().getByText("제목 없음").count()).toBe(0);
  });

  test("키보드로 목차를 골라 ‘제거’하면 초점이 앞 블록으로 가고, 저장하면 원문에서 그 목차 줄만 빠진다", async () => {
    const original = app.file(POSTS.remove)!;
    await openPost(POSTS.remove);

    // 제거하기 전에는 넣기 메뉴로 목차를 다시 넣지 못하고 기존 안내를 보인다.
    await page.getByRole("button", { name: "넣기", exact: true }).click();
    await page.getByRole("menu", { name: "넣기" }).getByRole("menuitem", { name: "목차" }).click();
    const form = page.getByRole("form", { name: "목차 넣기" });
    await form.getByText("이미 목차가 있어요. 삽입 항목에서 기존 목차를 확인해 주세요.").waitFor();
    expect(await form.getByRole("button", { name: "적용" }).isDisabled()).toBe(true);
    await page.keyboard.press("Escape");
    await form.waitFor({ state: "detached" });

    await bodyEditor().focus();
    await page.keyboard.press("Tab");
    expect(await isFocused(toc())).toBe(true);
    await page.keyboard.press("Enter");
    await actions().waitFor();
    expect(await toc().getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Tab");
    expect(await focusedText()).toBe("제거");
    await page.keyboard.press("Enter");
    await unsaved("본문").waitFor();
    expect(await toc().count()).toBe(0);

    // 초점은 본문으로 돌아가 커서가 바로 앞 블록(‘앞 문단이에요.’) 끝에 있다.
    await page.waitForFunction(() => document.activeElement?.classList.contains("body-editor-content") ?? false);
    const caret = await page.evaluate(() => {
      const selection = document.getSelection();
      const node = selection?.anchorNode;
      const block = node instanceof Element ? node : node?.parentElement;
      return { text: block?.closest("p, h1, h2, h3")?.textContent, collapsed: selection?.isCollapsed };
    });
    expect(caret).toEqual({ text: "앞 문단이에요.", collapsed: true });

    await saveAndReopen();
    expect(newCommits()).toBe(1);
    expect(app.file(POSTS.remove)).toBe(original.replace(`${TOC}\n\n`, ""));
  });

  test("사용자 정의 목차는 제목 목록으로 보이지 않고 이유를 보이며, 열고 저장해도 그 목차의 원문이 그대로다", async () => {
    const original = app.file(POSTS.custom)!;
    await openPost(POSTS.custom);

    await bodyEditor()
      .getByText("폼으로 고칠 수 없어요. 직접 만든 목차예요. 원문 편집에서 직접 고쳐 주세요.")
      .waitFor();
    expect(await toc().count()).toBe(0);
    // 지금처럼 이름과 속성을 그대로 보인다.
    expect(await bodyEditor().innerText()).toContain("TOC");

    await caretAtEnd("본문이에요.");
    await page.keyboard.type("!");
    await unsaved("본문").waitFor();
    await saveAndReopen();
    expect(newCommits()).toBe(1);
    expect(app.file(POSTS.custom)).toBe(original.replace("본문이에요.", "본문이에요.!"));
  });

  test("폭 360px에서 목차와 ‘제거’가 가로로 넘치지 않는다", async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openPost(POSTS.shown);

    await toc().click();
    await actions().waitFor();
    const overflow = await page.evaluate(() => {
      const editor = document.querySelector(".body-editor-content")!;
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        editor: editor.scrollWidth - editor.clientWidth,
      };
    });
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.editor).toBeLessThanOrEqual(0);
  });
});
