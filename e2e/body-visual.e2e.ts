import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { MISSING_DRAFT_IMAGE, missingImagesSaveMessage } from "@/lib/content/body-image";
import { FIELD_PREFIX } from "@/lib/metadata-form";

import { startApp, type App } from "./app";

const REPO = "es-kimo/body-visual";
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
      components: ["Image", "Footnote", "FootnoteRef", "TOC"],
      editor: "wysiwyg",
    },
  ],
};
const source = (
  title: string,
  body: string,
  imports = 'import image1 from "./1.png";\n\n',
) => `${imports}export const metadata = {
  title: '${title}',
  other: { status: 'draft' },
};

# ${title}

${body}
`;
/** 사진·각주·출처·목차가 모두 보이는 본문. */
const VISUAL = [
  "<TOC items={toc} />",
  "",
  "## 진료 시간",
  "",
  '평일만 진료해요<Footnote id="1">공휴일 제외</Footnote>.',
  "",
  '<Image src={image1} alt="병원 입구" />',
  "",
  '<FootnoteRef ids={["1"]}>',
  "  병원 공지",
  "</FootnoteRef>",
].join("\n");
/**
 * 제목이 `title`인 `VISUAL` 글을 열면 본문에 보이는 블록. 목차는 소제목을, 각주는 원문 번호를, 출처는 연결한 번호와
 * 내용을 보인다. `photo`가 있으면 각주 문단 다음에 그 대체 텍스트의 사진을 넣은 본문이다.
 */
const shownVisual = (title: string, photo?: string) => [
  title,
  "목차 진료 시간",
  "진료 시간",
  "평일만 진료해요 1 .",
  ...(photo ? [`[사진: ${photo}]`] : []),
  "[사진: 병원 입구]",
  "출처 1 병원 공지",
];
// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** 글마다 다른 파일을 열어 앞 테스트의 저장이 섞이지 않게 한다. */
const POSTS = {
  guard: "content/게시판/입력-보호/page.mdx",
  conflict: "content/게시판/충돌/page.mdx",
  publish: "content/게시판/게시/page.mdx",
  structure: "content/게시판/구조/page.mdx",
  kept: "content/게시판/그대로/page.mdx",
};
/** 구조 검사가 거부하는 본문. 일반 편집기는 백슬래시 줄바꿈을 다른 표기로 바꾼다. */
const STRUCTURE = "진료 시간을 안내해요.\n\n하나\\\n둘";
/** 폼이 고치지 않는 `src={식}` 이미지와 중첩 JSX. */
const KEPT = [
  '<Image src={image1.src} alt="식 사진" />',
  "",
  "<Callout>",
  '  안내<Footnote id="1">각주 <b>굵게</b></Footnote>',
  "",
  '  <Image src={image1} alt="안쪽 사진" />',
  "</Callout>",
].join("\n");
const FILES: { [post in keyof typeof POSTS]: string } = {
  guard: source("입력 보호", VISUAL),
  conflict: source("충돌", VISUAL),
  publish: source("게시", VISUAL),
  structure: source("구조", STRUCTURE, ""),
  kept: source("그대로", KEPT),
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
    ...(Object.keys(POSTS) as (keyof typeof POSTS)[]).flatMap((post) => [
      { path: POSTS[post], content: FILES[post] },
      { path: `${dir(POSTS[post])}/1.png`, content: PNG },
    ]),
  ]);
});
afterAll(async () => app?.close());

beforeEach(async () => {
  // 같은 브라우저 창 묶음은 IndexedDB를 함께 쓴다. 다시 여는 화면은 같은 묶음의 새 탭으로 연다.
  context = await app.context();
  page = await context.newPage();
  commitsBefore = app.commits();
});
afterEach(async () => context.close());

