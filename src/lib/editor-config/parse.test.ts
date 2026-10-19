import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { parseMdx, parseMetadata, type MetadataValue } from "@/lib/mdx-doc";
import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { formatConfigIssues, parseEditorConfig, validateEditorConfig, type ConfigResult } from "./parse";
import { compilePathPattern } from "./path-pattern";
import type { EditorConfig, MetadataField } from "./schema";

const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../../../docs/editor-config");
const readExample = (site: string) => readFileSync(path.join(EXAMPLES_DIR, `${site}.editor.config.json`), "utf8");

function okConfig(result: ConfigResult): EditorConfig {
  if (!result.ok) throw new Error(formatConfigIssues(result.issues));
  return result.config;
}

const minimal = {
  branch: "main",
  collections: [{ name: "게시판", path: "content/{slug}/page.mdx", editor: "wysiwyg" }],
};

/** minimal을 바탕으로 collections[0]만 바꾼 config의 검증 오류. */
const collectionIssues = (patch: Record<string, unknown>) => {
  const result = validateEditorConfig({ ...minimal, collections: [{ ...minimal.collections[0], ...patch }] });
  return result.ok ? [] : result.issues;
};

describe("예시 config", () => {
  test.each(["blog", "yjshd"])("%s 예시가 검증을 통과한다", (site) => {
    expect(parseEditorConfig(readExample(site))).toMatchObject({ ok: true });
  });

  test.each(fixtureSources)("$name 예시의 syntax가 픽스처 설정과 같다", (source) => {
    const config = okConfig(parseEditorConfig(readExample(source.name)));
    expect(config.syntax).toEqual({ gfm: false, math: false, ...source.syntax });
  });
});

/** 점으로 이은 키의 값을 꺼낸다. */
function getPath(value: MetadataValue, key: string): MetadataValue | undefined {
  let current: MetadataValue | undefined = value;
  for (const part of key.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = Object.hasOwn(current, part) ? current[part] : undefined;
  }
  return current;
}

function fieldProblem(field: MetadataField, value: MetadataValue | undefined): string | null {
  if (value === undefined) return field.required ? "필수 값이 없다" : null;
  switch (field.type) {
    case "string":
    case "text":
      return typeof value === "string" ? null : "문자열이 아니다";
    case "datetime":
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? null : "날짜가 아니다";
    case "string[]":
      return Array.isArray(value) && value.every((v) => typeof v === "string") ? null : "문자열 배열이 아니다";
    case "select":
      return typeof value === "string" && field.options.includes(value) ? null : `options에 없다: ${value}`;
  }
}

// 예시 config가 실제 글과 맞는지 본다. 컬렉션별 글 수는 fixtures.config.json의 ref 기준이다.
const expectedCounts: Record<string, Record<string, number>> = {
  blog: { 글: 14 },
  yjshd: { 게시판: 47, 강좌: 103 },
};

