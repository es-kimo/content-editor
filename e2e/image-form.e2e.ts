import type { BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { addImageAt } from "@/lib/mdx-doc";

import { startApp, type App } from "./app";

const REPO = "es-kimo/images";
const METADATA = { title: { type: "string", label: "제목", required: true } };
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
    {
      name: "공지",
      path: "content/공지/{slug}/page.mdx",
      metadata: METADATA,
      components: ["Footnote"],
      editor: "source",
    },
  ],
};
const source = (title: string, extra = "") => `import image1 from "./1.png";

export const metadata = {
  title: '${title}',
};

# ${title}

진료 시간을 안내해요.

<Image src={image1} alt="병원 입구" />
${extra}`;
// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** 글 폴더에 이미 있는 이미지. 새 이미지가 덮어쓰지 않는지 본다. */
const OLD_IMAGE = "기존 이미지";
const BLOCKED = "열려 있는 폼을 먼저 적용하거나 취소해 주세요.";

/** 글 하나와 그 폴더의 기존 이미지. 테스트마다 다른 글을 열어 앞 테스트의 저장이 섞이지 않게 한다. */
const POSTS = {
  body: "content/게시판/일반/page.mdx",
  bodyPaste: "content/게시판/붙여넣기/page.mdx",
  both: "content/게시판/두-영역/page.mdx",
  limited: "content/게시판/제한/page.mdx",
  source: "content/원문/원문/page.mdx",
  sourceDrop: "content/원문/끌어놓기/page.mdx",
  conflict: "content/원문/충돌/page.mdx",
  preparing: "content/원문/준비/page.mdx",
  notice: "content/공지/안내/page.mdx",
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
    ...Object.entries(POSTS).flatMap(([name, path]) => [
      // 제한 글에는 글 폴더 이미지를 가져와 쓰지 않는 이미지를 하나 더 둔다.
      { path, content: source(`${name} 글`, name === "limited" ? '\n<Image src="/banner.png" alt="배너" />\n' : "") },
      { path: `${dir(path)}/1.png`, content: OLD_IMAGE },
    ]),
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
const imageForm = () => page.getByRole("form", { name: "이미지 넣기" });
const altInput = (form: Locator) => form.getByRole("textbox", { name: "대체 텍스트" });
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);
const isFocused = (locator: Locator) => locator.evaluate((el) => el === document.activeElement);

async function openBody(path: string) {
  await page.goto(postUrl(path));
  await bodyEditor().waitFor();
}

async function openSource(path: string) {
  await page.goto(postUrl(path));
  await sourceEditor().waitFor();
}

/** `button`을 눌러 연 파일 선택 창에서 PNG를 고른다. */
async function chooseImage(button: Locator) {
  const chooser = page.waitForEvent("filechooser");
  await button.click();
  await (await chooser).setFiles({ name: "사진.png", mimeType: "image/png", buffer: PNG });
}

/** 원문 편집기 끝에 커서를 두고 넣기 메뉴의 ‘이미지’로 파일을 고른다. */
async function chooseSourceImage() {
  await sourceEditor().click();
  await page.keyboard.press("Control+End");
  const menu = page.getByRole("button", { name: "넣기", exact: true });
  await menu.click();
  await chooseImage(page.getByRole("menu", { name: "넣기" }).getByRole("menuitem", { name: "이미지" }));
}

/** 붙여넣기나 끌어 놓기로 PNG 파일 `count`개를 `target`에 준다. */
async function giveFiles(target: Locator, kind: "paste" | "drop", count = 1) {
  await target.evaluate(
    (element, { kind, bytes, count }) => {
      const data = new DataTransfer();
      for (let i = 0; i < count; i++) {
        data.items.add(new File([new Uint8Array(bytes)], `붙인 사진 ${i}.png`, { type: "image/png" }));
      }
      const init = { bubbles: true, cancelable: true };
      element.dispatchEvent(
        kind === "paste"
          ? new ClipboardEvent("paste", { ...init, clipboardData: data })
          : new DragEvent("drop", { ...init, dataTransfer: data }),
      );
    },
    { kind, bytes: [...PNG], count },
  );
}

async function applyAlt(alt: string) {
  await altInput(imageForm()).fill(alt);
  await imageForm().getByRole("button", { name: "적용" }).click();
  await imageForm().waitFor({ state: "detached" });
}