const postUrl = (path: string) => `${app.origin}/repos/${REPO}/post?${new URLSearchParams({ path })}`;
const newUrl = () => `${app.origin}/repos/${REPO}/new?${new URLSearchParams({ collection: "게시판" })}`;
// 새 글은 본문이 비어 있어 편집기가 같은 클래스의 자리 표시 문구를 함께 그린다.
const bodyEditor = (on = page) => on.locator(".body-editor-content[contenteditable='true']");
const sourceEditor = () => page.locator(".cm-content");
const titleInput = () => page.locator(`input[name="${FIELD_PREFIX}title"]`);
const modeButton = (name: "일반 편집" | "원문 편집") => page.getByRole("button", { name, exact: true });
const pressed = (name: "일반 편집" | "원문 편집") => modeButton(name).getAttribute("aria-pressed");
const form = (name: string) => page.getByRole("form", { name });
const saveButton = () => page.getByRole("button", { name: "임시저장" });
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);
const anyUnsaved = () => page.getByText(/저장하지 않은 변경이 있어요/);

/** 본문의 각주 1을 골라 바로 아래에 보이는 ‘수정’으로 폼을 연다. */
async function editFootnote() {
  await bodyEditor().getByRole("button", { name: "각주 1", exact: true }).click();
  await bodyEditor().getByRole("group", { name: "각주 1 관리" }).getByRole("button", { name: "수정" }).click();
}
const FORM_BLOCKED = "열려 있는 폼을 먼저 적용하거나 취소해 주세요.";
const CONFLICT = "글을 연 뒤 다른 곳에서 글이 바뀌었어요. 입력한 내용을 따로 보관한 뒤 글을 다시 열어 주세요.";
/** 사이트에 반영을 마쳤다고 읽히는 안내. 저장 성공은 반영 완료가 아니다. */
const REFLECTED = /사이트에 (반영됐|반영했|올라갔|게시됐)/;

async function openPost(path: string) {
  await page.goto(postUrl(path));
  await bodyEditor().waitFor();
}

/** 넣기 메뉴에서 `label`을 고른다. */
async function choose(label: string) {
  await page.getByRole("button", { name: "넣기", exact: true }).click();
  await page.getByRole("menu", { name: "넣기" }).getByRole("menuitem", { name: label, exact: true }).click();
}

/** 내용 칸에 쓰고 적용해 폼이 닫힐 때까지 기다린다. */
async function applyText(name: string, field: string, text: string) {
  await form(name).getByRole("textbox", { name: field }).fill(text);
  await form(name).getByRole("button", { name: "적용" }).click();
  await form(name).waitFor({ state: "detached" });
}

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
  await applyText("이미지 넣기", "대체 텍스트", alt);
}

/** 준비가 끝나는 시점을 테스트가 정하도록 이미지 읽기를 붙잡아 둔다. 글을 열기 전에 부른다. */
async function holdImagePreparing() {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    const held = window as unknown as { finishImage?: () => void };
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) =>
      new Promise((resolve) => {
        held.finishImage = () => resolve(original(...args));
      })) as typeof createImageBitmap;
  });
}

async function finishImagePreparing() {
  await page.evaluate(() => (window as unknown as { finishImage: () => void }).finishImage());
}

/** `text` 문단 끝에 커서를 둔다. */
async function cursorAfter(text: string) {
  await bodyEditor().getByText(text, { exact: true }).click();
  await page.keyboard.press("End");
  // 편집기는 옮긴 커서를 다음 프레임에 읽으므로 그 전에 키를 누르면 이전 커서 자리에 들어간다.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * 본문에 보이는 것을 블록마다 원문 순서대로. 사진은 ‘[사진: 대체 텍스트]’로 적는다.
 * 사진이 다 그려진 뒤에 읽어 불러오는 중 안내가 섞이지 않게 한다.
 */
async function shownBody() {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll<HTMLImageElement>(".body-editor-content img")].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    undefined,
    { timeout: 10_000 },
  );
  const blocks = await bodyEditor().evaluate((root) =>
    [...root.children].map((block) => {
      const words: string[] = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node instanceof HTMLImageElement) words.push(`[사진: ${node.alt}]`);
        else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) words.push(node.textContent.trim());
      }
      return words.join(" ");
    }),
  );
  // 편집기는 사진을 넣으면 뒤에 빈 문단을 두고, 원문에는 빈 문단이 남지 않아 오간 뒤에는 없다.
  return blocks.filter((block) => block !== "");
}

