import type { Expression, Program, SpreadElement } from "estree";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx";

import { escapeJsxAttribute } from "./images";

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

/** `a={식}` 속성의 식. 문자열이거나 값이 없거나 속성이 없으면 null. */
export function expressionAttribute(node: JsxElement, name: string): Expression | null {
  const value = attributeValue(node, name);
  if (typeof value !== "object" || value === null) return null;
  const statement = (value.data?.estree as Program | undefined)?.body[0];
  return statement?.type === "ExpressionStatement" ? statement.expression : null;
}

/** `ids={["1", "2"]}`처럼 배열 식인 속성의 원소. 배열 식이 아니면 null. */
export function arrayAttribute(node: JsxElement, name: string): (Expression | SpreadElement | null)[] | null {
  const expression = expressionAttribute(node, name);
  return expression?.type === "ArrayExpression" ? expression.elements : null;
}

/** 트리 안의 모든 JSX 요소. 코드 블록·문자열 안의 태그 모양 글자는 요소가 아니므로 들어가지 않는다. */
export function jsxElements(node: object): JsxElement[] {
  const found: JsxElement[] = [];
  const visit = (n: { type?: string; children?: object[] }) => {
    if (n.type === "mdxJsxFlowElement" || n.type === "mdxJsxTextElement") found.push(n as JsxElement);
    n.children?.forEach(visit);
  };
  visit(node);
  return found;
}

/**
 * 요소를 내용 없는 태그 원문(`<Image src={image1} alt="사진" />`)으로 쓴다. 다시 읽으면 속성 이름과 값이 같다.
 * 다만 여러 줄 식은 MDX가 태그 안 줄 앞 공백을 버려서 다시 읽으면 둘째 줄부터 들여쓰기가 빠질 수 있다.
 * 일반 편집기가 넘기는 요소는 원문 위치가 없어 원문을 잘라 올 수 없으므로 속성으로 다시 쓴다.
 */
export function printJsxTag(node: JsxElement): string {
  const attributes = node.attributes.map((attribute) => {
    if (attribute.type === "mdxJsxExpressionAttribute") return `{${attribute.value}}`;
    const { name, value } = attribute;
    if (value === null || value === undefined) return name;
    if (typeof value === "string") return `${name}="${escapeJsxAttribute(value)}"`;
    return `${name}={${value.value}}`;
  });
  return `<${[node.name ?? "", ...attributes].join(" ")} />`;
}
