import type { BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { startApp, type App } from "./app";

const REPO = "es-kimo/image-manage";
const METADATA = {
  title: { type: "string", label: "제목", required: true },
  "other.status": { type: "select", label: "상태", options: ["ready", "draft"] },
};
const CONFIG = {
  branch: "main",
  syntax: { gfm: false, math: false },
  collections: [
    {
      name: "게시판",
      path: "content/게시판/{slug}/page.mdx",
      metadata: METADATA,
      components: ["Image"],
      editor: "wysiwyg",
    },
    { name: "원문", path: "content/원문/{slug}/page.mdx", metadata: METADATA, components: ["Image"], editor: "source" },
  ],
};
const source = (title: string, extra = "") => `import image1 from "./1.png";

export const metadata = {
  title: '${title}',
  other: { status: 'draft' },
};

# ${title}

진료 시간을 안내해요.

<Image src={image1} alt="병원 입구" />

<Image src={image1} alt="입구 다시" />
${extra}`;
// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** 글 폴더에 이미 있는 이미지. 교체·제거가 지우거나 덮어쓰지 않는지 본다. */
const OLD_IMAGE = "기존 이미지";
const BLOCKED = "열려 있는 폼을 먼저 적용하거나 취소해 주세요.";

const POSTS = {
  body: "content/게시판/일반/page.mdx",
  source: "content/원문/원문/page.mdx",
};
const dir = (path: string) => path.slice(0, path.lastIndexOf("/"));

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    { path: POSTS.body, content: source("일반 글") },
    { path: `${dir(POSTS.body)}/1.png`, content: OLD_IMAGE },
    // 원문 글에는 문단 안 이미지를 하나 더 둔다. 옮길 수 없는 이미지다.
    { path: POSTS.source, content: source("원문 글", '\n문단 안 <Image src={image1} alt="문단 안" /> 이에요.\n') },
    { path: `${dir(POSTS.source)}/1.png`, content: OLD_IMAGE },
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
const sourceText = () => sourceEditor().innerText();
const replaceForm = () => page.getByRole("form", { name: "이미지 교체" });
const altInput = (form: Locator) => form.getByRole("textbox", { name: "대체 텍스트" });
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);
const insertList = (count: number) => page.getByText(`삽입 항목 ${count}개`).filter({ visible: true });
/** `n`번째 이미지를 고르고, 그 이미지를 다루는 버튼 묶음을 돌려준다. */
async function selectImage(n: number) {
  await page.getByRole("button", { name: "이미지 선택" }).filter({ visible: true }).nth(n).click();
  return page.getByRole("group", { name: "이미지 관리" }).filter({ visible: true });
}
const isFocused = (locator: Locator) => locator.evaluate((el) => el === document.activeElement);
const saveButton = () => page.getByRole("button", { name: "임시저장" });

/** `button`을 눌러 연 파일 선택 창에서 PNG를 고른다. */
async function chooseImage(button: Locator) {
  const chooser = page.waitForEvent("filechooser");
  await button.click();
  await (await chooser).setFiles({ name: "새 사진.png", mimeType: "image/png", buffer: PNG });
}

/** 임시저장하고 저장한 커밋으로 글 화면이 다시 열릴 때까지 기다린다. */
async function saveAndReopen() {
  const before = page.url();
  await saveButton().click();
  await page.waitForURL((url) => url.href !== before && url.searchParams.has("saved"));
  await page.getByText(/^임시저장했어요\./).waitFor();
}