/** 넣기·수정 폼이 열려 있으면 저장과 모드 전환이 막히고 이유가 보이며, 취소하면 다시 할 수 있다. */
async function expectFormBlocks(name: string) {
  await form(name).waitFor();
  await saveButton().click();
  await page.getByText(FORM_BLOCKED).first().waitFor();
  await modeButton("원문 편집").click();
  expect(await page.getByText(FORM_BLOCKED).count()).toBeGreaterThan(0);
  expect(await pressed("일반 편집")).toBe("true");
  await form(name).getByRole("button", { name: "취소" }).click();
  await form(name).waitFor({ state: "detached" });
}

/** 이미지를 준비하는 동안 저장과 모드 전환이 막히고 이유가 보인다. 준비가 끝나면 폼에 대체 텍스트를 넣어 적용한다. */
async function expectPreparingBlocks(alt: string) {
  await pastePhoto();
  await page.getByText("이미지를 준비하고 있어요. 대체 텍스트를 넣은 뒤 저장해 주세요.").waitFor();
  await page.getByText("이미지를 준비하고 있어요. 대체 텍스트를 넣은 뒤 모드를 바꿔 주세요.").waitFor();
  expect(await saveButton().isDisabled()).toBe(true);
  expect(await modeButton("원문 편집").isDisabled()).toBe(true);
  await finishImagePreparing();
  await applyText("이미지 넣기", "대체 텍스트", alt);
}

/** 원문 편집으로 바꿨다 돌아온다. 돌아온 본문이 보이는 것을 돌려준다. */
async function roundTrip() {
  await modeButton("원문 편집").click();
  expect(await pressed("원문 편집")).toBe("true");
  const text = await sourceEditor().innerText();
  await modeButton("일반 편집").click();
  expect(await pressed("일반 편집")).toBe("true");
  return { source: text, shown: await shownBody() };
}

/** 임시저장하고 저장한 커밋으로 글 화면이 다시 열릴 때까지 기다린다. */
async function saveAndReopen(button = saveButton()) {
  const before = page.url();
  await button.click();
  await page.waitForURL(
    (url) => url.href !== before && url.pathname.endsWith("/post") && url.searchParams.has("saved"),
  );
  await bodyEditor().waitFor();
}

describe("입력 보호와 모드 전환", () => {
  test("기존 글: 사진·각주·목차가 보일 때 폼이 열려 있거나 이미지를 준비 중이면 저장·모드 전환을 막고, 원문 편집을 오가도 같은 자리에 보이며 커밋하지 않는다", async () => {
    await holdImagePreparing();
    await openPost(POSTS.guard);
    expect(await shownBody()).toEqual(shownVisual("입력 보호"));

    await editFootnote();
    await expectFormBlocks("각주 1 수정");
    await cursorAfter("평일만 진료해요");
    await expectPreparingBlocks("새 진료실");
    await unsaved("본문, 첨부 이미지").waitFor();
    const edited = await shownBody();
    expect(edited).toEqual(shownVisual("입력 보호", "새 진료실"));

    const { source: carried, shown } = await roundTrip();
    expect(carried).toContain('import image2 from "./2.png";');
    expect(carried).toContain('<Image src={image2} alt="새 진료실" />');
    expect(shown).toEqual(edited);
    // 넣은 사진은 오간 뒤에도 커밋 전 브라우저 안 주소로 보인다.
    expect(await bodyEditor().getByRole("img", { name: "새 진료실" }).getAttribute("src")).toMatch(/^blob:/);
    await unsaved("본문, 첨부 이미지").waitFor();
    expect(newCommits()).toBe(0);
    expect(app.file(POSTS.guard)).toBe(FILES.guard);
  });

  test("새 글: 넣은 사진·각주·목차가 보일 때 폼이 열려 있거나 이미지를 준비 중이면 저장·모드 전환을 막고, 원문 편집을 오가도 같은 자리에 보이며 커밋하지 않는다", async () => {
    await holdImagePreparing();
    await page.goto(newUrl());
    await bodyEditor().waitFor();
    await titleInput().fill("새 안내");
    await bodyEditor().click();
    await page.keyboard.type("## 진료 시간");
    await page.keyboard.press("Enter");
    await page.keyboard.type("평일만 진료해요");
    await choose("각주");
    await applyText("각주 넣기", "각주 내용", "공휴일 제외");
    await cursorAfter("평일만 진료해요");
    await page.keyboard.press("Enter");
    await choose("목차");
    await form("목차 넣기").getByRole("button", { name: "적용" }).click();
    await form("목차 넣기").waitFor({ state: "detached" });

    await choose("각주 출처");
    await expectFormBlocks("각주 출처 넣기");
    await cursorAfter("평일만 진료해요");
    await expectPreparingBlocks("새 진료실");
    const edited = await shownBody();
    expect(edited).toEqual(["진료 시간", "평일만 진료해요 1", "[사진: 새 진료실]", "목차 진료 시간"]);

    const { source: carried, shown } = await roundTrip();
    expect(carried).toContain('import image1 from "./1.png";');
    expect(carried).toContain('<Footnote id="1">공휴일 제외</Footnote>');
    expect(carried).toContain("<TOC items={toc} />");
    expect(shown).toEqual(edited);
    await unsaved("제목, 본문, 첨부 이미지").waitFor();
    expect(newCommits()).toBe(0);
  });
});