/** 저장하고 저장한 커밋으로 글 화면이 다시 열릴 때까지 기다린다. 앞 저장의 안내가 남아 있어 주소로 기다린다. */
async function saveAndReopen(label: "본문 저장" | "원문 저장") {
  const before = page.url();
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL((url) => url.href !== before && url.searchParams.has("saved"));
  await page.getByText(/^저장했어요\./).waitFor();
}

describe("일반 편집 이미지", () => {
  test("파일을 골라 대체 텍스트와 함께 넣고 저장·재열기한 뒤 대체 텍스트를 다시 고칠 수 있다", async () => {
    const path = POSTS.body;
    const before = app.file(path)!;
    await openBody(path);
    await bodyEditor().click();
    await page.keyboard.press("Control+End");

    await chooseImage(page.getByTitle("이미지 넣기"));
    await imageForm().waitFor();
    // 파일 교체·자르기 없이 대체 텍스트만 받는다.
    expect(await imageForm().getByRole("button").allInnerTexts()).toEqual(["적용", "취소"]);
    expect(await isFocused(altInput(imageForm()))).toBe(true);
    await applyAlt("진료 시간표");
    await unsaved("본문, 첨부 이미지").waitFor();
    await saveAndReopen("본문 저장");

    expect(newCommits()).toBe(1);
    const saved = app.file(path)!;
    const head = (text: string) => text.slice(0, text.indexOf("# "));
    expect(head(saved)).toBe(head(before).replace('"./1.png";\n', '"./1.png";\nimport image2 from "./2.png";\n'));
    expect(saved).toContain('<Image src={image2} alt="진료 시간표" />');
    // 브라우저가 보낸 본문의 줄바꿈이 바뀌지 않는다.
    expect(saved).not.toContain("\r");
    expect(app.file(`${dir(path)}/2.png`)).toBeDefined();
    expect(app.file(`${dir(path)}/1.png`)).toBe(OLD_IMAGE);

    // 다시 연 글에서 넣은 이미지의 대체 텍스트를 같은 폼으로 고친다.
    await page.getByText("본문 이미지 2개").click();
    await page.getByRole("button", { name: "이미지 수정" }).nth(1).click();
    const edit = page.getByRole("form", { name: "이미지 수정" });
    expect(await altInput(edit).inputValue()).toBe("진료 시간표");
    await altInput(edit).fill("12월 진료 시간표");
    await edit.getByRole("button", { name: "적용" }).click();
    await unsaved("본문").waitFor();
    await saveAndReopen("본문 저장");

    expect(newCommits()).toBe(2);
    // 일반 편집은 본문을 편집기의 정규화대로 저장하므로 import와 고친 대체 텍스트만 확인한다.
    const resaved = app.file(path)!;
    expect(head(resaved)).toBe(head(saved));
    expect(resaved).toContain('<Image src={image2} alt="12월 진료 시간표" />');
    expect(resaved).not.toContain('alt="진료 시간표"');
  });

  test("붙여넣은 이미지도 폼을 거쳐 적용할 때만 넣고, 취소하면 본문도 첨부도 그대로다", async () => {
    await openBody(POSTS.bodyPaste);
    await bodyEditor().click();

    await giveFiles(bodyEditor(), "paste");
    await imageForm().waitFor();
    await imageForm().getByRole("button", { name: "취소" }).click();
    await imageForm().waitFor({ state: "detached" });
    // 편집기는 초점이 빠질 때 기존 이미지 태그를 다시 써 본문 변경으로 알릴 수 있어, 넣은 이미지가 없는지로 본다.
    await page.getByText("본문 이미지 1개").waitFor();
    expect(await page.getByText(/저장하지 않은 변경이 있어요.*첨부 이미지/).count()).toBe(0);

    await giveFiles(bodyEditor(), "paste", 2);
    await page.getByText("이미지는 한 번에 하나씩 넣어 주세요.").waitFor();
    expect(await imageForm().count()).toBe(0);

    await giveFiles(bodyEditor(), "drop");
    await applyAlt("붙인 사진");
    await unsaved("본문, 첨부 이미지").waitFor();
    await saveAndReopen("본문 저장");
    expect(newCommits()).toBe(1);
    // 취소한 이미지(2.png)는 올리지 않고, 적용한 이미지만 다음 이름으로 올린다.
    expect(app.file(`${dir(POSTS.bodyPaste)}/2.png`)).toBeUndefined();
    expect(app.file(POSTS.bodyPaste)).toContain('<Image src={image3} alt="붙인 사진" />');
    expect(app.file(`${dir(POSTS.bodyPaste)}/3.png`)).toBeDefined();
  });

  test("폼으로 고칠 수 없는 이미지는 이유와 원문 편집 안내를 보이고 수정 버튼을 두지 않는다", async () => {
    await openBody(POSTS.limited);
    await page.getByText("본문 이미지 2개").click();

    await page
      .getByText(
        "폼으로 고칠 수 없어요. 글 폴더의 이미지를 가져와 쓰는 형태가 아니에요. 원문 편집에서 직접 고쳐 주세요.",
      )
      .waitFor();
    expect(await page.getByRole("button", { name: "이미지 수정" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "원문 편집", exact: true }).isEnabled()).toBe(true);
  });
});

