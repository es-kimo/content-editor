import type { BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { startApp, type App } from "./app";

const REPO = "es-kimo/body-photo-actions";
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
  ],
};
const source = (title: string, body: string) => `import image1 from "./1.png";

export const metadata = {
  title: '${title}',
  other: { status: 'draft' },
};

${body}
`;
// 1×1 PNG. 레포의 1.png가 실제로 그려지고, 저장한 뒤에도 그대로인지 본다.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_TEXT = new TextDecoder().decode(PNG);

const POSTS = {
  twice: "content/게시판/두-번/page.mdx",
  manage: "content/게시판/관리/page.mdx",
  html: "content/게시판/태그/page.mdx",
  typing: "content/게시판/고치기/page.mdx",
};
const BODIES = {
  twice:
    '# 두 번\n\n진료 시간을 안내해요.\n\n<Image src={image1} alt="병원 입구" />\n\n<Image src={image1} alt="입구 다시" />',
  // 맨 앞 블록이 사진이라 ‘앞으로’가 막힌다.
  manage: '<Image src={image1} alt="맨 앞" />\n\n진료 시간을 안내해요.\n\n<Image src={image1} alt="뒤 사진" />',
  // 편집기는 <p>·<br />를 JSX 요소로 그리지 않는다. 그 뒤에 같은 태그의 사진이 두 번 온다.
  html: '<p>진료 안내</p>\n\n<Image src={image1} alt="같음" />\n\n줄<br />바꿈\n\n<Image src={image1} alt="같음" />',
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
    { path: POSTS.twice, content: source("두 번", BODIES.twice) },
    { path: `${dir(POSTS.twice)}/1.png`, content: PNG },
    { path: POSTS.manage, content: source("관리", BODIES.manage) },
    { path: `${dir(POSTS.manage)}/1.png`, content: PNG },
    { path: POSTS.html, content: source("태그", BODIES.html) },
    { path: `${dir(POSTS.html)}/1.png`, content: PNG },
    { path: POSTS.typing, content: source("고치기", BODIES.twice) },
    { path: `${dir(POSTS.typing)}/1.png`, content: PNG },
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
const photo = (alt: string) => bodyEditor().getByRole("button", { name: `사진, 대체 텍스트: ${alt}` });
const actions = () => bodyEditor().getByRole("group", { name: "이미지 관리" });
const action = (name: string) => actions().getByRole("button", { name, exact: true });
const editForm = () => page.getByRole("form", { name: "이미지 수정" });
const replaceForm = () => page.getByRole("form", { name: "이미지 교체" });
const altInput = (form: Locator) => form.getByRole("textbox", { name: "대체 텍스트" });
const unsavedNotice = () => page.getByText(/저장하지 않은 변경이 있어요/);
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);
const isFocused = (locator: Locator) => locator.evaluate((el) => el === document.activeElement);
const focusedText = () => page.evaluate(() => document.activeElement?.textContent ?? "");
/** 초점이 `locator`에 올 때까지 기다린다. 폼을 닫거나 옮기면 편집기가 다시 그린 뒤에 초점이 간다. */
const waitFocused = (locator: Locator) =>
  locator.evaluate(
    (el) =>
      new Promise<void>(function check(resolve) {
        if (el === document.activeElement) resolve();
        else requestAnimationFrame(() => check(resolve));
      }),
  );

/** 본문 사진이 모두 그려질 때까지 기다린다. */
async function openPost(path: string) {
  await page.goto(postUrl(path));
  await bodyEditor().waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll<HTMLImageElement>(".body-editor-content img")];
    return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
}

/** `button`을 눌러 연 파일 선택 창에서 PNG를 고른다. */
async function chooseImage(button: Locator) {
  const chooser = page.waitForEvent("filechooser");
  await button.click();
  await (await chooser).setFiles({ name: "새 사진.png", mimeType: "image/png", buffer: PNG });
}

/** 임시저장하고 저장한 커밋으로 글 화면이 다시 열릴 때까지 기다린다. */
async function saveAndReopen() {
  const before = page.url();
  await page.getByRole("button", { name: "임시저장" }).click();
  await page.waitForURL((url) => url.href !== before && url.searchParams.has("saved"));
  await page.getByText(/^임시저장했어요\./).waitFor();
}

