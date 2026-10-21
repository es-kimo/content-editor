import type { BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { FIELD_PREFIX } from "@/lib/metadata-form";

import { startApp, type App } from "./app";

const REPO = "es-kimo/body-image";
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
const source = (title: string, images: string) => `import image1 from "./1.png";
import image2 from "./2.png";

export const metadata = {
  title: '${title}',
  other: { status: 'draft' },
};

# ${title}

진료 시간을 안내해요.

${images}
`;
// 1×1 PNG. 레포의 1.png와 붙여 넣는 사진이 모두 실제로 그려지는지 본다.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const POSTS = {
  saved: "content/게시판/저장된-사진/page.mdx",
  paste: "content/게시판/붙여넣기/page.mdx",
  missing: "content/게시판/없는-사진/page.mdx",
};
const dir = (path: string) => path.slice(0, path.lastIndexOf("/"));

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  const twoPhotos = '<Image src={image1} alt="병원 입구" />\n\n<Image src={image1} alt="입구 다시" />';
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    { path: POSTS.saved, content: source("저장된 사진", twoPhotos) },
    { path: `${dir(POSTS.saved)}/1.png`, content: PNG },
    { path: POSTS.paste, content: source("붙여넣기", '<Image src={image1} alt="병원 입구" />') },
    { path: `${dir(POSTS.paste)}/1.png`, content: PNG },
    // 2.png는 import만 하고 레포에 두지 않는다.
    { path: POSTS.missing, content: source("없는 사진", '<Image src={image2} alt="없는 사진" />') },
    { path: `${dir(POSTS.missing)}/1.png`, content: PNG },
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
// 새 글은 본문이 비어 있어 편집기가 같은 클래스의 자리 표시 문구를 함께 그린다.
const bodyEditor = () => page.locator(".body-editor-content[contenteditable='true']");
const photos = () => bodyEditor().locator("img");
const imageForm = () => page.getByRole("form", { name: "이미지 넣기" });
const unsavedNotice = () => page.getByText(/저장하지 않은 변경이 있어요/);
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);

/** 본문 사진의 대체 텍스트와 주소. 다 그려질 때까지 기다린 뒤 읽는다. */
async function loadedPhotos() {
  await page.waitForFunction(
    () => {
      const images = [...document.querySelectorAll<HTMLImageElement>(".body-editor-content img")];
      return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0);
    },
    undefined,
    { timeout: 10_000 },
  );
  return photos().evaluateAll((images) =>
    (images as HTMLImageElement[]).map((image) => ({ alt: image.alt, src: image.src, width: image.naturalWidth })),
  );
}

/** 레포 이미지 라우트 주소가 가리키는 글과 import 경로. */
const repoImage = (src: string) => {
  const url = new URL(src);
  return { route: url.pathname, post: url.searchParams.get("post"), src: url.searchParams.get("src") };
};

/** 붙여넣기로 PNG 파일 하나를 본문에 준다. */
async function pastePhoto() {
  await bodyEditor().evaluate(
    (element, bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], "붙인 사진.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    },
    [...PNG],
  );
}

async function insertPhoto(alt: string) {
  await pastePhoto();
  await imageForm().getByRole("textbox", { name: "대체 텍스트" }).fill(alt);
  await imageForm().getByRole("button", { name: "적용" }).click();
  await imageForm().waitFor({ state: "detached" });
}

/** 임시저장하고 저장한 커밋으로 글 화면이 다시 열릴 때까지 기다린다. */
async function saveAndReopen() {
  const before = page.url();
  await page.getByRole("button", { name: "임시저장" }).click();
  await page.waitForURL(
    (url) => url.href !== before && url.pathname.endsWith("/post") && url.searchParams.has("saved"),
  );
  await page.getByText(/^임시저장했어요\./).waitFor();
  await bodyEditor().waitFor();
}

/** `text` 문단 끝에 커서를 둔다. 붙여 넣은 사진은 그 문단 다음에 들어간다. */
async function cursorAfter(text: string) {
  await bodyEditor().getByText(text).click();
  await page.keyboard.press("End");
}

