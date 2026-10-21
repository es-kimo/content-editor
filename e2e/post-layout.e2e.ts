import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { FIELD_PREFIX } from "@/lib/metadata-form";

import { startApp, type App } from "./app";

const REPO = "es-kimo/layout";
const POST = "content/게시판/구성/page.mdx";
const UNTITLED = "content/게시판/제목없음/page.mdx";
const SOURCE_ONLY = "content/게시판/원문만/page.mdx";
/** 저장해 보는 글. 다른 테스트가 여는 글의 내용을 바꾸지 않게 따로 둔다. */
const SAVED_POST = "content/게시판/저장/page.mdx";
/** 게시를 내리고 다시 게시해 보는 글. */
const STATUS_POST = "content/게시판/상태/page.mdx";
/** 상태가 초안·게시 대상이 아닌 값인 글. */
const HIDDEN_POST = "content/게시판/숨김/page.mdx";
/** 일반 편집으로 열면 백슬래시 줄바꿈이 바뀌어 본문 구조가 달라지므로, 본문을 일반 편집으로 고칠 수 없는 글. */
const STRUCTURE_POST = "content/게시판/구조/page.mdx";
const STRUCTURE_BODY = "하나\\\n둘";
const CONFIG = {
  branch: "main",
  syntax: { gfm: false, math: false },
  collections: [
    {
      name: "게시판",
      path: "content/게시판/{slug}/page.mdx",
      metadata: {
        title: { type: "string", label: "제목", required: true },
        // 알려진 필드지만 설정의 사용자 라벨이 기본 이름(요약)보다 앞선다.
        description: { type: "text", label: "한 줄 소개", required: true },
        // 라벨이 없는 알려진 필드. 글의 값이 배열이 아닌 문자열이라 잠긴다.
        keywords: { type: "string[]" },
        // 라벨이 없는 알려진 필드.
        "other.createdAt": { type: "datetime" },
        // 라벨이 없는, 알려지지 않은 필드.
        "other.code": { type: "string" },
        "other.status": { type: "select", label: "상태", options: ["ready", "draft"] },
      },
      editor: "wysiwyg",
    },
  ],
};
const source = (title: string, status = "ready") => `export const metadata = {
  title: ${title},
  description: '요약 한 줄',
  keywords: '문자열 검색어',
  other: { code: 'A-1', createdAt: '2020-11-20T00:00:00Z', status: '${status}' },
};

# 머리말

본문 첫 문단.
`;

let app: App;
let context: BrowserContext;
let page: Page;
let commitsBefore: number;
const newCommits = () => app.commits() - commitsBefore;

