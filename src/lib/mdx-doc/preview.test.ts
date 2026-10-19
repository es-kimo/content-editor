import { toHtml } from "hast-util-to-html";
import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { previewMdx, type PreviewImages } from "./preview";
import { parseMarkdown, type Syntax } from "./split";

/** 글에 쓴 JSX 컴포넌트 이름. `<>…</>`는 뺀다. */
function componentNames(node: object): Set<string> {
  const names = new Set<string>();
  const visit = (n: { type?: string; name?: string | null; children?: object[] }) => {
    if ((n.type === "mdxJsxFlowElement" || n.type === "mdxJsxTextElement") && n.name) names.add(n.name);
    n.children?.forEach(visit);
  };
  visit(node);
  return names;
}

function html(source: string, syntax?: Syntax, images?: PreviewImages): string {
  const preview = previewMdx(source, syntax, images);
  if (!preview.ok) throw new Error(preview.message);
  return toHtml(preview.tree, { characterReferences: { useNamedReferences: true } });
}

describe("previewMdx", () => {
  test("마크다운 본문을 HTML로 그린다", () => {
    const out = html("# 제목\n\n**굵게** 문장과 [링크](https://a.com)\n\n- 하나\n- 둘\n\n> 인용\n\n---\n");
    expect(out).toContain("<h1>제목</h1>");
    expect(out).toContain('<p><strong>굵게</strong> 문장과 <a href="https://a.com">링크</a></p>');
    expect(out).toContain("<li>하나</li>");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("<hr>");
  });

  test("파일 전체를 넘기면 import와 metadata는 보이지 않고 본문만 그린다", () => {
    const source = 'import image1 from "./1.png";\n\nexport const metadata = { title: "공지" };\n\n# 본문\n';
    const out = html(source);
    expect(out).toBe("<h1>본문</h1>");
  });

  test("컴포넌트는 이름과 속성을 적은 자리 표시로 그리고 children은 그 안에 그린다", () => {
    const out = html('<Callout type="info" open count={3} {...rest}>\n  안의 **글**\n</Callout>\n');
    expect(out).toContain('data-component="Callout"');
    expect(out).toContain('&lt;Callout type="info" open count={3} {...rest}>');
    expect(out).toContain("<strong>글</strong>");
  });

  test("문장 안의 컴포넌트도 자리 표시로 그린다", () => {
    const out = html("작성일 <PostDate>2025-03-28</PostDate> 기준\n");
    expect(out).toMatch(
      /<p>작성일 <span class="mdx-component" data-component="PostDate">.*2025-03-28<\/span> 기준<\/p>/,
    );
  });

  test("src 변수가 images에 있는 컴포넌트는 그 주소의 그림으로 그린다", () => {
    const out = html('<Image src={image1} alt="새 장비" />\n', {}, { image1: "blob:http://localhost/1" });
    expect(out).toContain('<img src="blob:http://localhost/1" alt="새 장비">');
    expect(out).not.toContain("mdx-component");
  });

  test("images에 없는 이미지는 자리 표시로 남긴다", () => {
    const out = html('<Image src={image2} alt="옛 사진" />\n', {}, { image1: "blob:1" });
    expect(out).not.toContain("<img");
    expect(out).toContain('&lt;Image src={image2} alt="옛 사진">');
  });

  test("중괄호 식은 원문 그대로 자리 표시로 보인다", () => {
    expect(html("값은 {1 + 2} 이다\n")).toContain('<span class="mdx-expression">{1 + 2}</span>');
  });

  test("gfm을 켜면 표를 그린다", () => {
    expect(html("| a | b |\n| - | - |\n| 1 | 2 |\n", { gfm: true })).toContain("<td>1</td>");
  });

  test("문법 오류는 throw하지 않고 실패로 돌려준다", () => {
    expect(previewMdx("<div>닫히지 않음\n").ok).toBe(false);
  });

  test("HTML 속성으로 스크립트를 넣을 수 없다", () => {
    expect(html("[a](javascript:alert(1))\n")).not.toContain("javascript:");
  });
});

describe("yjshd 공지 미리보기", () => {
  const notice = loadFixtures("yjshd")?.find((f) => f.path.includes("2026년 1월 휴진 안내"));

  test.skipIf(!notice)("metadata 없이 제목과 문단만 사이트처럼 그린다", () => {
    const out = html(notice!.source);
    expect(out).toMatch(/^<h1>2026년 1월 휴진 안내<\/h1>\s*<p>안녕하세요.<\/p>/);
    expect(out.match(/<p>/g)).toHaveLength(6);
    expect(out).toContain("<p>연세정성내과 원장 류동열 배상</p>");
  });
});

describe.each(fixtureSources)("픽스처 미리보기: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("모든 글을 그리고 글에 쓴 컴포넌트는 모두 자리 표시로 보인다", () => {
    const failures: string[] = [];
    for (const f of fixtures!) {
      const out = html(f.source, source.syntax);
      const used = componentNames(parseMarkdown(f.source, source.syntax));
      const missing = [...used].filter((name) => !out.includes(`data-component="${name}"`));
      if (missing.length > 0) failures.push(`${f.path}: ${missing.join(", ")}`);
      if (out.includes("export const metadata")) failures.push(`${f.path}: metadata가 보인다`);
    }
    expect(failures).toEqual([]);
    expect(fixtures!.length).toBe(source.expected);
  });
});
