import type { BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { startApp, type App } from "./app";

const REPO = "es-kimo/body-footnote";
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
      components: ["Footnote", "FootnoteRef"],
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
// 번호 3이 2 없이 1 뒤에 온다. 순서로 다시 매기면 2로 보인다.
const NOTES = [
  '진료를 쉬어요<Footnote id="1">공휴일</Footnote>. 토요일은 오전만 봐요<Footnote id="3">오후 휴진</Footnote>.',
  "",
  '<FootnoteRef ids={["1"]}>',
  "  병원 공지",
  "</FootnoteRef>",
].join("\n");

/** 글마다 다른 파일을 열어 앞 테스트의 저장이 섞이지 않게 한다. */
const POSTS = {
  shown: "content/게시판/보기/page.mdx",
  footnote: "content/게시판/각주-수정/page.mdx",
  ref: "content/게시판/출처-수정/page.mdx",
  keyboard: "content/게시판/키보드/page.mdx",
  limited: "content/게시판/제한/page.mdx",
};
const FILES: { [post in keyof typeof POSTS]: string } = {
  shown: source("보기", NOTES),
  footnote: source("각주 수정", NOTES),
  ref: source("출처 수정", NOTES),
  keyboard: source("키보드", NOTES),
  limited: source(
    "제한",
    '진료를 쉬어요<Footnote id="1">공휴일</Footnote>. 다시<Footnote id="1">겹친 번호</Footnote>.',
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
const footnote = (id: number) => bodyEditor().getByRole("button", { name: `각주 ${id}`, exact: true });
const ref = () => bodyEditor().getByRole("button", { name: "각주 1 출처, 병원 공지" });
const actions = (name: string) => bodyEditor().getByRole("group", { name: `${name} 관리` });
const editButton = (name: string) => actions(name).getByRole("button", { name: "수정", exact: true });
const form = (name: string) => page.getByRole("form", { name });
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);
const anyUnsaved = () => page.getByText(/저장하지 않은 변경이 있어요/);
const isFocused = (locator: Locator) => locator.evaluate((el) => el === document.activeElement);
const focusedText = () => page.evaluate(() => document.activeElement?.textContent ?? "");
/** 초점이 `locator`에 올 때까지 기다린다. 폼을 닫으면 편집기가 다시 그린 뒤에 초점이 간다. */
const waitFocused = (locator: Locator) =>
  locator.evaluate(
    (el) =>
      new Promise<void>(function check(resolve) {
        if (el === document.activeElement) resolve();
        else requestAnimationFrame(() => check(resolve));
      }),
  );

async function openPost(path: string) {
  await page.goto(postUrl(path));
  await bodyEditor().waitFor();
}

/** 내용 칸에 쓰고 적용해 폼이 닫힐 때까지 기다린다. */
async function applyText(name: string, field: string, text: string) {
  await form(name).getByRole("textbox", { name: field }).fill(text);
  await form(name).getByRole("button", { name: "적용" }).click();
  await form(name).waitFor({ state: "detached" });
}

/** 임시저장하고 저장한 커밋으로 글 화면이 다시 열릴 때까지 기다린다. */
async function saveAndReopen() {
  const before = page.url();
  await page.getByRole("button", { name: "임시저장" }).click();
  await page.waitForURL((url) => url.href !== before && url.searchParams.has("saved"));
  await page.getByText(/^임시저장했어요\./).waitFor();
}

describe("본문 각주·출처", () => {
  test("각주는 문장 안 그 자리에 원문 번호로, 출처는 ‘출처’·연결한 각주 번호·내용으로 보이고 컴포넌트 이름은 보이지 않는다", async () => {
    await openPost(POSTS.shown);
    const sentence = bodyEditor().locator("p", { hasText: "진료를 쉬어요" });

    // 각주는 문장을 나누지 않고 그 문장 안에 원문 번호 그대로 위첨자로 있다.
    expect(await sentence.getByRole("button", { name: "각주 1", exact: true }).innerText()).toBe("1");
    expect(await sentence.getByRole("button", { name: "각주 3", exact: true }).innerText()).toBe("3");
    expect(await footnote(3).locator("sup").innerText()).toBe("3");
    // 문단 안에 블록을 두지 않아 번호가 문장과 같은 줄에 누를 수 있는 크기로 보인다.
    const box = async (locator: Locator) => (await locator.boundingBox())!;
    for (const id of [1, 3]) {
      const number = await box(footnote(id));
      expect(number.height).toBeGreaterThan(0);
      expect(Math.abs(number.y - (await box(sentence.getByText("진료를 쉬어요"))).y)).toBeLessThan(20);
    }
    expect(await sentence.innerText()).toMatch(/진료를 쉬어요\s*1\s*\. 토요일은 오전만 봐요\s*3\s*\./);

    expect((await ref().innerText()).split(/\s+/)).toEqual(["출처", "1", "병원", "공지"]);
    const body = await bodyEditor().innerText();
    expect(body).not.toContain("Footnote");
    expect(body).not.toContain("FootnoteRef");
    // 고르기 전에는 각주 내용과 ‘수정’을 보이지 않는다.
    expect(body).not.toContain("공휴일");
    expect(await bodyEditor().getByRole("button", { name: "수정" }).count()).toBe(0);
  });

  test("본문의 각주 3을 골라 내용을 고쳐 저장하면 그 각주의 내용만 바뀌고 번호·출처 연결·문장 안 위치는 그대로다", async () => {
    const original = app.file(POSTS.footnote)!;
    await openPost(POSTS.footnote);

    await footnote(3).click();
    expect(await footnote(3).getAttribute("aria-pressed")).toBe("true");
    expect(await actions("각주 3").innerText()).toContain("오후 휴진");
    // 고른 각주 하나에만 내용과 ‘수정’이 보인다.
    expect(await bodyEditor().getByRole("group").count()).toBe(1);
    // 내용과 ‘수정’은 문장 안 번호 오른쪽이 아니라 바로 아래에 보이고, 번호는 문장 줄에 남는다.
    const number = (await footnote(3).boundingBox())!;
    const group = (await actions("각주 3").boundingBox())!;
    expect(group.y).toBeGreaterThanOrEqual(number.y + number.height);
    expect(Math.abs(group.x - number.x)).toBeLessThan(4);
    const sentence = (await bodyEditor().getByText("진료를 쉬어요").boundingBox())!;
    expect(Math.abs(number.y - sentence.y)).toBeLessThan(20);

    await editButton("각주 3").click();
    expect(await form("각주 3 수정").getByRole("textbox", { name: "각주 내용" }).inputValue()).toBe("오후 휴진");
    await applyText("각주 3 수정", "각주 내용", "오후는 쉬어요");
    await unsaved("본문").waitFor();
    // 다시 그린 본문에서도 고친 각주가 골라져 있고 초점을 돌려받는다.
    await waitFocused(footnote(3));
    expect(await actions("각주 3").innerText()).toContain("오후는 쉬어요");

    await saveAndReopen();
    expect(newCommits()).toBe(1);
    expect(app.file(POSTS.footnote)).toBe(original.replace(">오후 휴진<", ">오후는 쉬어요<"));
    expect(await footnote(3).innerText()).toBe("3");
  });

  test("본문의 출처를 골라 내용을 고쳐 저장하면 그 출처의 내용만 바뀌고 연결한 각주 번호는 그대로다", async () => {
    const original = app.file(POSTS.ref)!;
    await openPost(POSTS.ref);

    await ref().click();
    await editButton("각주 1 출처").click();
    expect(await form("각주 1 출처 수정").getByRole("textbox", { name: "출처 내용" }).inputValue()).toBe("병원 공지");
    await applyText("각주 1 출처 수정", "출처 내용", "병원 공지사항");
    await unsaved("본문").waitFor();
    await waitFocused(bodyEditor().getByRole("button", { name: "각주 1 출처, 병원 공지사항" }));

    await saveAndReopen();
    expect(newCommits()).toBe(1);
    expect(app.file(POSTS.ref)).toBe(original.replace("  병원 공지\n", "  병원 공지사항\n"));
  });

  test("키보드로 각주를 골라 폼을 열고 Esc로 닫으면 초점이 그 각주로 돌아오고 원문과 미저장 상태가 그대로다", async () => {
    await openPost(POSTS.keyboard);
    const before = await bodyEditor().innerText();
    await bodyEditor().focus();

    await page.keyboard.press("Tab");
    expect(await isFocused(footnote(1))).toBe(true);
    await page.keyboard.press("Enter");
    await actions("각주 1").waitFor();
    expect(await actions("각주 1").innerText()).toContain("공휴일");
    await page.keyboard.press("Tab");
    expect(await focusedText()).toBe("수정");
    await page.keyboard.press("Enter");
    await form("각주 1 수정").waitFor();
    expect(await isFocused(form("각주 1 수정").getByRole("textbox"))).toBe(true);
    await page.keyboard.press("Escape");
    await form("각주 1 수정").waitFor({ state: "detached" });
    await waitFocused(footnote(1));

    expect(await footnote(1).getAttribute("aria-pressed")).toBe("true");

    // Space로 선택을 풀면 본문이 연 그대로다.
    await page.keyboard.press("Space");
    await actions("각주 1").waitFor({ state: "detached" });
    expect(await bodyEditor().innerText()).toBe(before);
    await page.waitForTimeout(300);
    expect(await anyUnsaved().count()).toBe(0);
    expect(newCommits()).toBe(0);
  });

  test("번호가 겹쳐 폼으로 고칠 수 없는 각주는 숨기지 않고 이유와 원문 편집 안내를 보이며 ‘수정’을 두지 않는다", async () => {
    await openPost(POSTS.limited);
    const reason = "폼으로 고칠 수 없어요. 같은 번호의 각주가 여러 개예요. 원문 편집에서 직접 고쳐 주세요.";

    expect(await bodyEditor().getByText(reason).count()).toBe(2);
    // 지금처럼 이름과 속성을 그대로 보인다.
    expect(await bodyEditor().innerText()).toContain("Footnote");
    expect(
      await bodyEditor()
        .getByRole("button", { name: /^각주 1/ })
        .count(),
    ).toBe(0);
    expect(await bodyEditor().getByRole("button", { name: "수정" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "원문 편집", exact: true }).isEnabled()).toBe(true);
  });
});
