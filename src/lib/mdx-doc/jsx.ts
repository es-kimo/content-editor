import type { Expression, Program, SpreadElement } from "estree";
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
