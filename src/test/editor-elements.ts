import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import { mdxjs } from "micromark-extension-mdxjs";

import type { JsxElement, Syntax } from "@/lib/mdx-doc";

/**
 * 일반 편집기가 그리는 순서(문서 순서, 바깥 요소가 먼저)로 본 `markdown`의 JSX 요소.
 * 편집기가 넘기는 요소처럼 원문 위치와 식의 구문 트리를 뺀다.
 */
export function editorElements(markdown: string, syntax: Syntax = {}): JsxElement[] {
  const found: JsxElement[] = [];
  const visit = (node: { type: string; children?: object[] }) => {
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") found.push(strip(node as JsxElement));
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
