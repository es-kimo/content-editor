import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { parseEditorConfig, type EditorConfig } from "@/lib/editor-config";
import { createGitHubClient } from "@/lib/github";
import { parseMdx, parseMetadata, type MetadataValue } from "@/lib/mdx-doc";
import { buildForm } from "@/lib/metadata-form";
import { fakeGitRepo } from "@/test/fake-git";
import { blobSha } from "@/test/fake-github";
import { loadFixtures } from "@/test/fixtures";

import { editorKeys, findCollection, readPost } from "./read";
import { saveMetadata } from "./save-metadata";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";

/** 실제 yjshd에 넣을 config 예시. 완료 기준을 이 config로 확인한다. */
const config: EditorConfig = (() => {
  const file = path.resolve(import.meta.dirname, "../../../docs/editor-config/yjshd.editor.config.json");
  const result = parseEditorConfig(readFileSync(file, "utf8"));
  if (!result.ok) throw new Error("config 오류");
  return result.config;
})();

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

const setup = (files: { path: string; content: string }[]) => {
  const repo = fakeGitRepo(REPO, "main", [...files, { path: "README.md", content: "# yjshd\n" }]);
  return { repo, client: createGitHubClient("ghu_token", repo.fetch) };
};

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

/** 원문을 metadata 블록 앞 · 블록 · 뒤로 나눈다. */
function splitAtMetadata(source: string) {
  const doc = parseMdx(source, config.syntax);
  if (!doc.ok) throw new Error(doc.message);
  const index = doc.head.findIndex((s) => s.kind === "metadata");
  const before = doc.head
    .slice(0, index)
    .map((s) => s.text)
    .join("");
  const block = doc.head[index]!.text;
  return { before, block, after: source.slice(before.length + block.length) };
}

const FORM = {
  title: "12월 휴진 안내",
  description: "12월 휴진을 알려 드립니다.",
  "other.createdAt": "2020-12-01T00:00",
  "other.status": "draft",
};

describe("saveMetadata", () => {
  test("제목·설명·날짜·상태를 바꿔 저장하면 커밋 1개에 metadata 블록만 바뀐다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();

    const result = await saveMetadata(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), values: FORM });

    expect(result).toEqual({ ok: true, commit: repo.head(), parent: before });
    expect(repo.log()).toHaveLength(2);
    expect(repo.log()[0]!.message).toBe("post: 12월 휴진 안내");
    expect(text(repo.file(POST))).toBe(`import image1 from "./1.png";

export const metadata = {
  title: "12월 휴진 안내",
  description: "12월 휴진을 알려 드립니다.",
  keywords: [],
  other: {
    status: "draft",
    createdAt: "2020-12-01T00:00:00Z",
  },
};

# 11월 휴진 안내

본문 <Image src={image1} alt="" />
`);
    expect(repo.paths()).toEqual(["README.md", POST]);
  });

  test("metadata를 저장해도 본문 영역의 key는 그대로라 고치던 본문이 남는다", async () => {
    const { client } = setup([{ path: POST, content: SOURCE }]);
    const before = (await readPost(client, REPO, config, POST))!;

    await saveMetadata(client, REPO, config, { path: POST, baseSha: before.sha, values: FORM });
    const after = (await readPost(client, REPO, config, POST))!;

    expect(after.sha).not.toBe(before.sha);
    expect(editorKeys(after).body).toBe(editorKeys(before).body);
    expect(editorKeys(after).metadata).not.toBe(editorKeys(before).metadata);
  });

  test("폼 값을 바꾸지 않았으면 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();
    const metadata = parseMetadata(splitAtMetadata(SOURCE).block);
    if (!metadata.editable) throw new Error(metadata.reason);
    const values = Object.fromEntries(
      buildForm(config.collections[0]!, metadata.value).map((field) => [field.key, field.initial]),
    );

    const result = await saveMetadata(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), values });

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(repo.head()).toBe(before);
  });

  test("폼을 연 뒤 다른 곳에서 글을 고쳤으면 저장하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const elsewhere = SOURCE.replace("본문", "다른 곳에서 고친 본문");
    repo.pushElsewhere([{ path: POST, content: elsewhere }]);
    const head = repo.head();

    const result = await saveMetadata(client, REPO, config, { path: POST, baseSha: blobSha(SOURCE), values: FORM });

    expect(result).toEqual({
      ok: false,
      reason: "changed",
      path: POST,
      expected: blobSha(SOURCE),
      actual: blobSha(elsewhere),
    });
    expect(repo.head()).toBe(head);
  });

  test("폼 값이 잘못되면 오류를 돌려주고 커밋하지 않는다", async () => {
    const { repo, client } = setup([{ path: POST, content: SOURCE }]);
    const before = repo.head();

    const result = await saveMetadata(client, REPO, config, {
      path: POST,
      baseSha: blobSha(SOURCE),
      values: { ...FORM, title: "", "other.status": "hidden" },
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { key: "title", message: "필수 항목이다" },
        { key: "other.status", message: "선택지에 없는 값이다: hidden" },
      ],
    });
    expect(repo.head()).toBe(before);
  });

  test("editable이 아닌 글은 저장하지 않는다", async () => {
    const source = `export const metadata = { title: TITLE };\n\n# 글\n`;
    const { repo, client } = setup([{ path: POST, content: source }]);
    const before = repo.head();

    const result = await saveMetadata(client, REPO, config, { path: POST, baseSha: blobSha(source), values: FORM });

    expect(result).toEqual({ ok: false, reason: "not-editable", message: "지원하지 않는 식: Identifier" });
    expect(repo.head()).toBe(before);
  });

  test("컬렉션에 없거나 없는 글이면 not-found", async () => {
    const { client } = setup([{ path: POST, content: SOURCE }]);
    for (const p of ["content/4.게시판/없는글/page.mdx", "README.md"]) {
      expect(await saveMetadata(client, REPO, config, { path: p, baseSha: "x", values: FORM })).toEqual({
        ok: false,
        reason: "not-found",
      });
    }
  });
});

