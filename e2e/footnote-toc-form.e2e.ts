import type { BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { startApp, type App } from "./app";

const REPO = "es-kimo/footnotes";
const METADATA = { title: { type: "string", label: "제목", required: true } };
const COMPONENTS = ["Footnote", "FootnoteRef", "Mermaid", "TOC"];
const CONFIG = {
  branch: "main",
  syntax: { gfm: false, math: false },
  collections: [
    {
      name: "블로그",
      path: "content/블로그/{slug}/page.mdx",
      metadata: METADATA,
      components: COMPONENTS,
      editor: "source",
    },
    {
      name: "게시판",
      path: "content/게시판/{slug}/page.mdx",
      metadata: METADATA,
      components: COMPONENTS,
      editor: "wysiwyg",
    },
    {
      name: "사진",
      path: "content/사진/{slug}/page.mdx",
      metadata: METADATA,
      components: ["Image"],
      editor: "wysiwyg",
    },
  ],
};
const source = (
  title: string,
  { heading = true, extra = "", titleValue = `'${title}'` } = {},
) => `export const metadata = {
  title: ${titleValue},
};

# ${title}
${heading ? "\n## 날짜\n" : ""}
진료를 쉬어요<Footnote id="1">공휴일</Footnote>.
${extra}`;

/** 글마다 다른 파일을 열어 앞 테스트의 저장이 섞이지 않게 한다. */
const POSTS = {
  sourceNotes: "content/블로그/각주/page.mdx",
  bodyNotes: "content/게시판/각주/page.mdx",
  sourceToc: "content/블로그/목차/page.mdx",
  bodyToc: "content/게시판/목차/page.mdx",
  noHeading: "content/블로그/제목-없음/page.mdx",
  customToc: "content/블로그/직접-목차/page.mdx",
  limited: "content/블로그/제한/page.mdx",
  bodyLimited: "content/게시판/제한/page.mdx",
  conflict: "content/블로그/충돌/page.mdx",
  sourceOnly: "content/블로그/원문-전용/page.mdx",
  advanced: "content/게시판/고급/page.mdx",
  photo: "content/사진/사진/page.mdx",
};
const FILES: { [post in keyof typeof POSTS]: string } = {
  sourceNotes: source("각주 글"),
  bodyNotes: source("일반 편집 각주 글"),
  sourceToc: source("목차 글"),
  bodyToc: source("일반 편집 목차 글"),
  noHeading: source("소제목 없는 글", { heading: false }),
  customToc: source("직접 목차 글", { extra: '\n<TOC items={[{ title: "날짜", url: "#날짜" }]} />\n' }),
  limited: source("제한 글", {
    extra: [
      "",
      '둘째 문장<Footnote id="1">겹친 번호</Footnote>, 셋째 문장<Footnote id={n}>식</Footnote>.',
      "",
      '<FootnoteRef ids={["1"]}>',
      "  달력",
      "</FootnoteRef>",
      "",
    ].join("\n"),
  }),
  bodyLimited: source("일반 편집 제한 글", {
    extra: '\n둘째 문장<Footnote id="1">겹친 번호</Footnote>.\n',
  }),
  conflict: source("충돌 글"),
  sourceOnly: source("원문 전용 글", { titleValue: "foo" }),
  advanced: source("고급 삽입 글"),
  photo: source("사진 글"),
};
const BLOCKED = "열려 있는 폼을 먼저 적용하거나 취소해 주세요.";

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
const sourceEditor = () => page.locator(".cm-content");
const sourceText = () => sourceEditor().innerText();
const bodyEditor = () => page.locator(".body-editor-content");
const insertButton = () => page.getByRole("button", { name: "넣기", exact: true });
const menuItems = () => page.getByRole("menu", { name: "넣기" }).getByRole("menuitem");
const form = (name: string) => page.getByRole("form", { name });
const unsaved = (areas: string) => page.getByText(`저장하지 않은 변경이 있어요. 바뀐 곳: ${areas}`);
const anyUnsaved = () => page.getByText(/저장하지 않은 변경이 있어요/);
/** 보이는 편집 모드의 삽입 항목 목록. 두 편집 모드가 같은 이름의 목록을 둔다. */
const insertList = (count: number) => page.getByText(`삽입 항목 ${count}개`).filter({ visible: true });
const isFocused = (locator: Locator) => locator.evaluate((el) => el === document.activeElement);

async function openSource(path: string) {
  await page.goto(postUrl(path));
  await sourceEditor().waitFor();
}

async function openBody(path: string) {
  await page.goto(postUrl(path));
  await bodyEditor().waitFor();
}

async function choose(label: string) {
  await insertButton().click();
  await page.getByRole("menu", { name: "넣기" }).getByRole("menuitem", { name: label, exact: true }).click();
}

/** 원문 편집기의 마지막(빈) 줄에 커서를 둔다. */
async function sourceCursorAtEnd() {
  await sourceEditor().click();
  await page.keyboard.press("Control+End");
}

/** 원문 편집기에서 본문 마지막 문장 끝에 커서를 둔다. */
async function sourceCursorAtLastLine() {
  await sourceCursorAtEnd();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
}

/** 내용 칸에 쓰고 적용해 폼이 닫힐 때까지 기다린다. */
async function applyText(name: string, field: string, text: string) {
  await form(name).getByRole("textbox", { name: field }).fill(text);
  await form(name).getByRole("button", { name: "적용" }).click();
  await form(name).waitFor({ state: "detached" });
}

/** 저장하고 저장한 커밋으로 글 화면이 다시 열릴 때까지 기다린다. 앞 저장의 안내가 남아 있어 주소로 기다린다. */
async function saveAndReopen(label: "본문 저장" | "원문 저장") {
  const before = page.url();
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL((url) => url.href !== before && url.searchParams.has("saved"));
  await page.getByText(/^저장했어요\./).waitFor();
}

describe("각주와 각주 출처", () => {
  test("원문 편집에서 각주와 그 각주의 출처를 넣고 저장·재열기한 뒤 내용을 고쳐도 번호와 연결이 그대로다", async () => {
    const path = POSTS.sourceNotes;
    const before = app.file(path)!;
    await openSource(path);

    await sourceCursorAtLastLine();
    await choose("각주");
    await applyText("각주 넣기", "각주 내용", "토요일 <포함>");
    expect(await isFocused(insertButton())).toBe(true);

    await sourceCursorAtEnd();
    await choose("각주 출처");
    const ref = form("각주 출처 넣기");
    expect(await isFocused(ref.getByRole("checkbox", { name: "각주 1 공휴일" }))).toBe(true);
    await ref.getByRole("textbox", { name: "출처 내용" }).fill("병원 공지");
    // 각주를 고르지 않으면 적용하지 않는다.
    await ref.getByRole("button", { name: "적용" }).click();
    await ref.getByText("연결할 각주를 하나 이상 선택해 주세요.").waitFor();
    expect(await sourceText()).not.toContain("FootnoteRef");
    await ref.getByRole("checkbox", { name: "각주 2 토요일 <포함>" }).check();
    await ref.getByRole("button", { name: "적용" }).click();
    await ref.waitFor({ state: "detached" });

    const added = before
      .replace("</Footnote>.", '</Footnote>.<Footnote id="2">토요일 \\<포함\\></Footnote>')
      .concat('\n<FootnoteRef ids={["2"]}>\n  병원 공지\n</FootnoteRef>\n');
    await unsaved("원문 편집").waitFor();
    await saveAndReopen("원문 저장");
    expect(newCommits()).toBe(1);
    expect(app.file(path)).toBe(added);

    // 같은 값으로 적용하면 변경이 아니다.
    await insertList(3).click();
    await page.getByRole("button", { name: "각주 2 출처 수정" }).click();
    expect(await form("각주 2 출처 수정").getByRole("textbox").inputValue()).toBe("병원 공지");
    await page.keyboard.press("Enter");
    await form("각주 2 출처 수정").waitFor({ state: "detached" });
    expect(await anyUnsaved().count()).toBe(0);

    await page.getByRole("button", { name: "각주 2 수정" }).click();
    expect(await form("각주 2 수정").getByRole("textbox").inputValue()).toBe("토요일 <포함>");
    await applyText("각주 2 수정", "각주 내용", "토요일·일요일");
    await page.getByRole("button", { name: "각주 2 출처 수정" }).click();
    await applyText("각주 2 출처 수정", "출처 내용", "병원 공지사항");
    await saveAndReopen("원문 저장");

    expect(newCommits()).toBe(2);
    expect(app.file(path)).toBe(
      added.replace("토요일 \\<포함\\>", "토요일·일요일").replace("  병원 공지\n", "  병원 공지사항\n"),
    );
  });

  test("일반 편집에서 각주를 문장 안에 넣고 출처를 넣어 저장·재열기한 뒤 내용을 고쳐도 번호와 연결이 그대로다", async () => {
    const path = POSTS.bodyNotes;
    await openBody(path);
    await bodyEditor().getByText("진료를 쉬어요").click();

    await choose("각주");
    await applyText("각주 넣기", "각주 내용", "토요일 포함");
    await bodyEditor().click();
    await page.keyboard.press("Control+End");
    await choose("각주 출처");
    await form("각주 출처 넣기").getByRole("checkbox", { name: "각주 2 토요일 포함" }).check();
    await applyText("각주 출처 넣기", "출처 내용", "병원 공지");
    await unsaved("본문").waitFor();
    await saveAndReopen("본문 저장");

    expect(newCommits()).toBe(1);
    const saved = app.file(path)!;
    // 새 각주는 문장을 나누지 않고 커서가 있던 문장 안에 들어간다.
    const sentence = saved.split("\n").find((line) => line.startsWith("진료를"));
    expect(sentence).toContain('<Footnote id="2">토요일 포함</Footnote>');
    expect(sentence).toContain('<Footnote id="1">공휴일</Footnote>');
    expect(saved).toContain('<FootnoteRef ids={["2"]}>\n  병원 공지\n</FootnoteRef>');

    await insertList(3).click();
    await page.getByRole("button", { name: "각주 2 수정" }).click();
    await applyText("각주 2 수정", "각주 내용", "토요일·일요일");
    await page.getByRole("button", { name: "각주 2 출처 수정" }).click();
    await applyText("각주 2 출처 수정", "출처 내용", "병원 공지사항");
    await unsaved("본문").waitFor();
    await saveAndReopen("본문 저장");

    expect(newCommits()).toBe(2);
    const resaved = app.file(path)!;
    expect(resaved).toContain('<Footnote id="2">토요일·일요일</Footnote>');
    expect(resaved).toContain('<FootnoteRef ids={["2"]}>\n  병원 공지사항\n</FootnoteRef>');
    expect(resaved).toContain('<Footnote id="1">공휴일</Footnote>');
  });

  test("출처 폼을 Esc로 닫으면 넣기 버튼으로 초점이 돌아오고 원문은 그대로다", async () => {
    await openSource(POSTS.sourceNotes);
    const before = await sourceText();
    await sourceCursorAtEnd();
    await choose("각주 출처");
    await form("각주 출처 넣기").getByRole("checkbox").first().check();
    await page.keyboard.press("Escape");

    await form("각주 출처 넣기").waitFor({ state: "detached" });
    expect(await isFocused(insertButton())).toBe(true);
    expect(await sourceText()).toBe(before);
    expect(await anyUnsaved().count()).toBe(0);
  });

  test("다른 곳에서 글이 바뀌어 저장하지 못해도 폼으로 넣은 각주와 출처가 남고 미저장 표시가 유지된다", async () => {
    const path = POSTS.conflict;
    await openSource(path);
    await sourceCursorAtEnd();
    await choose("각주 출처");
    await form("각주 출처 넣기").getByRole("checkbox", { name: "각주 1 공휴일" }).check();
    await applyText("각주 출처 넣기", "출처 내용", "충돌 전 출처");
    const typed = await sourceText();
    app.pushElsewhere(path, source("다른 곳에서 고친 글"));
    const elsewhere = app.commits();

    await page.getByRole("button", { name: "원문 저장" }).click();
    await page
      .getByText("글을 연 뒤 다른 곳에서 글이 바뀌었어요. 입력한 내용을 따로 보관한 뒤 글을 다시 열어 주세요.")
      .waitFor();

    expect(app.commits()).toBe(elsewhere);
    expect(await sourceText()).toBe(typed);
    expect(typed).toContain("충돌 전 출처");
    await unsaved("원문 편집").waitFor();
  });
});

describe("목차", () => {
  test("원문 편집에서 자동 목차를 넣고 저장·재열기하면, 다시 넣으려 할 때 기존 항목으로 안내하고 제거해 저장할 수 있다", async () => {
    const path = POSTS.sourceToc;
    const before = app.file(path)!;
    await openSource(path);
    await sourceCursorAtEnd();

    await choose("목차");
    const toc = form("목차 넣기");
    // 표현식이나 항목 입력 없이 적용만 한다.
    expect(await toc.getByRole("textbox").count()).toBe(0);
    expect(await isFocused(toc.getByRole("button", { name: "적용" }))).toBe(true);
    await page.keyboard.press("Enter");
    await toc.waitFor({ state: "detached" });
    await unsaved("원문 편집").waitFor();
    await saveAndReopen("원문 저장");
    expect(app.file(path)).toBe(`${before}\n<TOC items={toc} />\n`);

    await choose("목차");
    await toc.getByText("이미 목차가 있어요. 삽입 항목에서 기존 목차를 확인해 주세요.").waitFor();
    expect(await toc.getByRole("button", { name: "적용" }).isDisabled()).toBe(true);
    await page.keyboard.press("Escape");
    await toc.waitFor({ state: "detached" });

    await insertList(2).click();
    await page.getByRole("button", { name: "목차 제거" }).click();
    await unsaved("원문 편집").waitFor();
    expect(await sourceText()).not.toContain("<TOC");
    await saveAndReopen("원문 저장");
    expect(newCommits()).toBe(2);
    expect(app.file(path)).toBe(before);
  });

  test("일반 편집에서 자동 목차를 넣고 저장·재열기한 뒤 제거해 저장할 수 있다", async () => {
    const path = POSTS.bodyToc;
    await openBody(path);
    await bodyEditor().click();
    await page.keyboard.press("Control+End");

    await choose("목차");
    await form("목차 넣기").getByRole("button", { name: "적용" }).click();
    await form("목차 넣기").waitFor({ state: "detached" });
    await unsaved("본문").waitFor();
    await saveAndReopen("본문 저장");
    expect(app.file(path)).toContain("\n<TOC items={toc} />\n");

    await insertList(2).click();
    await page.getByRole("button", { name: "목차 제거" }).click();
    await unsaved("본문").waitFor();
    await saveAndReopen("본문 저장");
    expect(newCommits()).toBe(2);
    expect(app.file(path)).not.toContain("<TOC");
    expect(app.file(path)).toContain('<Footnote id="1">공휴일</Footnote>');
  });

  test("소제목이 없는 글은 목차 폼에서 제목을 추가하라고 안내하고, 직접 만든 목차는 덮어쓰거나 지우지 않는다", async () => {
    await openSource(POSTS.noHeading);
    await sourceCursorAtEnd();
    await choose("목차");
    await form("목차 넣기").getByText("글에 제목을 추가하면 목차가 채워져요.").waitFor();
    expect(await form("목차 넣기").getByRole("button", { name: "적용" }).isEnabled()).toBe(true);
    await page.keyboard.press("Escape");

    await openSource(POSTS.customToc);
    const before = await sourceText();
    await insertList(2).click();
    await page.getByText("폼으로 고칠 수 없어요. 직접 만든 목차예요. 원문에서 직접 고쳐 주세요.").waitFor();
    expect(await page.getByRole("button", { name: "목차 제거" }).count()).toBe(0);
    await sourceCursorAtEnd();
    await choose("목차");
    await form("목차 넣기").getByText("이미 목차가 있어요. 삽입 항목에서 기존 목차를 확인해 주세요.").waitFor();
    expect(await form("목차 넣기").getByRole("button", { name: "적용" }).isDisabled()).toBe(true);
    await form("목차 넣기").getByRole("button", { name: "취소" }).click();
    expect(await sourceText()).toBe(before);
    expect(await anyUnsaved().count()).toBe(0);
  });
});

describe("메뉴와 제한", () => {
  test("넣기 메뉴는 설정이 허용한 항목만 용도로 보이고, 나머지 컴포넌트는 고급 삽입에서 넣는다", async () => {
    await openSource(POSTS.sourceNotes);
    await insertButton().click();
    expect(await menuItems().allInnerTexts()).toEqual(["각주", "각주 출처", "목차"]);
    await page.keyboard.press("Escape");

    const advanced = page.getByRole("group", { name: "고급 삽입" }).filter({ visible: true });
    expect(await advanced.getByRole("button").allInnerTexts()).toEqual(["Mermaid"]);
    await sourceCursorAtEnd();
    await advanced.getByRole("button", { name: "Mermaid" }).click();
    expect(await sourceText()).toContain("<Mermaid chart={`");

    await openBody(POSTS.advanced);
    await insertButton().click();
    expect(await menuItems().allInnerTexts()).toEqual(["각주", "각주 출처", "목차"]);
    await page.keyboard.press("Escape");
    expect(
      await page.getByRole("group", { name: "고급 삽입" }).filter({ visible: true }).getByRole("button").count(),
    ).toBe(1);
    expect(await page.getByTitle("Mermaid 넣기").isVisible()).toBe(true);
    expect(await page.getByTitle("Footnote 넣기").count()).toBe(0);

    await openBody(POSTS.photo);
    await insertButton().click();
    expect(await menuItems().allInnerTexts()).toEqual(["이미지"]);
    expect(await page.getByRole("group", { name: "고급 삽입" }).count()).toBe(0);
  });

  test("고칠 수 없는 각주·출처는 숨기지 않고 이유와 원문에서 고치는 방법을 보이며 수정 버튼을 두지 않는다", async () => {
    await openSource(POSTS.limited);
    await insertList(4).click();

    expect(
      await page.getByText("폼으로 고칠 수 없어요. 같은 번호의 각주가 여러 개예요. 원문에서 직접 고쳐 주세요.").count(),
    ).toBe(2);
    await page.getByText("폼으로 고칠 수 없어요. 값이 코드로 되어 있어요. 원문에서 직접 고쳐 주세요.").waitFor();
    await page
      .getByText("폼으로 고칠 수 없어요. 어느 각주의 출처인지 하나로 정할 수 없어요. 원문에서 직접 고쳐 주세요.")
      .waitFor();
    expect(await page.getByRole("button", { name: /수정$/ }).filter({ visible: true }).count()).toBe(0);
    // 출처 폼에서도 번호가 겹친 각주는 고를 수 없다.
    await sourceCursorAtEnd();
    await choose("각주 출처");
    await form("각주 출처 넣기").getByText("출처를 연결할 각주가 없어요. 먼저 각주를 넣어 주세요.").waitFor();
    expect(await form("각주 출처 넣기").getByRole("button", { name: "적용" }).isDisabled()).toBe(true);
  });

  test("일반 편집에서 고칠 수 없는 각주는 원문 편집으로 안내하고 원문 편집으로 바꿀 수 있다", async () => {
    await openBody(POSTS.bodyLimited);
    await insertList(2).click();

    expect(
      await page
        .getByText("폼으로 고칠 수 없어요. 같은 번호의 각주가 여러 개예요. 원문 편집에서 직접 고쳐 주세요.")
        .count(),
    ).toBe(2);
    expect(await page.getByRole("button", { name: "원문 편집", exact: true }).isEnabled()).toBe(true);
  });

  test("원문 전용 글은 제한 이유를 그대로 보이고, 원문 편집의 넣기 메뉴로 각주를 넣으면 원문 편집의 미저장 변경이다", async () => {
    await openSource(POSTS.sourceOnly);
    await page.getByText("이 글은 일반 편집을 지원하지 않아요. 원문 편집을 이용해 주세요.", { exact: false }).waitFor();
    expect(await page.getByRole("button", { name: "일반 편집" }).count()).toBe(0);

    await sourceCursorAtLastLine();
    await choose("각주");
    await applyText("각주 넣기", "각주 내용", "토요일");
    expect(await sourceText()).toContain('<Footnote id="2">토요일</Footnote>');
    await unsaved("원문 편집").waitFor();
  });

  test("출처 폼이 열려 있으면 저장을 막고 적용·취소를 안내한다", async () => {
    await openSource(POSTS.sourceNotes);
    await sourceCursorAtEnd();
    await choose("각주 출처");
    await form("각주 출처 넣기").getByRole("textbox", { name: "출처 내용" }).fill("작성 중");

    await page.getByRole("button", { name: "원문 저장" }).click();
    await page.getByText(BLOCKED).waitFor();
    expect(newCommits()).toBe(0);
    expect(await form("각주 출처 넣기").getByRole("textbox").inputValue()).toBe("작성 중");
  });
});
