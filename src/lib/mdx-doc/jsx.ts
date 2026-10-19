import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx";

export type JsxElement = MdxJsxFlowElement | MdxJsxTextElement;

/** 이름이 `name`인 속성의 값. 문자열(`a="1"`), 식(`a={x}`), 값 없음(`a`) 중 하나다. 속성이 없으면 `undefined`. */
export function attributeValue(node: JsxElement, name: string) {
  for (const attribute of node.attributes) {
    if (attribute.type === "mdxJsxAttribute" && attribute.name === name) return attribute.value;
  }
  return undefined;
}

export function stringAttribute(node: JsxElement, name: string): string | undefined {
  const value = attributeValue(node, name);
  return typeof value === "string" ? value : undefined;
}
