import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { checkMdx } from "./check";
import { componentSnippet, insertSnippet } from "./snippet";
import type { Syntax } from "./split";

const blogSyntax: Syntax = { gfm: true, math: true };
const TEMPLATES = ["Footnote", "FootnoteRef", "Mermaid", "TOC", "Callout"];

describe("componentSnippet", () => {
  test("각주가 없는 글의 Footnote는 1번이고 문장 안에 넣는다", () => {
    expect(componentSnippet("Footnote", "# 제목\n\n문단\n")).toEqual({
      kind: "inline",
      text: '<Footnote id="1">1</Footnote>',
    });
  });

  test("Footnote 번호는 순서와 상관없이 가장 큰 id 다음이다", () => {
    const body = '가<Footnote id="3">3</Footnote> 나<Footnote id="7">7</Footnote> 다<Footnote id="3">3</Footnote>\n';
    expect(componentSnippet("Footnote", body).text).toBe('<Footnote id="8">8</Footnote>');
  });

  test("코드 블록과 문자열 안의 <Footnote 글자는 번호 계산에 들어가지 않는다", () => {
    const body = [
      '가<Footnote id="2">2</Footnote>',
      "",
      "```mdx",
      '<Footnote id="99">99</Footnote>',
      "```",
      "",
      '`<Footnote id="50">` 와 <Callout title={\'<Footnote id="70">\'} />',
      "",
    ].join("\n");
    expect(componentSnippet("Footnote", body).text).toBe('<Footnote id="3">3</Footnote>');
  });

  test("FootnoteRef 번호는 출처가 없는 Footnote id 중 가장 작은 수다", () => {
    const body = [
      '가<Footnote id="1">1</Footnote> 나<Footnote id="2">2</Footnote> 다<Footnote id="4">4</Footnote>',
      "",
      '<FootnoteRef ids={["1"]}>',
      "  출처",
      "</FootnoteRef>",
      "",
    ].join("\n");
    expect(componentSnippet("FootnoteRef", body)).toEqual({
      kind: "block",
      text: '<FootnoteRef ids={["2"]}>\n  출처\n</FootnoteRef>',
    });
  });

  test("모든 각주에 출처가 있으면 FootnoteRef 번호는 빈 문자열이다", () => {
    const body = '가<Footnote id="1">1</Footnote>\n\n<FootnoteRef ids={["1"]}>\n  출처\n</FootnoteRef>\n';
    expect(componentSnippet("FootnoteRef", body).text).toBe('<FootnoteRef ids={[""]}>\n  출처\n</FootnoteRef>');
  });

  test("Mermaid와 TOC는 렌더링에 필요한 속성을 채운 block 템플릿이다", () => {
    expect(componentSnippet("Mermaid", "")).toEqual({
      kind: "block",
      text: "<Mermaid chart={`\nflowchart TD\n    A[시작] --> B[끝]\n`} />",
    });
    expect(componentSnippet("TOC", "")).toEqual({ kind: "block", text: "<TOC items={toc} />" });
  });

  test("그 밖의 이름은 속성 없는 block 태그다", () => {
    expect(componentSnippet("Callout", "")).toEqual({ kind: "block", text: "<Callout />" });
  });

  test("읽을 수 없는 본문이면 각주가 없는 글로 보고 번호를 매긴다", () => {
    expect(componentSnippet("Footnote", '<Footnote id="5">\n').text).toBe('<Footnote id="1">1</Footnote>');
  });
});

describe("insertSnippet", () => {
  test("inline 템플릿은 선택 영역을 바꾸고 커서는 넣은 템플릿 뒤에 둔다", () => {
    const snippet = componentSnippet("Footnote", "");
    const result = insertSnippet("앞 선택 뒤\n", 2, 4, snippet);
    expect(result.source).toBe('앞 <Footnote id="1">1</Footnote> 뒤\n');
    expect(result.source.slice(0, result.cursor)).toBe('앞 <Footnote id="1">1</Footnote>');
  });

  test("문단 가운데에 block 템플릿을 넣으면 앞뒤가 빈 줄로 나뉜다", () => {
    const source = "첫 문장 둘째 문장\n";
    const result = insertSnippet(source, 5, 5, componentSnippet("TOC", source));
    expect(result.source).toBe("첫 문장 \n\n<TOC items={toc} />\n\n둘째 문장\n");
    expect(result.source.slice(0, result.cursor)).toBe("첫 문장 \n\n<TOC items={toc} />");
  });

  test("빈 줄 사이에 넣을 때는 줄바꿈을 더하지 않는다", () => {
    const source = "가\n\n\n\n나\n";
    const result = insertSnippet(source, 3, 3, componentSnippet("TOC", source));
    expect(result.source).toBe("가\n\n<TOC items={toc} />\n\n나\n");
  });

  test("줄 끝에 넣으면 모자란 줄바꿈만 더한다", () => {
    const source = "가\n나\n";
    const result = insertSnippet(source, 2, 2, componentSnippet("TOC", source));
    expect(result.source).toBe("가\n\n<TOC items={toc} />\n\n나\n");
  });

  test("글 맨 앞에는 앞 줄바꿈을 더하지 않고 글 끝에는 줄바꿈 하나로 끝낸다", () => {
    expect(insertSnippet("가\n", 0, 0, componentSnippet("TOC", "")).source).toBe("<TOC items={toc} />\n\n가\n");
    expect(insertSnippet("가", 1, 1, componentSnippet("TOC", "")).source).toBe("가\n\n<TOC items={toc} />\n");
  });

  test.each(TEMPLATES)("문단 가운데에 %s 템플릿을 넣은 결과가 컴파일된다", async (name) => {
    const source = '# 제목\n\n각주가 있는 문장<Footnote id="1">1</Footnote>과 이어지는 문장\n';
    const from = source.indexOf("과 이어지는");
    const result = insertSnippet(source, from, from, componentSnippet(name, source, blogSyntax));
    expect(await checkMdx(result.source, blogSyntax)).toEqual({ ok: true });
  });
});

describe("픽스처 각주 번호", () => {
  const blog = fixtureSources.find((source) => source.name === "blog")!;
  const eose = loadFixtures(blog.name)?.find((fixture) => fixture.path.startsWith("Research/EOSE/"));

  test.skipIf(!eose)("EOSE의 다음 Footnote는 70번이고 모든 각주에 출처가 있어 FootnoteRef 번호는 비어 있다", () => {
    expect(componentSnippet("Footnote", eose!.source, blog.syntax).text).toBe('<Footnote id="70">70</Footnote>');
    expect(componentSnippet("FootnoteRef", eose!.source, blog.syntax).text).toContain('ids={[""]}');
  });
});