const fixtures = loadFixtures("yjshd");
const board = fixtures?.filter((f) => f.path.startsWith("4.게시판/")) ?? [];

describe("yjshd 게시판 픽스처 전체", () => {
  test.skipIf(!fixtures)("게시판 글 47편", () => {
    expect(board).toHaveLength(47);
  });

  test.skipIf(!fixtures)(
    "제목·설명·날짜·상태를 폼으로 바꿔 저장하면 metadata 블록만 바뀌고 나머지 키는 보존된다",
    async () => {
      const failures: string[] = [];
      for (const fixture of board) {
        const filePath = `content/${fixture.path}`;
        const { repo, client } = setup([{ path: filePath, content: fixture.source }]);

        const result = await saveMetadata(client, REPO, config, {
          path: filePath,
          baseSha: blobSha(fixture.source),
          values: FORM,
        });
        if (!result.ok) {
          failures.push(`${fixture.path}: ${JSON.stringify(result)}`);
          continue;
        }
        const saved = text(repo.file(filePath));
        const original = splitAtMetadata(fixture.source);
        const next = splitAtMetadata(saved);
        if (next.before !== original.before || next.after !== original.after) {
          failures.push(`${fixture.path}: metadata 블록 밖이 바뀌었다`);
          continue;
        }

        const old = parseMetadata(original.block);
        const now = parseMetadata(next.block);
        if (!old.editable || !now.editable) throw new Error(fixture.path);
        const other = old.value.other as { [key: string]: MetadataValue };
        const expected = {
          ...old.value,
          title: FORM.title,
          description: FORM.description,
          // 날짜는 원래 형식(밀리초, Z)을 따른다.
          other: {
            ...other,
            status: "draft",
            createdAt: String(other.createdAt).replace(
              /^[\d-]+T[\d:]+(\.\d+)?/,
              (_, ms?: string) => "2020-12-01T00:00:00" + (ms ? "." + "0".repeat(ms.length - 1) : ""),
            ),
          },
        };
        expect(now.value, fixture.path).toEqual(expected);
        expect(Object.keys(now.value), fixture.path).toEqual(Object.keys(old.value));
        expect(repo.log(), fixture.path).toHaveLength(2);
      }
      expect(failures).toEqual([]);
    },
    60_000,
  );

  test.skipIf(!fixtures)("yjshd 모든 글을 폼 처음 값 그대로 저장하면 커밋하지 않는다", async () => {
    const changed: string[] = [];
    const covered: string[] = [];
    for (const fixture of fixtures ?? []) {
      const filePath = `content/${fixture.path}`;
      const found = findCollection(config, filePath);
      if (!found) continue;
      const { collection } = found;
      covered.push(fixture.path);
      const metadata = parseMetadata(splitAtMetadata(fixture.source).block);
      if (!metadata.editable) throw new Error(fixture.path);
      const values = Object.fromEntries(
        buildForm(collection, metadata.value)
          .filter((field) => !field.locked)
          .map((field) => [field.key, field.type === "text" ? field.initial.replaceAll("\n", "\r\n") : field.initial]),
      );
      const { client } = setup([{ path: filePath, content: fixture.source }]);
      const result = await saveMetadata(client, REPO, config, {
        path: filePath,
        baseSha: blobSha(fixture.source),
        values,
      });
      if (result.ok || result.reason !== "unchanged") changed.push(`${fixture.path}: ${JSON.stringify(result)}`);
    }
    expect(changed).toEqual([]);
    // 게시판 47 + 강좌 103. 소개·글모음과 강좌 바로 아래 글 1편은 config 예시의 컬렉션에 없다.
    expect(covered).toHaveLength(150);
  });
});