describe("본문 사진 조작", () => {
  test("같은 image1을 두 곳에서 쓰는 글에서 두 번째 사진의 대체 텍스트를 고쳐 저장하면 두 번째 태그만 바뀐다", async () => {
    const original = app.file(POSTS.twice)!;
    await openPost(POSTS.twice);

    await photo("입구 다시").click();
    expect(await actions().getByRole("button").allInnerTexts()).toEqual(["수정", "교체", "제거", "앞으로", "뒤로"]);
    // 고른 사진 하나에만 조작 버튼이 보인다.
    expect(await actions().count()).toBe(1);
    expect(await photo("입구 다시").getAttribute("aria-pressed")).toBe("true");
    expect(await photo("병원 입구").getAttribute("aria-pressed")).toBe("false");

    await action("수정").click();
    await editForm().waitFor();
    expect(await altInput(editForm()).inputValue()).toBe("입구 다시");
    await altInput(editForm()).fill("뒷문");
    await editForm().getByRole("button", { name: "적용" }).click();
    await editForm().waitFor({ state: "detached" });
    await unsaved("본문").waitFor();
    // 다시 그린 본문에서도 고친 그 사진이 골라져 있고 초점을 돌려받는다.
    await waitFocused(photo("뒷문"));
    expect(await photo("뒷문").getAttribute("aria-pressed")).toBe("true");

    await saveAndReopen();
    expect(newCommits()).toBe(1);
    expect(app.file(POSTS.twice)).toBe(original.replace('alt="입구 다시"', 'alt="뒷문"'));
    expect(app.file(`${dir(POSTS.twice)}/1.png`)).toBe(PNG_TEXT);
  });

  test("본문에서 고른 사진의 뒤로·앞으로·교체·제거는 그 자리만 바꾸고, 맨 앞 블록의 ‘앞으로’는 막혀 있다", async () => {
    const original = app.file(POSTS.manage)!;
    await openPost(POSTS.manage);
    /** 사진 `alt`가 본문 문단보다 뒤에 그려졌는지. */
    const afterParagraph = async (alt: string) =>
      photo(alt).evaluate(
        (el, paragraph) => Boolean(el.compareDocumentPosition(paragraph!) & Node.DOCUMENT_POSITION_PRECEDING),
        await bodyEditor().getByText("진료 시간을 안내해요.").elementHandle(),
      );

    await photo("맨 앞").click();
    expect(await action("앞으로").isDisabled()).toBe(true);
    await action("뒤로").click();
    await unsaved("본문").waitFor();
    // 옮긴 사진이 계속 골라져 있고 누른 버튼에 초점이 남는다.
    await waitFocused(action("뒤로"));
    expect(await focusedText()).toBe("뒤로");
    expect(await photo("맨 앞").getAttribute("aria-pressed")).toBe("true");
    expect(await afterParagraph("맨 앞")).toBe(true);

    await photo("뒤 사진").click();
    expect(await actions().count()).toBe(1);
    expect(await action("뒤로").isDisabled()).toBe(true);
    await action("앞으로").click();
    await waitFocused(action("앞으로"));
    expect(await focusedText()).toBe("앞으로");
    expect(await photo("뒤 사진").getAttribute("aria-pressed")).toBe("true");
    expect(await afterParagraph("뒤 사진")).toBe(true);

    await chooseImage(action("교체"));
    await replaceForm().waitFor();
    expect(await altInput(replaceForm()).inputValue()).toBe("뒤 사진");
    await replaceForm().getByText("이 자리의 이미지(1.png)만 새 이미지(2.png)로 바꿔요.", { exact: false }).waitFor();
    await replaceForm().getByRole("button", { name: "적용" }).click();
    await replaceForm().waitFor({ state: "detached" });
    await unsaved("본문, 첨부 이미지").waitFor();
    await waitFocused(photo("뒤 사진"));

    await photo("맨 앞").click();
    await action("제거").click();
    await photo("맨 앞").waitFor({ state: "detached" });
    // 지운 사진의 바로 앞 블록인 사진으로 초점이 간다.
    await waitFocused(photo("뒤 사진"));

    await saveAndReopen();
    expect(newCommits()).toBe(1);
    expect(app.file(POSTS.manage)).toBe(
      original
        .replace('import image1 from "./1.png";', 'import image1 from "./1.png";\nimport image2 from "./2.png";')
        .replace(BODIES.manage, '진료 시간을 안내해요.\n\n<Image src={image2} alt="뒤 사진" />'),
    );
    expect(app.file(`${dir(POSTS.manage)}/1.png`)).toBe(PNG_TEXT);
    expect(app.file(`${dir(POSTS.manage)}/2.png`)).toBeDefined();
  });

  test("<p>·<br /> 뒤에 같은 태그의 사진이 두 번 오는 글에서 두 번째 사진을 고쳐도 두 번째 태그만 바뀐다", async () => {
    const original = app.file(POSTS.html)!;
    await openPost(POSTS.html);
    const same = (index: number) => photo("같음").nth(index);

    await same(0).click();
    await actions().waitFor();
    await same(1).click();
    expect(await actions().getByRole("button").allInnerTexts()).toEqual(["수정", "교체", "제거", "앞으로", "뒤로"]);
    await action("수정").click();
    await editForm().waitFor();
    await altInput(editForm()).fill("둘째");
    await editForm().getByRole("button", { name: "적용" }).click();
    await editForm().waitFor({ state: "detached" });
    await waitFocused(photo("둘째"));

    await saveAndReopen();
    const second = original.lastIndexOf('alt="같음"');
    expect(app.file(POSTS.html)).toBe(
      `${original.slice(0, second)}alt="둘째"${original.slice(second + 'alt="같음"'.length)}`,
    );
  });

  test("사진을 고른 뒤 본문을 고치면 선택이 풀려 고를 때의 자리로 다른 이미지를 고치지 않는다", async () => {
    await openPost(POSTS.typing);

    await photo("입구 다시").click();
    await actions().waitFor();
    await bodyEditor().getByText("진료 시간을 안내해요.").click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await unsaved("본문").waitFor();
    expect(await actions().count()).toBe(0);
    expect(await photo("입구 다시").getAttribute("aria-pressed")).toBe("false");
  });

  test("키보드만으로 사진을 골라 대체 텍스트 폼을 열고 취소하면 초점이 그 사진으로 돌아오고, 같은 값으로 적용해도 미저장이 아니다", async () => {
    await openPost(POSTS.twice);
    await bodyEditor().focus();

    await page.keyboard.press("Tab");
    expect(await isFocused(photo("병원 입구"))).toBe(true);
    await page.keyboard.press("Enter");
    await actions().waitFor();
    await page.keyboard.press("Tab");
    expect(await focusedText()).toBe("수정");
    await page.keyboard.press("Enter");
    await editForm().waitFor();
    expect(await isFocused(altInput(editForm()))).toBe(true);
    await page.keyboard.press("Escape");
    await editForm().waitFor({ state: "detached" });
    await waitFocused(photo("병원 입구"));
    expect(await bodyEditor().innerText()).toContain("진료 시간을 안내해요.");
    expect(await unsavedNotice().count()).toBe(0);

    // Space로도 고르고 다시 눌러 놓는다.
    await page.keyboard.press("Space");
    expect(await actions().count()).toBe(0);
    await page.keyboard.press("Space");
    await actions().waitFor();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await editForm().waitFor();
    await page.keyboard.press("Enter");
    await editForm().waitFor({ state: "detached" });
    await waitFocused(photo("병원 입구"));
    await page.waitForTimeout(300);
    expect(await unsavedNotice().count()).toBe(0);
    expect(newCommits()).toBe(0);
  });

  test("폭 360px에서 고른 사진과 조작 버튼이 가로로 넘치지 않는다", async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openPost(POSTS.twice);

    await photo("병원 입구").click();
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
    for (const button of await actions().getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }
  });
});
