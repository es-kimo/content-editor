import { describe, expect, test } from "vitest";

import { parseMdx, readMetadata } from "@/lib/mdx-doc";
import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { listTitle, postTitle, summarizePost, trashedAtText } from "./summary";

describe("summarizePost", () => {
  test("title·status·createdAt을 읽는다", () => {
    const source = `export const metadata = {\n  title: "  공지  ",\n  other: { status: "draft", createdAt: "2021-01-01T00:00:00Z" },\n};\n\n본문\n`;
    expect(summarizePost(source, {}, "slug")).toEqual({
      title: "공지",
      titleFromMetadata: true,
      status: "draft",
      createdAt: "2021-01-01T00:00:00Z",
      trashed: false,
      trashedAt: null,
      problem: null,
    });
  });

  test("other.trashedAt이 있으면 휴지통 글로 읽고 삭제 시각을 보인다", () => {
    const source = `export const metadata = {\n  title: "공지",\n  other: { status: "draft", trashedAt: "2026-10-20T09:30:15Z" },\n};\n\n본문\n`;
    expect(summarizePost(source, {}, "slug")).toMatchObject({
      status: "draft",
      trashed: true,
      trashedAt: "2026-10-20T09:30:15Z",
    });
  });

  test("문자열이 아닌 값은 비어 있는 것으로 본다", () => {
    const source = `export const metadata = { title: 1, other: { status: ["ready"], createdAt: null } };\n`;
    expect(summarizePost(source, {}, "slug")).toMatchObject({
      title: "slug",
      titleFromMetadata: false,
      status: null,
      createdAt: null,
    });
  });

  test("other가 객체가 아니면 status·createdAt은 null", () => {
    const source = `export const metadata = { title: "a", other: "x" };\n`;
    expect(summarizePost(source, {}, "slug")).toMatchObject({ title: "a", status: null, createdAt: null });
  });

  test("metadata가 없거나 읽을 수 없으면 파일명을 title로 쓰고 이유를 남긴다", () => {
    expect(summarizePost("# 본문\n", {}, "slug")).toMatchObject({ title: "slug", problem: "metadata export가 없다" });
    const unreadable = summarizePost("export const metadata = { title: foo };\n", {}, "slug");
    expect(unreadable).toMatchObject({ title: "slug", titleFromMetadata: false });
    expect(unreadable.problem).toEqual(expect.any(String));
    expect(unreadable.problem).not.toBe("metadata export가 없다");
  });

  test("site 문법을 따른다: math 없이 읽으면 실패하는 글도 math를 켜면 읽는다", () => {
    const source = `export const metadata = { title: "수식" };\n\n$$\n\\frac{a}{b}\n$$\n\n$x_{1}$\n`;
    expect(summarizePost(source, { math: true }, "slug")).toMatchObject({ title: "수식", titleFromMetadata: true });
  });
});

describe("postTitle", () => {
  const metadataOf = (source: string) => {
    const doc = parseMdx(source, {});
    if (!doc.ok) throw new Error(doc.message);
    return readMetadata(doc);
  };

  test("저장된 제목을 앞뒤 공백 없이 화면 제목으로 쓴다", () => {
    expect(postTitle(metadataOf(`export const metadata = { title: "  공지  " };\n`))).toBe("공지");
  });

  test("제목이 비었거나 없거나 읽을 수 없으면 '제목 없는 글'이다", () => {
    expect(postTitle(metadataOf(`export const metadata = { title: "  " };\n`))).toBe("제목 없는 글");
    expect(postTitle(metadataOf(`export const metadata = { other: {} };\n`))).toBe("제목 없는 글");
    expect(postTitle(metadataOf(`export const metadata = { title: foo };\n`))).toBe("제목 없는 글");
    expect(postTitle(metadataOf("# 본문\n"))).toBe("제목 없는 글");
  });
});

describe("listTitle", () => {
  test("metadata에서 읽은 제목을 쓰고, 읽지 못하면 파일명 대신 '제목 없는 글'이다", () => {
    expect(listTitle(summarizePost(`export const metadata = { title: "공지" };\n`, {}, "slug"))).toBe("공지");
    expect(listTitle(summarizePost(`export const metadata = { title: "" };\n`, {}, "slug"))).toBe("제목 없는 글");
    expect(listTitle(summarizePost("# 본문\n", {}, "slug"))).toBe("제목 없는 글");
  });
});

describe("trashedAtText", () => {
  test("삭제 시각을 분까지 한국 시각으로 보인다", () => {
    expect(trashedAtText("2026-10-20T09:30:15Z")).toBe("2026-10-20 18:30");
    expect(trashedAtText("2026-10-20T20:05:00Z")).toBe("2026-10-21 05:05");
  });

  test("삭제 시각이 없거나 시각으로 읽을 수 없으면 ‘-’다", () => {
    expect(trashedAtText(null)).toBe("-");
    expect(trashedAtText("어제")).toBe("-");
  });
});

describe.each(fixtureSources)("summarizePost: $name 픽스처", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("모든 글에서 metadata의 title을 읽는다", () => {
    const failed = fixtures!
      .map((f) => ({ path: f.path, summary: summarizePost(f.source, source.syntax, "fallback") }))
      .filter(({ summary }) => !summary.titleFromMetadata)
      .map(({ path, summary }) => [path, summary.problem]);
    expect(failed).toEqual([]);
  });
});