describe.each(fixtureSources)("예시 config와 픽스처: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("컬렉션 path에 맞는 글 수와 metadata 값이 필드 정의와 맞는다", () => {
    const config = okConfig(parseEditorConfig(readExample(source.name)));
    const counts: Record<string, number> = {};
    const problems: string[] = [];
    for (const collection of config.collections) {
      const pattern = compilePathPattern(collection.path);
      const posts = fixtures!.filter((f) => pattern.match(`${source.root}/${f.path}`));
      counts[collection.name] = posts.length;
      for (const post of posts) {
        const doc = parseMdx(post.source, config.syntax);
        const text = doc.ok ? doc.head.find((s) => s.kind === "metadata")?.text : undefined;
        const metadata = text ? parseMetadata(text) : null;
        if (!metadata?.editable) {
          problems.push(`${post.path}: metadata를 읽지 못했다`);
          continue;
        }
        for (const [key, field] of Object.entries(collection.metadata)) {
          const problem = fieldProblem(field, getPath(metadata.value, key));
          if (problem) problems.push(`${post.path} ${key}: ${problem}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(counts).toEqual(expectedCounts[source.name]);
  });
});

describe("parseEditorConfig", () => {
  test("생략한 syntax, metadata, components에 기본값을 채운다", () => {
    expect(okConfig(validateEditorConfig(minimal))).toEqual({
      branch: "main",
      syntax: { gfm: false, math: false },
      collections: [
        { name: "게시판", path: "content/{slug}/page.mdx", metadata: {}, components: [], editor: "wysiwyg" },
      ],
    });
  });

  test("JSON 문법 오류는 파일 전체 오류로 알린다", () => {
    const result = parseEditorConfig('{ "branch": "main", }');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues).toEqual([{ path: "", message: expect.stringMatching(/^JSON 문법 오류: /) }]);
  });

  test("최상위가 객체가 아니면 타입을 알린다", () => {
    expect(parseEditorConfig("[]")).toEqual({
      ok: false,
      issues: [{ path: "", message: "객체 타입이어야 한다 (받은 값: 배열)" }],
    });
  });

  test("필수 항목이 빠지면 항목 이름을 경로로 알린다", () => {
    expect(validateEditorConfig({})).toEqual({
      ok: false,
      issues: [
        { path: "branch", message: "필수 항목이 없다" },
        { path: "collections", message: "필수 항목이 없다" },
      ],
    });
  });

  test("알 수 없는 키는 키마다 경로로 알린다 (오타 방지)", () => {
    const result = validateEditorConfig({ ...minimal, colections: [], syntax: { gfm: true, mdx: true } });
    expect(!result.ok && result.issues).toEqual([
      { path: "syntax.mdx", message: "알 수 없는 키다" },
      { path: "colections", message: "알 수 없는 키다" },
    ]);
  });

  test("collections가 비어 있으면 거부한다", () => {
    const result = validateEditorConfig({ ...minimal, collections: [] });
    expect(!result.ok && result.issues).toEqual([{ path: "collections", message: "1개 이상 있어야 한다" }]);
  });

  test("타입이 틀린 값은 기대 타입과 받은 타입을 알린다", () => {
    const result = validateEditorConfig({ ...minimal, branch: 1, syntax: { math: "yes" } });
    expect(!result.ok && result.issues).toEqual([
      { path: "branch", message: "문자열 타입이어야 한다 (받은 값: 숫자)" },
      { path: "syntax.math", message: "true/false 타입이어야 한다 (받은 값: 문자열)" },
    ]);
  });

  test("브랜치 이름으로 쓸 수 없는 값을 거부한다", () => {
    for (const branch of ["", " ", "my branch", "a..b~1"]) {
      const result = validateEditorConfig({ ...minimal, branch });
      expect(result.ok, branch).toBe(false);
    }
  });

  test("editor는 정해진 값 중 하나여야 한다", () => {
    expect(collectionIssues({ editor: "markdown" })).toEqual([
      { path: "collections[0].editor", message: '"wysiwyg", "source" 중 하나여야 한다 (받은 값: "markdown")' },
    ]);
  });

  test("path 패턴 오류는 이유를 담아 path 위치로 알린다", () => {
    expect(collectionIssues({ path: "content/{id}/page.mdx" })).toEqual([
      {
        path: "collections[0].path",
        message: "알 수 없는 자리표시자 {id}. 쓸 수 있는 것: {slug}, {submenu}",
      },
    ]);
  });

  test("metadata 필드의 type이 틀리거나 없으면 쓸 수 있는 type을 알린다", () => {
    expect(collectionIssues({ metadata: { title: { type: "date" }, "other.status": {} } })).toEqual([
      {
        path: "collections[0].metadata.title.type",
        message: '"string", "text", "datetime", "string[]", "select" 중 하나여야 한다 (받은 값: "date")',
      },
      {
        path: 'collections[0].metadata["other.status"].type',
        message: '필수 항목이 없다. "string", "text", "datetime", "string[]", "select" 중 하나',
      },
    ]);
  });

  test("select는 비지 않고 겹치지 않는 options가 필요하다", () => {
    expect(
      collectionIssues({
        metadata: {
          a: { type: "select" },
          b: { type: "select", options: [] },
          c: { type: "select", options: ["x", "x"] },
        },
      }),
    ).toEqual([
      { path: "collections[0].metadata.a.options", message: "필수 항목이 없다" },
      { path: "collections[0].metadata.b.options", message: "1개 이상 있어야 한다" },
      { path: "collections[0].metadata.c.options[1]", message: "앞에 같은 값이 있다" },
    ]);
  });

  test("select가 아닌 필드의 options는 알 수 없는 키다", () => {
    expect(collectionIssues({ metadata: { title: { type: "string", options: ["a"] } } })).toEqual([
      { path: "collections[0].metadata.title.options", message: "알 수 없는 키다" },
    ]);
  });

  test("metadata 키는 점으로 이은 식별자여야 하고, 부모 키와 함께 둘 수 없다", () => {
    expect(
      collectionIssues({
        metadata: { "other.": { type: "string" }, other: { type: "string" }, "other.status": { type: "string" } },
      }),
    ).toEqual([
      {
        path: 'collections[0].metadata["other."]',
        message: "키는 `.`으로 이은 JS 식별자여야 한다 (예: title, other.createdAt)",
      },
      {
        path: 'collections[0].metadata["other.status"]',
        message: '"other" 안의 키라 "other"와 함께 정의할 수 없다',
      },
    ]);
  });

  test("components는 대문자로 시작하는 겹치지 않는 이름이어야 한다", () => {
    expect(collectionIssues({ components: ["Image", "image", "Image"] })).toEqual([
      { path: "collections[0].components[1]", message: "대문자로 시작하는 JSX 컴포넌트 이름이어야 한다 (예: Image)" },
      { path: "collections[0].components[2]", message: "앞에 같은 값이 있다" },
    ]);
  });

  test("컬렉션 이름이 겹치거나 path가 같은 파일에 맞을 수 있으면 뒤 컬렉션에서 알린다", () => {
    const result = validateEditorConfig({
      ...minimal,
      collections: [
        { name: "강좌", path: "content/{submenu}/{slug}/page.mdx", editor: "wysiwyg" },
        { name: "게시판", path: "content/4.게시판/{slug}/page.mdx", editor: "wysiwyg" },
        { name: "강좌", path: "content/3.강좌/{slug}/page.mdx", editor: "source" },
      ],
    });
    expect(!result.ok && result.issues).toEqual([
      {
        path: "collections[1].path",
        message: 'collections[0]의 path("content/{submenu}/{slug}/page.mdx")와 같은 파일에 맞을 수 있다',
      },
      { path: "collections[2].name", message: "collections[0]의 name과 같다" },
      {
        path: "collections[2].path",
        message: 'collections[0]의 path("content/{submenu}/{slug}/page.mdx")와 같은 파일에 맞을 수 있다',
      },
    ]);
  });

  test("formatConfigIssues는 한 줄에 경로와 메시지를 하나씩 쓴다", () => {
    expect(
      formatConfigIssues([
        { path: "", message: "JSON 문법 오류: x" },
        { path: "collections[0].editor", message: "필수 항목이 없다" },
      ]),
    ).toBe("JSON 문법 오류: x\ncollections[0].editor: 필수 항목이 없다");
  });
});