/** 본문에서 `second`가 `first`보다 뒤에 있는지. */
const isAfter = async (first: Locator, second: Locator) =>
  first.evaluate(
    (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
    await second.elementHandle(),
  );

describe("일반 편집 본문 사진", () => {
  test("저장된 글의 이미지 두 곳을 각 대체 텍스트로 레포의 1.png 사진으로 그리고, 보기만 해서는 미저장 표시와 커밋이 생기지 않는다", async () => {
    await page.goto(postUrl(POSTS.saved));
    await bodyEditor().waitFor();

    const shown = await loadedPhotos();
    expect(shown.map(({ alt }) => alt)).toEqual(["병원 입구", "입구 다시"]);
    for (const { src, width } of shown) {
      expect(width).toBeGreaterThan(0);
      expect(repoImage(src)).toEqual({ route: `/repos/${REPO}/image`, post: POSTS.saved, src: "./1.png" });
    }
    // 사진으로 그린 이미지는 컴포넌트 이름을 보이지 않는다.
    expect(await bodyEditor().getByText("Image", { exact: true }).count()).toBe(0);

    await page.waitForTimeout(500);
    expect(await unsavedNotice().count()).toBe(0);
    expect(newCommits()).toBe(0);
  });

  test("기존 글에 붙여 넣은 사진을 폼을 적용하면 저장 전에 넣은 자리에 보이고, 임시저장 후 다시 열어도 같은 자리에 보인다", async () => {
    await page.goto(postUrl(POSTS.paste));
    await bodyEditor().waitFor();
    await cursorAfter("진료 시간을 안내해요.");
    await insertPhoto("새 진료실");
    await unsaved("본문, 첨부 이미지").waitFor();

    const before = await loadedPhotos();
    expect(before.map(({ alt }) => alt)).toEqual(["새 진료실", "병원 입구"]);
    expect(before[0]!.src).toMatch(/^blob:/);
    expect(await isAfter(bodyEditor().getByText("진료 시간을 안내해요."), photos().first())).toBe(true);
    expect(newCommits()).toBe(0);

    await saveAndReopen();
    expect(newCommits()).toBe(1);
    const after = await loadedPhotos();
    expect(after.map(({ alt }) => alt)).toEqual(["새 진료실", "병원 입구"]);
    expect(repoImage(after[0]!.src)).toMatchObject({ post: POSTS.paste, src: "./3.png" });
    expect(app.file(`${dir(POSTS.paste)}/3.png`)).toBeDefined();
  });

  test("새 글에 붙여 넣은 사진을 폼을 적용하면 저장 전에 보이고, 임시저장 후 열린 글에서도 같은 자리에 보인다", async () => {
    await page.goto(`${app.origin}/repos/${REPO}/new?${new URLSearchParams({ collection: "게시판" })}`);
    await bodyEditor().waitFor();
    await page.locator(`input[name="${FIELD_PREFIX}title"]`).fill("새 사진 글");
    await bodyEditor().click();
    await page.keyboard.type("첫 문단이에요.");
    await page.keyboard.press("Enter");
    await insertPhoto("새 글 사진");

    const before = await loadedPhotos();
    expect(before.map(({ alt }) => alt)).toEqual(["새 글 사진"]);
    expect(before[0]!.src).toMatch(/^blob:/);
    expect(await isAfter(bodyEditor().getByText("첫 문단이에요."), photos().first())).toBe(true);
    expect(newCommits()).toBe(0);

    await saveAndReopen();
    expect(newCommits()).toBe(1);
    const after = await loadedPhotos();
    expect(after.map(({ alt }) => alt)).toEqual(["새 글 사진"]);
    expect(repoImage(after[0]!.src)).toMatchObject({ post: "content/게시판/새 사진 글/page.mdx", src: "./1.png" });
    expect(await isAfter(bodyEditor().getByText("첫 문단이에요."), photos().first())).toBe(true);
  });

  test("레포에 없는 파일을 가리키는 이미지는 그 자리에 안내·대체 텍스트·‘다시 불러오기’를 보이고 본문의 다른 곳은 고칠 수 있다", async () => {
    await page.goto(postUrl(POSTS.missing));
    await bodyEditor().waitFor();

    const failed = bodyEditor().getByText("사진을 불러오지 못했어요. 대체 텍스트: 없는 사진");
    await failed.waitFor();
    const retry = bodyEditor().getByRole("button", { name: "다시 불러오기" });
    expect(await retry.isVisible()).toBe(true);
    expect(await isAfter(bodyEditor().getByText("진료 시간을 안내해요."), failed)).toBe(true);
    expect(await unsavedNotice().count()).toBe(0);

    // 다시 불러와도 파일이 없으면 같은 안내로 돌아온다.
    await retry.click();
    await failed.waitFor();

    await cursorAfter("진료 시간을 안내해요.");
    await page.keyboard.type(" 토요일은 쉬어요.");
    await unsaved("본문").waitFor();
    await bodyEditor().getByText("진료 시간을 안내해요. 토요일은 쉬어요.").waitFor();
    expect(await failed.isVisible()).toBe(true);
    expect(newCommits()).toBe(0);
  });
});
