import { describe, expect, test } from "vitest";

import { compilePathPattern, PathPatternError, patternsOverlap } from "./path-pattern";

describe("compilePathPattern", () => {
  test("{slug}만 있는 패턴: prefix, match, build", () => {
    const p = compilePathPattern("content/4.게시판/{slug}/page.mdx");
    expect(p.prefix).toBe("content/4.게시판");
    expect(p.match("content/4.게시판/6월 휴진 안내/page.mdx")).toEqual({ slug: "6월 휴진 안내" });
    expect(p.build({ slug: "새 공지" })).toBe("content/4.게시판/새 공지/page.mdx");
  });

  test("{submenu}는 하위 메뉴 한 단계를 받는다", () => {
    const p = compilePathPattern("content/3.강좌/{submenu}/{slug}/page.mdx");
    expect(p.prefix).toBe("content/3.강좌");
    expect(p.match("content/3.강좌/3.혈액투석 1,2,3/투석환자의 우울증/page.mdx")).toEqual({
      submenu: "3.혈액투석 1,2,3",
      slug: "투석환자의 우울증",
    });
    expect(p.build({ submenu: "2.콩팥질환 정보", slug: "a" })).toBe("content/3.강좌/2.콩팥질환 정보/a/page.mdx");
  });

  test("패턴 첫 단계부터 자리표시자면 prefix는 빈 문자열", () => {
    expect(compilePathPattern("{submenu}/{slug}/page.mdx").prefix).toBe("");
  });

  test.each([
    ["단계 수가 다르다", "content/3.강좌/1.동영상 강의/page.mdx"],
    ["고정 단계가 다르다", "content/4.게시판x/a/page.mdx"],
    ["파일 이름이 다르다", "content/3.강좌/a/b/index.mdx"],
    ["이미지 파일", "content/3.강좌/a/b/1.png"],
  ])("맞지 않는 경로는 null: %s", (_, file) => {
    expect(compilePathPattern("content/3.강좌/{submenu}/{slug}/page.mdx").match(file)).toBeNull();
  });

  test("자리표시자 자리에 `..`나 빈 단계가 오면 맞지 않는다", () => {
    const p = compilePathPattern("content/{slug}/page.mdx");
    expect(p.match("content/../page.mdx")).toBeNull();
    expect(p.match("content//page.mdx")).toBeNull();
  });

  test.each([
    [{ submenu: "m", slug: "a/b" }, "{slug}"],
    [{ submenu: "m", slug: ".." }, "{slug}"],
    [{ submenu: "m", slug: "" }, "{slug}"],
    [{ slug: "a" }, "{submenu}"],
  ])("경로 한 단계로 쓸 수 없는 값이면 build가 실패한다: %j", (params, name) => {
    const p = compilePathPattern("content/{submenu}/{slug}/page.mdx");
    expect(() => p.build(params)).toThrow(name);
  });

  test.each([
    ["", "비어 있다"],
    ["/content/{slug}/page.mdx", "상대 경로"],
    ["content\\{slug}\\page.mdx", "`/`만"],
    ["content//{slug}/page.mdx", "2번째 단계가 비어 있다"],
    ["content/{slug}/page.mdx/", "4번째 단계가 비어 있다"],
    ["content/../{slug}/page.mdx", "`..`"],
    ["content/{id}/page.mdx", "알 수 없는 자리표시자 {id}"],
    ["content/post-{slug}/page.mdx", "한 단계 전체"],
    ["content/page.mdx", "{slug}가 정확히 한 번"],
    ["{slug}/{slug}/page.mdx", "{slug}가 정확히 한 번"],
    ["{submenu}/{submenu}/{slug}/page.mdx", "{submenu}는 한 번만"],
    ["content/{slug}/page.md", "`.mdx` 파일 이름"],
    ["content/{slug}", "`.mdx` 파일 이름"],
    ["content/{slug}/{submenu}/page.mdx", "바로 앞 단계가 {slug}"],
    ["{slug}/posts/page.mdx", "바로 앞 단계가 {slug}"],
  ])("잘못된 패턴은 이유와 함께 거부한다: %s", (pattern, message) => {
    expect(() => compilePathPattern(pattern)).toThrow(PathPatternError);
    expect(() => compilePathPattern(pattern)).toThrow(message);
  });
});

describe("patternsOverlap", () => {
  test.each([
    ["content/a/{slug}/page.mdx", "content/a/{slug}/page.mdx", true],
    ["content/a/{slug}/page.mdx", "content/{submenu}/{slug}/page.mdx", true],
    ["content/a/{slug}/page.mdx", "content/b/{slug}/page.mdx", false],
    ["content/{slug}/page.mdx", "content/{submenu}/{slug}/page.mdx", false],
    ["content/a/{slug}/page.mdx", "content/a/{slug}/index.mdx", false],
  ])("%s · %s → %s", (a, b, expected) => {
    expect(patternsOverlap(a, b)).toBe(expected);
    expect(patternsOverlap(b, a)).toBe(expected);
  });
});