beforeAll(async () => {
  app = await startApp(REPO, [
    { path: "editor.config.json", content: JSON.stringify(CONFIG) },
    { path: POST, content: source("'구성 볼 글'") },
    { path: UNTITLED, content: source("''") },
    { path: SOURCE_ONLY, content: source("foo") },
    { path: SAVED_POST, content: source("'저장해 볼 글'") },
    { path: STATUS_POST, content: source("'상태 바꿀 글'") },
    { path: HIDDEN_POST, content: source("'숨긴 글'", "hidden") },
    { path: STRUCTURE_POST, content: source("'구조 바뀌는 글'").replace("본문 첫 문단.", STRUCTURE_BODY) },
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
// 본문의 `# 머리말`도 h1이라 화면 머리글 안에서 찾는다.
const heading = () => page.locator("main > header").getByRole("heading", { level: 1 });
const input = (key: string) => page.locator(`[name="${FIELD_PREFIX}${key}"]`);
const details = (name: string) => page.locator("details", { has: page.locator("summary", { hasText: name }) });
const settings = () => details("글 설정");
const settingsSummary = () => settings().locator(":scope > summary");
// 잠긴 필드 옆에도 기술 상세가 있어 화면 끝의 기술 상세만 고른다.
const techDetails = () =>
  page.locator("main > details").filter({ has: page.locator("summary", { hasText: "기술 상세" }) });
const isOpen = (locator: ReturnType<Page["locator"]>) => locator.evaluate((el) => (el as HTMLDetailsElement).open);
const UNSAVED_SETTINGS = "저장하지 않은 변경이 있어요. 바뀐 곳: 글 설정";
const PUBLISHED = "게시 대상으로 저장했어요. 사이트에 반영되기까지 시간이 걸릴 수 있어요.";
const UNPUBLISHED = "초안으로 바꿨어요. 사이트에서 사라지기까지 시간이 걸릴 수 있어요.";
const button = (name: string) => page.getByRole("button", { name, exact: true });
const statusLine = () => page.locator("main > header").getByText(/^상태: /);
/** 필드의 화면 이름. 라벨 안의 필수 표시(*)는 뺀다. */
const fieldLabels = () =>
  settings()
    .locator("label > span:first-child")
    .evaluateAll((spans) => spans.map((span) => span.firstChild?.textContent ?? ""));

async function openPost(path: string) {
  await page.goto(postUrl(path));
  await page.locator(".body-editor-content").waitFor();
}

describe("글 화면 구성", () => {
  test("저장된 제목과 글 상태가 화면 위에 있고, 제목 입력·본문·상태별 버튼이 보이며 글 설정·기술 상세는 닫혀 있다", async () => {
    await openPost(POST);

    expect(await heading().textContent()).toBe("구성 볼 글");
    expect(await statusLine().textContent()).toBe("상태: 게시 대상");
    expect(await input("title").inputValue()).toBe("구성 볼 글");
    expect(await input("title").isVisible()).toBe(true);
    expect(await page.locator(".body-editor-content").getByText("본문 첫 문단.").isVisible()).toBe(true);
    expect(await button("수정 반영").isVisible()).toBe(true);
    expect(await button("게시 내리기").isVisible()).toBe(true);
    // 영역마다 따로 저장하는 버튼은 없다.
    expect(await page.getByRole("button", { name: /^(글 설정 저장|본문 저장|원문 저장|임시저장|게시)$/ }).count()).toBe(
      0,
    );

    expect(await isOpen(settings())).toBe(false);
    expect(await input("description").isVisible()).toBe(false);
    expect(await isOpen(techDetails())).toBe(false);
    expect(await page.getByText(POST).isVisible()).toBe(false);

    // 제목 입력이 본문보다 앞이고, 글 설정과 기술 상세는 본문 다음이다.
    const top = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!.y;
    const body = await top(page.locator(".body-editor-content"));
    expect(await top(input("title"))).toBeLessThan(body);
    expect(await top(settingsSummary())).toBeGreaterThan(body);
    expect(await top(techDetails())).toBeGreaterThan(await top(settingsSummary()));

    await techDetails().locator("summary").click();
    expect(await page.getByText(POST).isVisible()).toBe(true);
  });

  test("글 화면은 ‘글 설정’·‘일반 편집’·‘원문 편집’을, 글 목록과 새 글 화면은 ‘글 분류’를 보인다", async () => {
    await openPost(POST);
    expect(await settingsSummary().getByText("글 설정", { exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "일반 편집", exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "원문 편집", exact: true }).isVisible()).toBe(true);
    // 원문 편집기에는 글 원문(`export const metadata`)이 있어 화면 문구만 본다.
    expect(await page.getByText(/WYSIWYG|컬렉션|원문 모드/).count()).toBe(0);

    for (const url of [`${app.origin}/repos/${REPO}`, `${app.origin}/repos/${REPO}/new`]) {
      await page.goto(url);
      const tabs = page.getByRole("navigation", { name: "글 분류" });
      await tabs.waitFor();
      expect(await tabs.getByText("글 분류", { exact: true }).isVisible()).toBe(true);
      expect(await tabs.getByRole("link", { name: "게시판" }).isVisible()).toBe(true);
      expect(await page.getByText(/컬렉션|metadata/).count()).toBe(0);
    }
  });

  test("제목이 없는 글은 글 화면과 목록에서 '제목 없는 글'로 보인다", async () => {
    await openPost(UNTITLED);
    expect(await heading().textContent()).toBe("제목 없는 글");

    await page.goto(`${app.origin}/repos/${REPO}?${new URLSearchParams({ collection: "게시판" })}`);
    await page.getByRole("link", { name: "구성 볼 글" }).waitFor();
    // 제목이 빈 글과 metadata를 읽을 수 없는 글 모두 파일명 대신 '제목 없는 글'이다.
    expect(await page.getByRole("link", { name: "제목 없는 글" }).count()).toBe(2);
    expect(await page.getByRole("link", { name: "제목없음" }).count()).toBe(0);
    expect(await page.getByText(/API 호출/).isVisible()).toBe(false);
  });

  test("일반 편집 제한과 그 이유는 기술 상세를 펼치지 않아도 보인다", async () => {
    await page.goto(postUrl(SOURCE_ONLY));
    await heading().waitFor();

    expect(await heading().textContent()).toBe("제목 없는 글");
    const notice = page.getByText("이 글은 일반 편집을 지원하지 않아요. 원문 편집을 이용해 주세요.");
    expect(await notice.isVisible()).toBe(true);
    expect(await notice.textContent()).toContain("글 설정을 폼으로 읽을 수 없어요.");
    expect(await isOpen(techDetails())).toBe(false);
    // 제한의 기술 원문은 기술 상세를 펼쳐야 보인다.
    expect(await techDetails().getByText("일반 편집 제한 원문").isVisible()).toBe(false);
    await techDetails().locator("summary").click();
    expect(await techDetails().getByText("일반 편집 제한 원문").isVisible()).toBe(true);
  });
});

describe("글 단위 저장과 상태별 버튼", () => {
  test("제목과 본문을 바꾸면 ‘수정 반영’ 한 번에 커밋 하나로 함께 저장되고, 다시 열면 바뀐 제목·본문이다", async () => {
    await openPost(SAVED_POST);
    await input("title").fill("바뀐 제목");
    await page.getByText(UNSAVED_SETTINGS).waitFor();
    expect(await settingsSummary().getByText("저장하지 않은 변경이 있어요").isVisible()).toBe(true);
    expect(await isOpen(settings())).toBe(false);

    await page.locator(".body-editor-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" 덧붙임");
    await page.getByText("저장하지 않은 변경이 있어요. 바뀐 곳: 글 설정, 본문").waitFor();
    await button("수정 반영").click();
    await page.getByText(PUBLISHED, { exact: true }).waitFor();
    await heading().filter({ hasText: "바뀐 제목" }).waitFor();
    expect(newCommits()).toBe(1);
    expect(app.file(SAVED_POST)).toContain("덧붙임");
    expect(await page.getByText(/저장하지 않은 변경이 있/).count()).toBe(0);

    await openPost(SAVED_POST);
    expect(await heading().textContent()).toBe("바뀐 제목");
    expect(await statusLine().textContent()).toBe("상태: 게시 대상");
    expect(await page.getByText(/저장하지 않은 변경이 있/).count()).toBe(0);
  });

  test("바꾼 것 없이 ‘수정 반영’을 누르면 ‘변경된 내용이 없어요’로 알리고 커밋하지 않는다", async () => {
    await openPost(POST);

    await button("수정 반영").click();
    await page.getByText("변경된 내용이 없어요.", { exact: true }).waitFor();
    expect(newCommits()).toBe(0);
    expect(await page.getByText(PUBLISHED).count()).toBe(0);
  });

  test("필드 라벨은 사용자 라벨을 우선하고, 없으면 알려진 이름을, 알 수 없는 필드는 키를 보인다. 상태는 폼에 없다", async () => {
    await openPost(POST);
    await settingsSummary().click();

    expect(await fieldLabels()).toEqual(["한 줄 소개", "검색어", "작성일", "other.code"]);
    expect(await input("other.status").count()).toBe(0);
    // 알려진 필드의 내부 키는 라벨 옆에 보이지 않는다.
    expect(await settings().getByText("other.createdAt").count()).toBe(0);
  });

  test("상태를 다룰 수 없는 글은 저장 버튼 없이 원문을 확인하라고 안내하고, 목록은 그 값을 그대로 보인다", async () => {
    await openPost(HIDDEN_POST);

    await page.getByText(/^글의 게시 상태를 알 수 없어 저장할 수 없어요\./).waitFor();
    expect(await statusLine().count()).toBe(0);
    expect(await page.getByRole("button", { name: /^(수정 반영|게시 내리기|임시저장|게시)$/ }).count()).toBe(0);

    await page.goto(`${app.origin}/repos/${REPO}?${new URLSearchParams({ collection: "게시판" })}`);
    const row = (title: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name: title }) });
    await row("숨긴 글").waitFor();
    expect(await row("숨긴 글").getByRole("cell").nth(1).textContent()).toBe("hidden");
    expect(await row("구성 볼 글").getByRole("cell").nth(1).textContent()).toBe("게시 대상");
  });

  test("본문을 일반 편집으로 고칠 수 없는 글도 고친 제목을 원문 편집과 주고받고, 일반 편집에서 저장하면 본문은 그대로다", async () => {
    const sourceMode = () => page.getByRole("button", { name: "원문 편집", exact: true });
    const notice = () =>
      page
        .getByText("이 글은 일반 편집을 지원하지 않아요. 원문 편집을 이용해 주세요.", { exact: false })
        .filter({ visible: true });
    await page.goto(postUrl(STRUCTURE_POST));
    await notice().waitFor();
    await input("title").fill("고친 제목");
    await page.getByText(UNSAVED_SETTINGS, { exact: true }).waitFor();

    await sourceMode().click();
    expect(await sourceMode().getAttribute("aria-pressed")).toBe("true");
    expect(await page.locator(".cm-content").innerText()).toContain("title: '고친 제목'");
    // 본문을 고치지 않았으면 처음 열 때처럼 이유를 보이며 일반 편집으로 돌아온다.
    await button("일반 편집").click();
    await notice().waitFor();
    expect(await input("title").inputValue()).toBe("고친 제목");
    await page.getByText(UNSAVED_SETTINGS, { exact: true }).waitFor();

    await button("수정 반영").click();
    await page.getByText(PUBLISHED, { exact: true }).waitFor();
    expect(newCommits()).toBe(1);
    expect(app.file(STRUCTURE_POST)).toContain("고친 제목");
    expect(app.file(STRUCTURE_POST)).toContain(STRUCTURE_BODY);
    await heading().filter({ hasText: "고친 제목" }).waitFor();
    expect(await page.getByText(/저장하지 않은 변경이 있/).count()).toBe(0);

    await sourceMode().click();
    expect(await sourceMode().getAttribute("aria-pressed")).toBe("true");
  });

  test("게시 내리기는 확인한 뒤 초안으로 저장하고, 초안을 게시하면 게시 대상이 되며 제목·작성일은 그대로다", async () => {
    const status = () => /status: ['"](\w+)['"]/.exec(app.file(STATUS_POST) ?? "")?.[1];
    const dialog = () => page.getByRole("dialog", { name: "‘상태 바꿀 글’의 게시를 내릴까요?" });

    await openPost(STATUS_POST);
    await input("title").fill("버릴 제목");
    await button("게시 내리기").click();
    await dialog().waitFor();
    // 처음 초점은 실행하지 않는 쪽이고, 저장하지 않은 변경이 버려진다고 먼저 알린다.
    expect(
      await dialog()
        .getByRole("button", { name: "계속 편집" })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    expect(await dialog().getByText("사이트에서 사라지기까지 시간이 걸릴 수 있어요").isVisible()).toBe(true);
    expect(
      await dialog()
        .getByText(/저장하지 않은 변경은 버려져요\. 바뀐 곳: 글 설정/)
        .isVisible(),
    ).toBe(true);
    await dialog().getByRole("button", { name: "계속 편집" }).click();
    await dialog().waitFor({ state: "hidden" });
    expect(await input("title").inputValue()).toBe("버릴 제목");
    expect(newCommits()).toBe(0);

    await button("게시 내리기").click();
    await dialog().getByRole("button", { name: "게시 내리기" }).click();
    await page.getByText(UNPUBLISHED, { exact: true }).waitFor();
    expect(newCommits()).toBe(1);
    expect(status()).toBe("draft");
    expect(app.file(STATUS_POST)).toContain("상태 바꿀 글");
    expect(app.file(STATUS_POST)).toContain("2020-11-20T00:00:00Z");
    // 버리기로 한 입력은 저장한 글로 다시 열린다.
    await vi.waitFor(async () => expect(await input("title").inputValue()).toBe("상태 바꿀 글"));
    expect(await page.getByText(/저장하지 않은 변경이 있/).count()).toBe(0);
    expect(await statusLine().textContent()).toBe("상태: 초안");
    expect(await button("임시저장").isVisible()).toBe(true);

    await button("게시").click();
    await page.getByText(PUBLISHED, { exact: true }).waitFor();
    expect(newCommits()).toBe(2);
    expect(status()).toBe("ready");
    expect(await statusLine().textContent()).toBe("상태: 게시 대상");
  });

  test("글 설정을 접었다 펼쳐도 입력이 남고, 잠긴 필드와 라벨 없는 필드도 빠지지 않는다", async () => {
    await openPost(POST);
    await settingsSummary().click();
    await input("description").fill("고친 요약");
    await settingsSummary().click();
    expect(await isOpen(settings())).toBe(false);
    expect(await settingsSummary().getByText("저장하지 않은 변경이 있어요").isVisible()).toBe(true);
    await settingsSummary().click();
    expect(await input("description").inputValue()).toBe("고친 요약");

    expect(await input("keywords").isDisabled()).toBe(true);
    expect(await input("keywords").inputValue()).toBe("");
    expect(
      await settings()
        .getByText(/원문 편집에서 고쳐 주세요/)
        .isVisible(),
    ).toBe(true);
    expect(await input("other.code").inputValue()).toBe("A-1");
    expect(await settings().getByText("other.code").count()).toBeGreaterThan(0);
  });

  test("접힌 필수 필드를 비운 채 저장하면 글 설정을 펼쳐 필드 옆에 오류를 보이고 커밋하지 않는다", async () => {
    await openPost(POST);
    await settingsSummary().click();
    await input("description").fill("");
    await settingsSummary().click();

    await button("수정 반영").click();
    await settings().getByText("값을 입력해 주세요.").waitFor();
    expect(await isOpen(settings())).toBe(true);

    // 다시 접어도 요약 줄에 오류가 보인다.
    await settingsSummary().click();
    expect(await settingsSummary().getByText("확인할 항목이 있어요").isVisible()).toBe(true);
    expect(newCommits()).toBe(0);
  });

  test("서버가 숨긴 필드의 입력을 거절하면 저장 실패는 기본 화면에, 필드 오류는 펼친 글 설정에 보인다", async () => {
    await openPost(POST);
    // 화면이 막는 값을 직접 보낸 경우처럼 브라우저 검사를 풀고 필수 필드를 비운다.
    await input("description").evaluate((textarea) => {
      (textarea as HTMLTextAreaElement).required = false;
      (textarea as HTMLTextAreaElement).value = "";
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(await isOpen(settings())).toBe(false);

    await button("수정 반영").click();
    await settings().getByText("값을 입력해 주세요.").waitFor();
    expect(await isOpen(settings())).toBe(true);
    expect(
      await page.getByText("입력한 값을 확인해 주세요. 표시된 항목을 고친 뒤 다시 저장해 주세요.").isVisible(),
    ).toBe(true);
    expect(newCommits()).toBe(0);
  });
});