describe("원문 편집 이미지", () => {
  test("넣기 메뉴로 고른 이미지를 대체 텍스트와 함께 넣고 저장·재열기한 뒤, 대체 텍스트만 고치면 그 속성만 바뀐다", async () => {
    const path = POSTS.source;
    const before = app.file(path)!;
    await openSource(path);

    await chooseSourceImage();
    await imageForm().waitFor();
    expect(await imageForm().getByRole("button").allInnerTexts()).toEqual(["적용", "취소"]);
    await applyAlt("진료 시간표");
    // 열기 전과 같은 위치(원문 끝)에 import와 태그만 더한다.
    const expected = addImageAt(
      before,
      { from: before.length, to: before.length },
      { file: "2.png", component: "Image", alt: "진료 시간표" },
    );
    if (!expected.ok) throw new Error(expected.reason);
    await unsaved("원문 편집, 원문 편집 첨부 이미지").waitFor();
    await saveAndReopen("원문 저장");

    expect(newCommits()).toBe(1);
    expect(app.file(path)).toBe(expected.source);
    expect(app.file(`${dir(path)}/2.png`)).toBeDefined();
    expect(app.file(`${dir(path)}/1.png`)).toBe(OLD_IMAGE);

    // 값을 바꾸지 않고 적용하면 원문이 그대로라 저장해도 커밋하지 않는다.
    await page.getByText("삽입 항목 2개").click();
    const editImage = () => page.getByRole("button", { name: "이미지 수정" }).nth(1);
    await editImage().click();
    const edit = page.getByRole("form", { name: "이미지 수정" });
    expect(await altInput(edit).inputValue()).toBe("진료 시간표");
    await page.keyboard.press("Enter");
    await edit.waitFor({ state: "detached" });
    expect(await page.getByText(/저장하지 않은 변경이 있어요/).count()).toBe(0);
    await page.getByRole("button", { name: "원문 저장" }).click();
    await page.getByText("변경된 내용이 없어요.").waitFor();
    expect(newCommits()).toBe(1);

    await editImage().click();
    await altInput(edit).fill("12월 진료 시간표");
    await page.keyboard.press("Enter");
    await saveAndReopen("원문 저장");
    expect(newCommits()).toBe(2);
    expect(app.file(path)).toBe(expected.source.replace('alt="진료 시간표"', 'alt="12월 진료 시간표"'));
  });

  test("끌어 놓은 이미지도 폼을 거쳐 커서 자리에 넣고, 폼이 열린 동안 받은 이미지는 막았다고 알린다", async () => {
    await openSource(POSTS.sourceDrop);
    const before = await sourceText();
    await sourceEditor().click();
    await page.keyboard.press("Control+End");

    await giveFiles(sourceEditor(), "drop");
    await imageForm().waitFor();
    expect(await sourceText()).toBe(before);
    // 폼이 열린 동안 받은 이미지는 막고, 폼을 닫으면 그 안내도 사라진다.
    await giveFiles(sourceEditor(), "drop");
    await page.getByText(BLOCKED).waitFor();
    await applyAlt("끌어 놓은 사진");
    expect(await page.getByText(BLOCKED).count()).toBe(0);

    expect(await sourceText()).toContain('import image2 from "./2.png";');
    expect(await sourceText()).toContain('<Image src={image2} alt="끌어 놓은 사진" />');
  });

  test("이미지를 준비하는 동안 원문을 저장할 수 없고, 떠나려 하면 원문 편집 첨부를 잃는다고 묻는다", async () => {
    // 준비가 끝나는 시점을 테스트가 정하도록 이미지 읽기를 붙잡아 둔다.
    await page.addInitScript(() => {
      const original = window.createImageBitmap.bind(window);
      const held = window as unknown as { finishImage?: () => void };
      window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) =>
        new Promise((resolve) => {
          held.finishImage = () => resolve(original(...args));
        })) as typeof createImageBitmap;
    });
    await openSource(POSTS.preparing);

    await chooseSourceImage();
    await page.getByText("이미지를 준비하고 있어요. 대체 텍스트를 넣은 뒤 저장해 주세요.").waitFor();
    expect(await page.getByRole("button", { name: "원문 저장" }).isDisabled()).toBe(true);
    await unsaved("원문 편집 첨부 이미지").waitFor();

    await page.getByRole("link", { name: `${REPO} · 원문` }).click();
    const leave = page.getByRole("dialog", { name: "저장하지 않은 변경이 있어요. 나가면 입력이 사라져요." });
    await leave.getByText("바뀐 곳: 원문 편집 첨부 이미지").waitFor();
    await leave.getByRole("button", { name: "계속 편집" }).click();

    await page.evaluate(() => (window as unknown as { finishImage: () => void }).finishImage());
    await imageForm().waitFor();
    expect(await page.getByRole("button", { name: "원문 저장" }).isDisabled()).toBe(false);
    await page.getByRole("button", { name: "원문 저장" }).click();
    await page.getByText(BLOCKED).waitFor();
    expect(newCommits()).toBe(0);
  });

  test("다른 곳에서 글이 바뀌어 저장하지 못해도 원문과 첨부가 남고, 다시 연 뒤가 아니면 커밋하지 않는다", async () => {
    const path = POSTS.conflict;
    await openSource(path);
    await chooseSourceImage();
    await applyAlt("충돌 전 사진");
    const typed = await sourceText();
    app.pushElsewhere(path, source("다른 곳에서 고친 글"));
    const elsewhere = app.commits();

    await page.getByRole("button", { name: "원문 저장" }).click();
    await page
      .getByText("글을 연 뒤 다른 곳에서 글이 바뀌었어요. 입력한 내용을 따로 보관한 뒤 글을 다시 열어 주세요.")
      .waitFor();

    expect(app.commits()).toBe(elsewhere);
    expect(await sourceText()).toBe(typed);
    await unsaved("원문 편집, 원문 편집 첨부 이미지").waitFor();
    expect(await page.getByText(/넣은 이미지: 2\.png/).count()).toBe(1);
    expect(app.file(`${dir(path)}/2.png`)).toBeUndefined();
  });

  test("설정에 이미지가 없는 글은 넣기 메뉴와 도구 막대에 이미지 넣기를 두지 않는다", async () => {
    await openSource(POSTS.notice);
    await page.getByRole("button", { name: "넣기", exact: true }).click();

    const items = page.getByRole("menu", { name: "넣기" }).getByRole("menuitem");
    expect(await items.allInnerTexts()).toEqual(["각주"]);
    await page.getByRole("button", { name: "일반 편집" }).click();
    await bodyEditor().waitFor();
    expect(await page.getByTitle("이미지 넣기").count()).toBe(0);
  });
});

describe("두 편집 영역의 첨부", () => {
  test("원문 이미지 저장은 일반 편집의 미저장 첨부를 저장한 것으로 치지 않고 버릴지 먼저 묻는다", async () => {
    await openBody(POSTS.both);
    await bodyEditor().click();
    await page.keyboard.press("Control+End");
    await chooseImage(page.getByTitle("이미지 넣기"));
    await applyAlt("일반 편집 사진");
    await page.getByRole("button", { name: "원문 편집", exact: true }).click();
    await chooseSourceImage();
    await applyAlt("원문 편집 사진");
    await unsaved("본문, 첨부 이미지, 원문 편집, 원문 편집 첨부 이미지").waitFor();

    await page.getByRole("button", { name: "원문 저장" }).click();
    const confirm = page.getByRole("dialog", { name: "저장하면 다른 곳의 저장하지 않은 입력이 사라져요" });
    await confirm.getByText("저장한 글로 다시 열면서 입력이 사라지는 곳: 본문, 첨부 이미지").waitFor();
    await confirm.getByRole("button", { name: "계속 편집" }).click();

    expect(newCommits()).toBe(0);
    await unsaved("본문, 첨부 이미지, 원문 편집, 원문 편집 첨부 이미지").waitFor();
  });
});