describe("저장 실패와 성공", () => {
  test("다른 곳에서 글이 바뀌어 저장에 실패해도 본문의 사진·첨부·폼으로 고친 내용이 남고 미저장 표시가 유지된다", async () => {
    const path = POSTS.conflict;
    await openPost(path);
    await cursorAfter("평일만 진료해요");
    await insertPhoto("충돌 전 사진");
    await editFootnote();
    await applyText("각주 1 수정", "각주 내용", "공휴일과 일요일 제외");
    // 폼을 닫으면 각주가 골라진 채 남아 내용을 보이므로 선택을 풀어 처음 연 화면과 같게 비교한다.
    await bodyEditor().getByRole("button", { name: "각주 1", exact: true }).click();
    await unsaved("본문, 첨부 이미지").waitFor();
    app.pushElsewhere(path, source("다른 곳에서 고친 글", VISUAL));
    const elsewhere = app.commits();

    await saveButton().click();
    await page.getByText(CONFLICT).waitFor();

    expect(app.commits()).toBe(elsewhere);
    expect(app.file(`${dir(path)}/2.png`)).toBeUndefined();
    expect(await shownBody()).toEqual(shownVisual("충돌", "충돌 전 사진"));
    expect(await bodyEditor().getByRole("img", { name: "충돌 전 사진" }).getAttribute("src")).toMatch(/^blob:/);
    await unsaved("본문, 첨부 이미지").waitFor();
    expect(await page.getByText(/넣은 이미지: 2\.png/).count()).toBe(1);
    await editFootnote();
    expect(await form("각주 1 수정").getByRole("textbox", { name: "각주 내용" }).inputValue()).toBe(
      "공휴일과 일요일 제외",
    );
  });

  test("기존 글을 게시에 성공해도 사이트에 반영됐다고 안내하지 않고, 다시 연 글에 같은 사진·번호·목차가 보인다", async () => {
    const path = POSTS.publish;
    await openPost(path);
    await cursorAfter("평일만 진료해요");
    await insertPhoto("반영할 사진");
    expect(await shownBody()).toEqual(shownVisual("게시", "반영할 사진"));

    await saveAndReopen(page.getByRole("button", { name: "게시", exact: true }));
    await page.getByText("게시 대상으로 저장했어요. 사이트에 반영되기까지 시간이 걸릴 수 있어요.").waitFor();
    expect(await page.getByText(REFLECTED).count()).toBe(0);
    expect(newCommits()).toBe(1);
    expect(app.file(`${dir(path)}/2.png`)).toBeDefined();
    expect(await shownBody()).toEqual(shownVisual("게시", "반영할 사진"));
    expect(await anyUnsaved().count()).toBe(0);
  });

  test("새 글을 임시저장에 성공해도 사이트에 반영됐다고 안내하지 않고, 열린 글에 넣은 사진이 같은 자리에 보인다", async () => {
    await page.goto(newUrl());
    await bodyEditor().waitFor();
    await titleInput().fill("새 사진 안내");
    await bodyEditor().click();
    await page.keyboard.type("첫 문단이에요.");
    await page.keyboard.press("Enter");
    await insertPhoto("새 글 사진");
    expect(await shownBody()).toEqual(["첫 문단이에요.", "[사진: 새 글 사진]"]);

    await saveAndReopen();
    await page.getByText("임시저장했어요. 게시하기 전에는 사이트에 보이지 않아요.").waitFor();
    expect(await page.getByText(REFLECTED).count()).toBe(0);
    expect(newCommits()).toBe(1);
    expect(await shownBody()).toEqual(["첫 문단이에요.", "[사진: 새 글 사진]"]);
  });
});

