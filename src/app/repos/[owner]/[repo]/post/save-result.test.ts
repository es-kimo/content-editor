import { describe, expect, test } from "vitest";

import { saveBody, saveMetadata, saveSource } from "@/lib/content";
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

  test("입력이 잘못되면 필드별 오류를 돌려준다", async () => {
    const { client } = setup();

    const result = await saveMetadata(client, REPO, config, { path: POST, baseSha, values: { ...FORM, title: "" } });

    expect(saveResultState(result, href)).toMatchObject({ status: "error", fields: { title: "값을 입력해 주세요." } });
  });

  test("컴파일되지 않으면 오류 행을 알린다", async () => {
    const { client } = setup();
    const broken = SOURCE.replace("src={image1}", "src={image1 +}");

    const result = await saveSource(client, REPO, config, { path: POST, baseSha, source: broken });

    expect(saveResultState(result, href)).toMatchObject({ status: "error", message: expect.stringContaining("12행") });
  });

  test("연 뒤 다른 곳에서 글이 바뀌었으면 충돌로 알린다", async () => {
    const { repo, client } = setup();
    repo.pushElsewhere([{ path: POST, content: SOURCE.replace("본문", "다른 곳에서 고친 본문") }]);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha, source: SOURCE + "\n추가\n" });

    expect(saveResultState(result, href)).toMatchObject({
      status: "error",
      message: expect.stringContaining("다른 곳에서 바뀌었다"),
    });
  });
});
