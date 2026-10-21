import { htmlTags } from "@mdxeditor/editor";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import { mdxjs } from "micromark-extension-mdxjs";

import { printJsxTag, type JsxElement, type Syntax } from "@/lib/mdx-doc";

/**
 * 일반 편집기가 JSX 요소로 그리는 순서(문서 순서, 바깥 요소가 먼저)로 본 `markdown`의 JSX 요소.
 * 편집기처럼 `<p>`·`<br />` 같은 HTML 요소는 JSX 요소로 그리지 않고(그 안의 요소는 그린다),
 * 편집기가 넘기는 요소처럼 원문 위치와 식의 구문 트리를 뺀다.
 */
export function editorElements(markdown: string, syntax: Syntax = {}): JsxElement[] {
  const found: JsxElement[] = [];
  const visit = (node: { type: string; name?: string | null; children?: object[] }) => {
    const jsx = node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
    if (jsx && !htmlTags.includes(node.name as (typeof htmlTags)[number])) found.push(strip(node as JsxElement));
    (node.children as { type: string }[] | undefined)?.forEach(visit);
  };
  visit(
    fromMarkdown(markdown, {
      extensions: [mdxjs(), ...(syntax.gfm ? [gfm()] : []), ...(syntax.math ? [math()] : [])],
      mdastExtensions: [
        mdxFromMarkdown(),
        ...(syntax.gfm ? [gfmFromMarkdown()] : []),
        ...(syntax.math ? [mathFromMarkdown()] : []),
      ],
    }),
  );
  return found;
}

/** 편집기가 그린 요소마다 그 요소와, 그린 요소 중 태그가 같은 것 가운데 몇 번째인지. 본문 사진이 이 값으로 항목을 찾는다. */
export function editorElementsAt(markdown: string, syntax: Syntax = {}): { element: JsxElement; nth: number }[] {
  const seen = new Map<string, number>();
  return editorElements(markdown, syntax).map((element) => {
    const tag = printJsxTag(element);
    const nth = seen.get(tag) ?? 0;
    seen.set(tag, nth + 1);
    return { element, nth };
  });
}

function strip({ type, name, attributes, children }: JsxElement): JsxElement {
  return {
    type,
    name,
    children,
    attributes: attributes.map((attribute) => {
      const { value } = attribute;
      if (attribute.type === "mdxJsxExpressionAttribute" || typeof value !== "object" || value === null) {
        return attribute;
      }
      return { ...attribute, value: { type: value.type, value: value.value } };
    }),
  } as JsxElement;
}