describe("자동 보관 복구", () => {
  const archived = (on = page) => on.getByText(/^이 브라우저에 (보관했어요|글자만 보관했어요) · /);
  const restoreNotice = (on = page) => on.getByText(/에 이 브라우저에 보관한 입력이 있어요\./);

  /** 같은 브라우저에서 새 글 화면을 새 탭으로 다시 열어 보관본을 복구한다. */
  async function reopenAndRestore() {
    const next = await context.newPage();
    await next.goto(newUrl());
    await bodyEditor(next).waitFor();
    await restoreNotice(next).waitFor();
    await next.getByRole("button", { name: "복구", exact: true }).click();
    return next;
  }

  /** 첨부가 든 보관본 쓰기를 용량 부족으로 막아 텍스트만 보관하게 한다. 글을 열기 전에 부른다. */
  async function failAttachmentArchive() {
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        const attachments = (value as { attachments?: unknown[] } | null)?.attachments;
        if (attachments && attachments.length > 0) throw new DOMException("가득 찼다", "QuotaExceededError");
        return put.call(this, value, key);
      } as typeof put;
    });
  }

  async function writeNewPost(title: string, alt: string) {
    await page.goto(newUrl());
    await bodyEditor().waitFor();
    await titleInput().fill(title);
    await bodyEditor().click();
    await page.keyboard.type("첫 문단이에요.");
    await page.keyboard.press("Enter");
    await insertPhoto(alt);
  }

  test("이미지를 넣은 새 글을 보관한 뒤 다시 열어 복구하면 보관한 첨부가 사진으로 보이고, 저장하면 그 첨부를 커밋한다", async () => {
    await writeNewPost("보관한 사진 글", "보관한 사진");
    await archived().waitFor({ timeout: 5000 });
    expect(await archived().innerText()).toMatch(/^이 브라우저에 보관했어요 · /);
    await page.close();

    page = await reopenAndRestore();
    expect(await titleInput().inputValue()).toBe("보관한 사진 글");
    expect(await shownBody()).toEqual(["첫 문단이에요.", "[사진: 보관한 사진]"]);
    expect(await bodyEditor().locator("img").getAttribute("src")).toMatch(/^blob:/);
    expect(await page.getByText(MISSING_DRAFT_IMAGE).count()).toBe(0);
    await unsaved("제목, 본문, 첨부 이미지").waitFor();
    expect(newCommits()).toBe(0);

    await saveAndReopen();
    expect(newCommits()).toBe(1);
    expect(app.file("content/게시판/보관한 사진 글/1.png")).toBeDefined();
    expect(await shownBody()).toEqual(["첫 문단이에요.", "[사진: 보관한 사진]"]);
  });

  test("이미지를 보관하지 못한 새 글을 복구하면 그 자리에 사진 대신 이미지를 다시 고르라는 안내를 보이고 사진이 복구됐다고 하지 않는다", async () => {
    await failAttachmentArchive();
    await writeNewPost("빠진 사진 글", "빠진 사진");
    await page.getByText(/^이 브라우저에 글자만 보관했어요 · .*이미지 1개\(1\.png\)는 보관하지 못했어요\./).waitFor({
      timeout: 5000,
    });
    await page.close();

    page = await reopenAndRestore();
    expect(await titleInput().inputValue()).toBe("빠진 사진 글");
    const missing = bodyEditor().getByText(MISSING_DRAFT_IMAGE);
    await missing.waitFor();
    expect(await bodyEditor().locator("img").count()).toBe(0);
    expect(await bodyEditor().getByText("사진을 불러오지 못했어요.").count()).toBe(0);
    expect(await shownBody()).toEqual(["첫 문단이에요.", `${MISSING_DRAFT_IMAGE} 대체 텍스트: 빠진 사진`]);
    // 첨부가 없으니 첨부 이미지를 바뀐 곳으로 세지 않고, 보관 표시도 이미지를 뺐다고 계속 알린다.
    await unsaved("제목, 본문").waitFor();
    await page.getByText(/^이 브라우저에 글자만 보관했어요 · .*1\.png/).waitFor({ timeout: 5000 });

    // 원문 편집을 오가도 사진으로 바뀌지 않고 같은 안내가 그 자리에 남는다.
    const { shown } = await roundTrip();
    expect(shown).toEqual(["첫 문단이에요.", `${MISSING_DRAFT_IMAGE} 대체 텍스트: 빠진 사진`]);
    expect(newCommits()).toBe(0);
  });

  test("보관하지 못한 이미지가 본문에 남아 있으면 저장하지 않고 이유를 보이며, 그 자리를 지우고 이미지를 다시 넣으면 저장한다", async () => {
    await failAttachmentArchive();
    await writeNewPost("다시 고른 사진 글", "빠진 사진");
    await page.getByText(/^이 브라우저에 글자만 보관했어요 · /).waitFor({ timeout: 5000 });
    await page.close();
    page = await reopenAndRestore();
    await bodyEditor().getByText(MISSING_DRAFT_IMAGE).waitFor();

    // 그대로 저장하면 가져오지 않은 이미지를 쓰는 글이 되어 사이트가 글을 만들 수 없다.
    await saveButton().click();
    const blocked = page.getByText(missingImagesSaveMessage(["1.png"]));
    await blocked.waitFor();
    expect(newCommits()).toBe(0);

    await cursorAfter("첫 문단이에요.");
    await page.keyboard.press("Delete");
    await bodyEditor().getByText(MISSING_DRAFT_IMAGE).waitFor({ state: "detached" });
    await blocked.waitFor({ state: "detached" });
    await insertPhoto("다시 고른 사진");
    expect(await shownBody()).toEqual(["첫 문단이에요.", "[사진: 다시 고른 사진]"]);

    await saveAndReopen();
    expect(newCommits()).toBe(1);
    const saved = app.file("content/게시판/다시 고른 사진 글/page.mdx")!;
    expect(saved).toMatch(/import (image\d+) from "\.\/(\d+)\.png";[\s\S]*<Image src=\{\1\} alt="다시 고른 사진" \/>/);
    expect(saved).not.toContain("빠진 사진");
    expect(await shownBody()).toEqual(["첫 문단이에요.", "[사진: 다시 고른 사진]"]);
  });
});

