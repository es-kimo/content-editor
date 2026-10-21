import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { MODE_SWITCH_MESSAGES } from "@/lib/content/mode-switch";
import { FIELD_PREFIX } from "@/lib/metadata-form";

import { startApp, type App } from "./app";

const REPO = "es-kimo/mode-switch";
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

진료 시간을 안내해요.
`;

/** 테스트마다 다른 글을 열어 앞 테스트의 저장이 섞이지 않게 한다. */
const POSTS = {
  roundTrip: "content/게시판/왕복/page.mdx",
  lossy: "content/게시판/담지-못함/page.mdx",
  structure: "content/게시판/구조/page.mdx",
};

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    ...Object.entries(POSTS).map(([name, path]) => ({ path, content: source(`${name} 글`) })),
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
const bodyEditor = () => page.locator(".body-editor-content");
const sourceEditor = () => page.locator(".cm-content");
const titleInput = () => page.locator(`input[name="${FIELD_PREFIX}title"]`);
const modeButton = (name: "일반 편집" | "원문 편집") => page.getByRole("button", { name, exact: true });
const pressed = (name: "일반 편집" | "원문 편집") => modeButton(name).getAttribute("aria-pressed");
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);

async function openPost(path: string) {
  await page.goto(postUrl(path));
  await bodyEditor().waitFor();
}

/** 원문 편집기의 `key` 자리(맨 앞이나 끝)에 커서를 두고 글자를 친다. */
async function typeInSource(key: "Control+Home" | "Control+End", text: string) {
  await sourceEditor().click();
  await page.keyboard.press(key);
  await page.keyboard.type(text);
}

describe("모드 전환", () => {
  test("일반 편집에서 고친 제목·본문이 원문 편집으로, 원문 편집에서 고친 본문이 다시 일반 편집으로 이어지고 보이는 모드의 입력을 저장한다", async () => {
    const path = POSTS.roundTrip;
    await openPost(path);
    await titleInput().fill("왕복 글 (수정)");
    await bodyEditor().getByText("진료 시간을 안내해요.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" 일반 편집에서 더했어요.");
    await unsaved("글 설정, 본문").waitFor();

    await modeButton("원문 편집").click();
    expect(await pressed("원문 편집")).toBe("true");
    const carried = await sourceEditor().innerText();
    expect(carried).toContain("title: '왕복 글 (수정)'");
    expect(carried).toContain("진료 시간을 안내해요. 일반 편집에서 더했어요.");
    await unsaved("원문 편집").waitFor();

    await typeInSource("Control+End", "\n원문에서 더한 문단.\n");
    await modeButton("일반 편집").click();
    expect(await pressed("일반 편집")).toBe("true");
    await bodyEditor().getByText("원문에서 더한 문단.").waitFor();
    expect(await titleInput().inputValue()).toBe("왕복 글 (수정)");
    await unsaved("글 설정, 본문").waitFor();
    expect(newCommits()).toBe(0);

    await page.getByRole("button", { name: "임시저장" }).click();
    await page.getByText(/^임시저장했어요\./).waitFor();
    expect(newCommits()).toBe(1);
    const saved = app.file(path)!;
    expect(saved).toContain("title: '왕복 글 (수정)'");
    expect(saved).toContain("진료 시간을 안내해요. 일반 편집에서 더했어요.");
    expect(saved).toContain("원문에서 더한 문단.");
  });

  test("원문 편집에서 일반 편집이 담을 수 없게 고치면 이유를 보이고 바꾸지 않으며, 두 모드의 입력은 그대로다", async () => {
    await openPost(POSTS.lossy);
    await titleInput().fill("담지 못함 글 (수정)");
    await modeButton("원문 편집").click();
    await typeInSource("Control+Home", "export const x = 1;\n\n");

    await modeButton("일반 편집").click();
    await page.getByText(MODE_SWITCH_MESSAGES.lossy).waitFor();
    expect(await pressed("원문 편집")).toBe("true");
    expect(await sourceEditor().innerText()).toContain("export const x = 1;");
    expect(await titleInput().inputValue()).toBe("담지 못함 글 (수정)");
    await unsaved("원문 편집").waitFor();
  });

  test("원문 편집에서 고친 본문을 일반 편집이 그대로 읽지 못하면 원문 편집으로 돌아오고, 일반 편집은 바꾸기 전 입력으로 다시 열린다", async () => {
    await openPost(POSTS.structure);
    await titleInput().fill("구조 글 (수정)");
    await modeButton("원문 편집").click();
    // 일반 편집기는 백슬래시 줄바꿈을 다른 표기로 바꿔 본문 구조가 달라진다.
    await typeInSource("Control+End", "\n하나\\\n둘\n");

    await modeButton("일반 편집").click();
    await page.getByText(MODE_SWITCH_MESSAGES.structure).waitFor();
    expect(await pressed("원문 편집")).toBe("true");
    expect(await sourceEditor().innerText()).toContain("하나\\");
    expect(await titleInput().inputValue()).toBe("구조 글 (수정)");
    expect(await bodyEditor().innerText()).not.toContain("하나");
  });
});
