import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { parseEditorConfig, type EditorConfig } from "@/lib/editor-config";
import { createGitHubClient } from "@/lib/github";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha } from "@/test/fake-github";
import { loadFixtures } from "@/test/fixtures";

import { saveSource } from "./save-source";

const REPO = "es-kimo/site";
const BRANCH = "blog";
const POST = "apps/blog/content/Computer-Science/github-pages/page.mdx";

/** 실제 blog에 넣을 config 예시. 완료 기준을 이 config로 확인한다. */
const config: EditorConfig = (() => {
  const file = path.resolve(import.meta.dirname, "../../../docs/editor-config/blog.editor.config.json");
  const result = parseEditorConfig(readFileSync(file, "utf8"));
  if (!result.ok) throw new Error("config 오류");
  return result.config;
})();

const SOURCE = `import { toc } from "./toc";

export const metadata = {
  title: "GitHub Pages의 HTTPS",
  other: { status: "draft" },
};

# GitHub Pages의 HTTPS

<TOC items={toc} />

인증서 설정 없이 HTTPS가 동작한다.
`;

/** import를 하나 더하고, metadata 상태와 본문 문단·수식을 고친 원문. */
const EDITED = `import { toc } from "./toc";
import { Footnote } from "@/components/footnote";

export const metadata = {
  title: "GitHub Pages의 HTTPS",
  other: { status: "ready" },
};

# GitHub Pages의 HTTPS

<TOC items={toc} />

인증서 설정 없이 HTTPS가 동작한다<Footnote id="1" />. 수식 $a^2$도 쓴다.
`;

const setup = (files: { path: string; content: string }[]) => {
  const repo = fakeGitRepo(REPO, BRANCH, [...files, { path: "README.md", content: "# site\n" }]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

describe("saveSource", () => {
  test("blog 글의 import·metadata·본문을 원문으로 고쳐 저장하면 커밋 1개에 고친 원문 그대로 남는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head(BRANCH);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), source: EDITED });

    expect(result).toEqual({ ok: true, commit: repo.head(BRANCH), parent: before });
    expect(repo.log(BRANCH)).toHaveLength(2);
    expect(repo.log(BRANCH)[0]!.message).toBe("post: GitHub Pages의 HTTPS");
    expect(text(repo.file(POST, BRANCH))).toBe(EDITED);
  });

  test("구간으로 나눌 수 없는 글도 원문으로 고쳐 저장한다", async () => {
    const source = "본문\n\nexport const a = 1;\n";
    const edited = "고친 본문\n\nexport const a = 2;\n";
    const { repo, client } = setup([{ path: POST, content: source }]);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(source), source: edited });

    expect(result.ok).toBe(true);
    expect(text(repo.file(POST, BRANCH))).toBe(edited);
  });

  test("metadata를 폼으로 읽을 수 없는 글도 원문으로 고쳐 저장하고, 커밋 제목에 slug를 쓴다", async () => {
    const source = `const title = "제목";\n\nexport const metadata = { title };\n\n본문\n`;
    const edited = source.replace("본문", "고친 본문");
    const { repo, client } = setup([{ path: POST, content: source }]);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(source), source: edited });

    expect(result.ok).toBe(true);
    expect(text(repo.file(POST, BRANCH))).toBe(edited);
    expect(repo.log(BRANCH)[0]!.message).toBe("post: github-pages");
  });

  test("원문이 원본과 같으면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head(BRANCH);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), source: SOURCE });

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head(BRANCH)).toBe(before);
  });

  test("고친 원문이 컴파일되지 않으면 커밋하지 않고 오류 줄을 알려 준다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head(BRANCH);
    // 10행 JSX 속성의 식이 끝나지 않았다.
    const broken = SOURCE.replace("<TOC items={toc} />", "<TOC items={toc +} />");

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), source: broken });

    expect(result).toMatchObject({ ok: false, reason: "compile", error: { line: 10 } });
    expect(repo.head(BRANCH)).toBe(before);
  });

  test("원문 모드를 연 뒤 다른 곳에서 글을 고쳤으면 저장하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    repo.pushElsewhere([{ path: POST, content: SOURCE.replace("동작한다", "다른 곳에서 고쳤다") }], BRANCH);
    const head = repo.head(BRANCH);

    const result = await saveSource(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), source: EDITED });

    expect(result).toMatchObject({ ok: false, reason: "changed" });
    expect(repo.head(BRANCH)).toBe(head);
  });

  test("없는 글이면 not-found", async () => {
    const { client } = setup([{ path: POST, content: SOURCE }]);
    const result = await saveSource(client, REPO, config, {
      path: "apps/blog/content/Computer-Science/없는글/page.mdx",
      baseSha: "x",
      source: EDITED,
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

const fixtures = loadFixtures("blog");

describe("blog 픽스처 전체", () => {
  test.skipIf(!fixtures)("모든 글을 원문으로 고쳐 저장하면 파일이 고친 원문 그대로다", async () => {
    const failures: string[] = [];
    for (const fixture of fixtures ?? []) {
      const filePath = `apps/blog/content/${fixture.path}`;
      const { repo, client } = setup([{ path: filePath, content: fixture.source }]);
      const edited = `${fixture.source}\n원문 모드에서 더한 **문단**\n`;
      const result = await saveSource(client, REPO, config, {
        path: filePath,
        baseSha: blobSha(fixture.source),
        source: edited,
      });
      if (!result.ok || text(repo.file(filePath, BRANCH)) !== edited) {
        failures.push(`${fixture.path}: ${JSON.stringify(result)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(fixtures).toHaveLength(14);
  });
});
