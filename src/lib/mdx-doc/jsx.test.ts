import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { readInserts } from "./inserts";
import { jsxElements, printJsxTag, readJsxTags, type JsxElement } from "./jsx";
import { parseMarkdown, type Syntax } from "./split";

/** 여러 줄 식은 태그 안 줄 앞 공백이 빠지므로(`printJsxTag`) 그 공백을 빼고 비교한다. */
const expression = (value: string) => value.replace(/\n[ \t]+/g, "\n");

/** 비교할 속성. 원문 위치와 식의 구문 트리는 다시 쓰면 달라지므로 이름과 값만 본다. */
const attributesOf = (element: JsxElement) =>
  element.attributes.map((attribute) => {
    if (attribute.type === "mdxJsxExpressionAttribute") return { spread: expression(attribute.value) };
    const { name, value } = attribute;
    return {
      name,
      value: typeof value === "object" && value !== null ? { expression: expression(value.value) } : value,
    };
  });

const elementsOf = (source: string, syntax: Syntax = {}) => jsxElements(parseMarkdown(source, syntax));

const reread = (element: JsxElement, syntax: Syntax = {}) => {
  const [again] = elementsOf(printJsxTag(element), syntax);
  return again && { name: again.name, attributes: attributesOf(again) };
};

describe("printJsxTag", () => {
  test("문자열·식·값 없는 속성과 펼친 속성을 원문 꼴로 쓴다", () => {
    const [element] = elementsOf('<Image src={image1} alt="병원 입구" priority {...rest} />');
    expect(printJsxTag(element!)).toBe('<Image src={image1} alt="병원 입구" priority {...rest} />');
  });

  test("따옴표와 &가 든 문자열은 다시 읽으면 같은 값이 되게 쓴다", () => {
    const [element] = elementsOf('<Image src={a} alt="&quot;큰따옴표&quot; &amp; 그림" />');
    expect(attributesOf(element!)).toContainEqual({ name: "alt", value: '"큰따옴표" & 그림' });
    expect(reread(element!)).toEqual({ name: "Image", attributes: attributesOf(element!) });
  });

  test("내용이 있는 요소도 내용 없이 여는 태그의 속성만 쓴다", () => {
    const [element] = elementsOf('<Figure src={a} caption="설명">\n  안의 글\n</Figure>');
    expect(printJsxTag(element!)).toBe('<Figure src={a} caption="설명" />');
  });
});

describe("readJsxTags", () => {
  test("본문의 JSX 요소를 문서 순서로 위치·태그와 함께 읽고, 바깥 요소가 안쪽 요소보다 먼저다", () => {
    const source = [
      '<Image src={image1} alt="a" />',
      "",
      '<Callout>\n  <Image src={image1} alt="b" />\n</Callout>',
      "",
      '문장<Footnote id="1">각주</Footnote>',
      "",
    ].join("\n");
    const tags = readJsxTags(source);
    expect(tags?.map(({ tag }) => tag)).toEqual([
      '<Image src={image1} alt="a" />',
      "<Callout />",
      '<Image src={image1} alt="b" />',
      '<Footnote id="1" />',
    ]);
    expect(tags?.map(({ from, to }) => source.slice(from, to))).toEqual([
      '<Image src={image1} alt="a" />',
      '<Callout>\n  <Image src={image1} alt="b" />\n</Callout>',
      '<Image src={image1} alt="b" />',
      '<Footnote id="1">각주</Footnote>',
    ]);
  });

  test("코드 블록 안의 태그 모양 글자는 요소가 아니고, 읽을 수 없는 원문은 null이다", () => {
    expect(readJsxTags("```\n<Image src={a} />\n```\n")).toEqual([]);
    expect(readJsxTags("<Image src={a} \n")).toBeNull();
  });
});

describe.each(fixtureSources)("픽스처 JSX 요소 목록: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("모든 삽입 항목은 같은 위치의 JSX 요소로 목록에 있다", () => {
    const missing: string[] = [];
    let total = 0;
    for (const f of fixtures!) {
      const list = readInserts(f.source, source.syntax);
      const tags = readJsxTags(f.source, source.syntax);
      if (!list.ok || !tags) continue;
      const spans = new Set(tags.map(({ from, to }) => `${from}-${to}`));
      for (const entry of [...list.items, ...list.limited]) {
        total += 1;
        if (!spans.has(`${entry.from}-${entry.to}`)) missing.push(`${f.path}@${entry.from}`);
      }
    }
    expect(missing).toEqual([]);
    expect(total).toBeGreaterThan(0);
  });
});

describe.each(fixtureSources)("픽스처 태그 다시 쓰기: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("모든 글의 모든 요소를 다시 쓰고 읽으면 이름과 속성이 같다", () => {
    const wrong: string[] = [];
    let total = 0;
    for (const f of fixtures!) {
      for (const element of elementsOf(f.source, source.syntax)) {
        total += 1;
        const expected = { name: element.name, attributes: attributesOf(element) };
        if (JSON.stringify(reread(element, source.syntax)) !== JSON.stringify(expected)) {
          wrong.push(`${f.path}: ${printJsxTag(element)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(total).toBeGreaterThan(0);
  });
});