describe("일반 편집 제한", () => {
  test("구조 검사가 거부하는 글은 원문 편집 안내와 원문을 보이고, 원문 편집으로 바꿀 수 있다", async () => {
    await page.goto(postUrl(POSTS.structure));
    await page
      .getByText(
        "이 글은 일반 편집을 지원하지 않아요. 원문 편집을 이용해 주세요. 일반 편집으로 열면 글 구조가 바뀌어요.",
      )
      .waitFor();
    expect(await page.locator("pre").filter({ hasText: "하나\\" }).innerText()).toContain(STRUCTURE);
    expect(await anyUnsaved().count()).toBe(0);

    await modeButton("원문 편집").click();
    expect(await sourceEditor().innerText()).toContain("하나\\\n둘");
    expect(newCommits()).toBe(0);
  });

  test("`src={식}` 이미지와 중첩 JSX가 있는 글은 일반 편집으로 열려 사진으로 바꾸지 않고, 바로 저장해도 변경이 없다고 하고 원문이 그대로다", async () => {
    await openPost(POSTS.kept);
    // 식으로 쓴 이미지는 사진으로 그리지 않고, 서식이 든 각주는 고칠 수 없는 이유를 붙인다.
    await bodyEditor()
      .getByText("폼으로 고칠 수 없어요. 내용에 서식이나 다른 요소가 들어 있어요. 원문 편집에서 직접 고쳐 주세요.")
      .waitFor();
    expect(await bodyEditor().getByRole("img", { name: "식 사진" }).count()).toBe(0);
    await page.waitForTimeout(500);
    expect(await anyUnsaved().count()).toBe(0);

    await saveButton().click();
    await page.getByText("변경된 내용이 없어요.").waitFor();
    expect(newCommits()).toBe(0);
    expect(app.file(POSTS.kept)).toBe(FILES.kept);
  });
});
