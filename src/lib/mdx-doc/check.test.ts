import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { checkMdx } from "./check";

describe("checkMdx", () => {
  test("올바른 MDX는 통과한다", async () => {
    expect(await checkMdx("# 제목\n\n<div>본문</div>\n")).toEqual({ ok: true });
  });

  test("닫히지 않은 태그는 줄/열과 함께 실패한다", async () => {
    const result = await checkMdx("# 제목\n\n<div>본문\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("closing tag");
    expect(result.error.line).toBe(3);
    expect(result.error.column).toBe(1);
  });

  test("잘못된 중괄호 표현식은 위치와 함께 실패한다", async () => {
    const result = await checkMdx("첫 줄\n\n문장 {1 +} 끝\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.line).toBe(3);
    expect(result.error.column).toEqual(expect.any(Number));
  });

  test("닫히지 않은 중괄호는 실패한다", async () => {
    const result = await checkMdx("문장 {abc\n");
    expect(result.ok).toBe(false);
  });

  test("syntax 옵션에 따라 math 문법이 달라진다", async () => {
    const source = "수식 $x^{1 +}$ 입니다\n";
    expect((await checkMdx(source)).ok).toBe(false);
    expect(await checkMdx(source, { math: true })).toEqual({ ok: true });
  });

  test("gfm 표와 취소선은 통과한다", async () => {
    const source = "~~취소~~\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(await checkMdx(source, { gfm: true })).toEqual({ ok: true });
  });
});

describe.each(fixtureSources)("픽스처 컴파일 검사: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("모든 글이 통과한다", async () => {
    const failures: string[] = [];
    for (const f of fixtures!) {
      const result = await checkMdx(f.source, source.syntax);
      if (!result.ok) failures.push(`${f.path}: ${result.error.line}:${result.error.column} ${result.error.message}`);
    }
    expect(failures).toEqual([]);
    expect(fixtures!.length).toBe(source.expected);
  });
});
