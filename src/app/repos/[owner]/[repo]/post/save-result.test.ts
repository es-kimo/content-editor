import { describe, expect, test } from "vitest";

import { saveBody, saveMetadata, saveSource, type SaveState } from "@/lib/content";
import { createGitHubClient } from "@/lib/github";
import { yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha } from "@/test/fake-github";

import { saveResultState } from "./save-result";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";
const config = yjshdConfig();

const SOURCE = `import image1 from "./1.png";

export const metadata = {
  title: '11월 휴진 안내',
  description: '안녕하세요.',
  keywords: [],
  other: { status: "ready", createdAt: "2020-11-20T00:00:00Z" },
};

# 11월 휴진 안내

본문 <Image src={image1} alt="" />
`;
const BODY = `# 11월 휴진 안내\n\n본문 <Image src={image1} alt="" />\n`;

const FORM = {
  title: "12월 휴진 안내",
  description: "안녕하세요.",
  "other.createdAt": "2020-11-20T00:00",
  "other.status": "ready",
};

const setup = () => {
  const repo = fakeGitRepo(REPO, "main", [{ path: POST, content: SOURCE }]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const href = (commit: string) => `/repos/${REPO}/post?path=x&saved=${commit}`;
const baseSha = blobSha(SOURCE);

describe("saveResultState", () => {
  test("저장하면 새 커밋을 알리는 글 화면 주소를 돌려주고 서버에서 이동하지 않는다", async () => {
    const { repo, client } = setup();

    const result = await saveMetadata(client, REPO, config, { path: POST, baseSha, values: FORM });

    expect(saveResultState(result, href)).toEqual({ status: "saved", href: href(repo.head()) });
  });

  test("바뀐 것이 없으면 변경 없음으로 알린다", async () => {
    const { client } = setup();

    const result = await saveBody(client, REPO, config, { path: POST, baseSha, body: BODY });

    expect(saveResultState(result, href)).toEqual({ status: "unchanged" });
  });

  test("입력이 잘못되면 필드별 오류를 돌려주고 기본 안내는 표시된 항목을 고치라고 한다", async () => {
    const { client } = setup();

    const result = await saveMetadata(client, REPO, config, { path: POST, baseSha, values: { ...FORM, title: "" } });
    const state = errorState(saveResultState(result, href));

    expect(state.fields).toEqual({ title: "값을 입력해 주세요." });
    expect(state.message).toBe("입력한 값을 확인해 주세요. 표시된 항목을 고친 뒤 다시 저장해 주세요.");
    expect(state.detail).toBeUndefined();
  });

  test("컴파일되지 않으면 기본 안내는 원문 편집에서 고치라고 하고, 오류 행과 원문은 기술 상세에 둔다", async () => {
    const { client } = setup();
    const broken = SOURCE.replace("src={image1}", "src={image1 +}");

    const result = await saveSource(client, REPO, config, { path: POST, baseSha, source: broken });
    const state = errorState(saveResultState(result, href));

    expect(state.message).toBe(
      "이대로 저장하면 사이트에서 글을 보여 줄 수 없어요. 원문 편집에서 오류 표시가 있는 줄을 고친 뒤 다시 저장해 주세요.",
    );
    if (result.ok || result.reason !== "compile") throw new Error("컴파일 실패가 아니다");
    expect(state.detail).toBe(`12행: ${result.error.message}`);
    expect(state.message).not.toContain(result.error.message);
    expect(state.fields).toBeUndefined();
  });

  test("연 뒤 다른 곳에서 글이 바뀌었으면 충돌 이유와 입력을 보관한 뒤 다시 여는 행동을 알린다", async () => {
    const { repo, client } = setup();
    repo.pushElsewhere([{ path: POST, content: SOURCE.replace("본문", "다른 곳에서 고친 본문") }]);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha, source: SOURCE + "\n추가\n" });
    const state = errorState(saveResultState(result, href));

    expect(state.message).toBe(
      "글을 연 뒤 다른 곳에서 글이 바뀌었어요. 입력한 내용을 따로 보관한 뒤 글을 다시 열어 주세요.",
    );
    expect(state.fields).toBeUndefined();
  });
});

function errorState(state: SaveState): Extract<SaveState, { status: "error" }> {
  if (state.status !== "error") throw new Error(`오류 결과가 아니다: ${state.status}`);
  return state;
}