describe("일반 편집 이미지 관리", () => {
  test("고른 이미지를 앞으로 옮기고 새 파일로 교체해 저장하면 그 자리만 바뀌고 기존 이미지 파일은 그대로다", async () => {
    const path = POSTS.body;
    await page.goto(postUrl(path));
    await bodyEditor().waitFor();
    await insertList(2).click();

    // 맨 뒤 블록의 이미지는 뒤로 옮길 수 없다.
    const actions = await selectImage(1);
    expect(await actions.getByRole("button").allInnerTexts()).toEqual(["교체", "제거", "앞으로", "뒤로"]);
    expect(await actions.getByRole("button", { name: "뒤로" }).isDisabled()).toBe(true);
    await actions.getByRole("button", { name: "앞으로" }).click();
    await unsaved("본문").waitFor();
    // 옮긴 이미지가 계속 골라져 있고 누른 버튼에 초점이 남는다.
    expect(await actions.getByRole("button", { name: "뒤로" }).isEnabled()).toBe(true);
    expect(await isFocused(actions.getByRole("button", { name: "앞으로" }))).toBe(true);

    await chooseImage(actions.getByRole("button", { name: "교체" }));
    await replaceForm().waitFor();
    expect(await altInput(replaceForm()).inputValue()).toBe("입구 다시");
    await replaceForm().getByText("이 자리의 이미지(1.png)만 새 이미지(2.png)로 바꿔요.", { exact: false }).waitFor();
    // 적용하지 않은 교체 폼이 있으면 저장하지 않는다.
    await saveButton().click();
    await page.getByText(BLOCKED).waitFor();
    expect(newCommits()).toBe(0);
    await replaceForm().getByRole("button", { name: "적용" }).click();
    await replaceForm().waitFor({ state: "detached" });
    await unsaved("본문, 첨부 이미지").waitFor();
    await saveAndReopen();

    expect(newCommits()).toBe(1);
    const saved = app.file(path)!;
    expect(saved).toContain('import image1 from "./1.png";');
    expect(saved).toContain('import image2 from "./2.png";');
    const replaced = saved.indexOf('<Image src={image2} alt="입구 다시" />');
    expect(replaced).toBeGreaterThan(saved.indexOf("진료 시간을 안내해요."));
    expect(replaced).toBeLessThan(saved.indexOf('<Image src={image1} alt="병원 입구" />'));
    expect(app.file(`${dir(path)}/1.png`)).toBe(OLD_IMAGE);
    expect(app.file(`${dir(path)}/2.png`)).toBeDefined();
  });
});

describe("원문 편집 이미지 관리", () => {
  test("교체를 취소하면 원문과 첨부가 그대로이고, 제거하면 그 태그만 빠지며, 문단 안 이미지는 옮길 수 없는 이유를 보인다", async () => {
    const path = POSTS.source;
    const original = app.file(path)!;
    await page.goto(postUrl(path));
    await sourceEditor().waitFor();
    const before = await sourceText();
    await insertList(3).click();

    const inline = await selectImage(2);
    await inline
      .getByText("옮길 수 없어요. 문단 안에 글자와 함께 있는 이미지예요. 원문에서 직접 옮겨 주세요.")
      .waitFor();
    expect(await inline.getByRole("button", { name: "앞으로" }).isDisabled()).toBe(true);
    expect(await inline.getByRole("button", { name: "뒤로" }).isDisabled()).toBe(true);

    const actions = await selectImage(0);
    await chooseImage(actions.getByRole("button", { name: "교체" }));
    await replaceForm().waitFor();
    expect(await altInput(replaceForm()).inputValue()).toBe("병원 입구");
    await page.keyboard.press("Escape");
    await replaceForm().waitFor({ state: "detached" });
    expect(await sourceText()).toBe(before);
    expect(await page.getByText(/저장하지 않은 변경이 있어요/).count()).toBe(0);

    await actions.getByRole("button", { name: "제거" }).click();
    await insertList(2).waitFor();
    const removed = await sourceText();
    expect(removed).not.toContain('alt="병원 입구"');
    expect(removed).toContain('import image1 from "./1.png";');
    await saveAndReopen();

    expect(newCommits()).toBe(1);
    expect(app.file(path)).toBe(original.replace('<Image src={image1} alt="병원 입구" />\n\n', ""));
    expect(app.file(`${dir(path)}/1.png`)).toBe(OLD_IMAGE);
    expect(app.file(`${dir(path)}/2.png`)).toBeUndefined();
  });
});
