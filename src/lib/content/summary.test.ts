import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { summarizePost } from "./summary";

describe("summarizePost", () => {
  test("title·status·createdAt을 읽는다", () => {
    const source = `export const metadata = {\n  title: "  공지  ",\n  other: { status: "draft", createdAt: "2021-01-01T00:00:00Z" },\n};\n\n본문\n`;
    expect(summarizePost(source, {}, "slug")).toEqual({
      title: "공지",
      titleFromMetadata: true,
      status: "draft",
      createdAt: "2021-01-01T00:00:00Z",
      problem: null,
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

  test("site 문법을 따른다: math 없이 읽으면 실패하는 글도 math를 켜면 읽는다", () => {
    const source = `export const metadata = { title: "수식" };\n\n$$\n\\frac{a}{b}\n$$\n\n$x_{1}$\n`;
    expect(summarizePost(source, { math: true }, "slug")).toMatchObject({ title: "수식", titleFromMetadata: true });
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
