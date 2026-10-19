import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { parseEditorConfig, type EditorConfig } from "@/lib/editor-config";
import { editedBody, parseMdx } from "@/lib/mdx-doc";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha } from "@/test/fake-github";
import { loadFixtures } from "@/test/fixtures";

import { createGitHubClient } from "./client";
import { findCollection } from "./read";
import { saveBody } from "./save-body";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";

/** 실제 yjshd에 넣을 config 예시. 완료 기준을 이 config로 확인한다. */
const config: EditorConfig = (() => {
  const file = path.resolve(import.meta.dirname, "../../../docs/editor-config/yjshd.editor.config.json");
  const result = parseEditorConfig(readFileSync(file, "utf8"));
  if (!result.ok) throw new Error("config 오류");
  return result.config;
})();

const HEAD = `import image1 from "./1.png";

export const metadata = {
  title: '11월 휴진 안내',
  keywords: [],
  other: { status: "ready", createdAt: "2020-11-20T00:00:00Z" },
};

`;
const SOURCE = `${HEAD}# 11월 휴진 안내

안녕하세요.

<Image src={image1} alt="" />
`;

/** 공지 글에서 문단·목록·굵게·링크를 고친 본문. */
const EDITED = `# 11월 휴진 안내

안녕하세요. 다음과 같이 **외래 진료 휴진**을 안내드립니다.

- 11월 17일 (화요일)
- 11월 28일 (토요일)

자세한 내용은 [진료 시간](https://example.com/hours)을 봅니다.

<Image src={image1} alt="" />
`;

const setup = (files: { path: string; content: string }[]) => {
  const repo = fakeGitRepo(REPO, "main", [...files, { path: "README.md", content: "# yjshd\n" }]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

const bodyOf = (source: string) => {
  const doc = parseMdx(source, config.syntax);
  if (!doc.ok) throw new Error(doc.message);
  return doc.body;
};

describe("saveBody", () => {
  test("공지 글의 문단·목록·굵게·링크를 고쳐 저장하면 커밋 1개에 본문만 바뀐다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body: EDITED });

    expect(result).toEqual({ ok: true, commit: repo.head(), parent: before });
    expect(repo.log()).toHaveLength(2);
    expect(repo.log()[0]!.message).toBe("post: 11월 휴진 안내");
    expect(text(repo.file(POST))).toBe(HEAD + EDITED);
  });

  test("에디터가 끝 줄바꿈을 뗀 본문을 내보내도 파일 끝 줄바꿈을 지킨다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const body = editedBody(bodyOf(SOURCE), null, EDITED.trim());

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body });

    expect(result.ok).toBe(true);
    expect(text(repo.file(POST))).toBe(HEAD + EDITED);
  });

  test("에디터에서 고쳤다가 되돌린 본문은 끝 줄바꿈이 없어도 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();
    const body = editedBody(bodyOf(SOURCE), null, bodyOf(SOURCE).trim());

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body });

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head()).toBe(before);
  });

  test("본문이 원본과 같으면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body: bodyOf(SOURCE) });

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head()).toBe(before);
  });

  test("편집 화면을 연 뒤 다른 곳에서 글을 고쳤으면 저장하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    repo.pushElsewhere([{ path: POST, content: SOURCE.replace("안녕하세요.", "다른 곳에서 고친 본문") }]);
    const head = repo.head();

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), body: EDITED });

    expect(result).toMatchObject({ ok: false, reason: "changed" });
    expect(repo.head()).toBe(head);
  });

  test("고친 본문이 컴파일되지 않으면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      body: "# 제목\n\n<Image src={image1}\n",
    });

    expect(result).toMatchObject({ ok: false, reason: "compile" });
    expect(repo.head()).toBe(before);
  });

  test("구간으로 나눌 수 없는 글은 저장하지 않는다", async () => {
    const source = "본문\n\nexport const a = 1;\n";
    const { repo, client } = setup([{ path: POST, content: source }]);
    const before = repo.head();

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(source), body: "고친 본문\n" });

    expect(result).toMatchObject({ ok: false, reason: "not-editable" });
    expect(repo.head()).toBe(before);
  });

  test("metadata에 제목이 없으면 커밋 제목에 slug를 쓴다", async () => {
    const source = "export const metadata = {};\n\n본문\n";
    const { repo, client } = setup([{ path: POST, content: source }]);

    const result = await saveBody(client, REPO, config, { path: POST, baseSha: blobSha(source), body: "고친 본문\n" });

    expect(result.ok).toBe(true);
    expect(repo.log()[0]!.message).toBe("post: 1.휴진");
  });

  test("없는 글이면 not-found", async () => {
    const { client } = setup([{ path: POST, content: SOURCE }]);
    const result = await saveBody(client, REPO, config, {
      path: "content/4.게시판/없는글/page.mdx",
      baseSha: "x",
      body: EDITED,
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

const fixtures = loadFixtures("yjshd");

describe("yjshd 픽스처 전체", () => {
  test.skipIf(!fixtures)("config 컬렉션의 모든 글을 본문 그대로 저장하면 커밋하지 않는다", async () => {
    const changed: string[] = [];
    let covered = 0;
    for (const fixture of fixtures ?? []) {
      const filePath = `content/${fixture.path}`;
      if (!findCollection(config, filePath)) continue;
      covered++;
      const { repo, client } = setup([{ path: filePath, content: fixture.source }]);
      const before = repo.head();
      const result = await saveBody(client, REPO, config, {
        path: filePath,
        baseSha: blobSha(fixture.source),
        body: bodyOf(fixture.source),
      });
      if (result.ok || result.reason !== "unchanged" || repo.head() !== before) {
        changed.push(`${fixture.path}: ${JSON.stringify(result)}`);
      }
    }
    expect(changed).toEqual([]);
    // 게시판 47 + 강좌 103. save-metadata.test.ts와 같은 범위다.
    expect(covered).toBe(150);
  });

  test.skipIf(!fixtures)(
    "게시판 글의 본문을 고쳐 저장하면 본문 앞 import·metadata는 원본 그대로다",
    async () => {
      const failures: string[] = [];
      for (const fixture of fixtures!.filter((f) => f.path.startsWith("4.게시판/"))) {
        const filePath = `content/${fixture.path}`;
        const { repo, client } = setup([{ path: filePath, content: fixture.source }]);
        const body = bodyOf(fixture.source) + "\n추가한 **문단**\n";
        const result = await saveBody(client, REPO, config, {
          path: filePath,
          baseSha: blobSha(fixture.source),
          body,
        });
        const head = fixture.source.slice(0, fixture.source.length - bodyOf(fixture.source).length);
        if (!result.ok || text(repo.file(filePath)) !== head + body) {
          failures.push(`${fixture.path}: ${JSON.stringify(result)}`);
        }
      }
      expect(failures).toEqual([]);
    },
    60_000,
  );
});
