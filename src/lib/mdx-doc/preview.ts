import type { Element, ElementContent, Root, RootContent } from "hast";
import type { MdxFlowExpression, MdxJsxFlowElement, MdxJsxTextElement, MdxTextExpression } from "mdast-util-mdx";
import { toHast, type State } from "mdast-util-to-hast";

import { parseMarkdown, type Syntax } from "./split";

/** 미리보기에서 실제 그림으로 보일 이미지. import 변수명 → 이미지 주소. */
export type PreviewImages = { [name: string]: string };

export type MdxPreview = { ok: true; tree: Root } | { ok: false; message: string };

// 화면(globals.css)이 이 class로 자리 표시를 꾸민다.
const PREVIEW_COMPONENT_CLASS = "mdx-component";
const PREVIEW_EXPRESSION_CLASS = "mdx-expression";

/**
 * MDX 원문(본문만이거나 파일 전체)을 미리보기용 HTML 트리로 만든다. import·export는 보이지 않는다.
 * 사이트의 컴포넌트는 에디터에 없으므로 이름과 속성만 보이는 자리 표시로 두고 children은 그 안에 그린다.
 * `src={변수}`가 `images`에 있는 컴포넌트는 그 주소의 그림으로 보인다.
 */
export function previewMdx(source: string, syntax: Syntax = {}, images: PreviewImages = {}): MdxPreview {
  let mdast;
  try {
    mdast = parseMarkdown(source, syntax);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  const jsx = (state: State, node: MdxJsxFlowElement | MdxJsxTextElement) =>
    jsxElement(state, node, images, node.type === "mdxJsxFlowElement" ? "div" : "span");
  const tree = toHast(mdast, {
    handlers: {
      mdxjsEsm: () => undefined,
      mdxJsxFlowElement: jsx,
      mdxJsxTextElement: jsx,
      mdxFlowExpression: (_state: State, node: MdxFlowExpression) => expression(node, "div"),
      mdxTextExpression: (_state: State, node: MdxTextExpression) => expression(node, "span"),
    },
  });
  removeUnsafeUrls(tree as Root);
  return { ok: true, tree: tree as Root };
}

const URL_PROPERTIES = ["href", "src"];
// 상대 주소이거나 이 프로토콜이면 둔다. `javascript:` 같은 주소는 편집 화면에서 스크립트를 실행할 수 있다.
const SAFE_URL = /^(?:[^:/?#]*(?:[/?#]|$)|(?:https?|mailto|tel|blob):)/i;

function removeUnsafeUrls(node: Root | RootContent): void {
  if (node.type === "element") {
    for (const property of URL_PROPERTIES) {
      const value = node.properties[property];
      if (typeof value === "string" && !SAFE_URL.test(value.trim())) delete node.properties[property];
    }
  }
  if ("children" in node) for (const child of node.children) removeUnsafeUrls(child);
}

function jsxElement(
  state: State,
  node: MdxJsxFlowElement | MdxJsxTextElement,
  images: PreviewImages,
  tagName: "div" | "span",
): ElementContent | ElementContent[] {
  const children = state.all(node);
  // `<>…</>`는 감싸는 요소 없이 children만 그린다.
  if (node.name === null) return children;
  const src = imageSource(node, images);
  if (src !== undefined) {
    return {
      type: "element",
      tagName: "img",
      properties: { src, alt: stringAttribute(node, "alt") ?? "" },
      children: [],
    };
  }
  const label: Element = {
    type: "element",
    tagName: "span",
    properties: { className: [`${PREVIEW_COMPONENT_CLASS}-tag`] },
    children: [{ type: "text", value: tagLabel(node) }],
  };
  return {
    type: "element",
    tagName,
    properties: { className: [PREVIEW_COMPONENT_CLASS], dataComponent: node.name },
    children: [label, ...children],
  };
}

function expression(node: MdxFlowExpression | MdxTextExpression, tagName: "div" | "span"): Element {
  return {
    type: "element",
    tagName,
    properties: { className: [PREVIEW_EXPRESSION_CLASS] },
    children: [{ type: "text", value: `{${node.value}}` }],
  };
}

/** 원문에 적힌 대로의 여는 태그 (`<Image src={image1} alt="사진">`). */
function tagLabel(node: MdxJsxFlowElement | MdxJsxTextElement): string {
  const attributes = node.attributes.map((attribute) => {
    if (attribute.type === "mdxJsxExpressionAttribute") return `{${attribute.value}}`;
    if (attribute.value === null || attribute.value === undefined) return attribute.name;
    if (typeof attribute.value === "string") return `${attribute.name}="${attribute.value}"`;
    return `${attribute.name}={${attribute.value.value}}`;
  });
  return `<${[node.name, ...attributes].join(" ")}>`;
}

function imageSource(node: MdxJsxFlowElement | MdxJsxTextElement, images: PreviewImages): string | undefined {
  const src = attributeValue(node, "src");
  if (typeof src !== "object" || src === null) return undefined;
  const name = src.value.trim();
  return Object.hasOwn(images, name) ? images[name] : undefined;
}

function stringAttribute(node: MdxJsxFlowElement | MdxJsxTextElement, name: string): string | undefined {
  const value = attributeValue(node, name);
  return typeof value === "string" ? value : undefined;
}

function attributeValue(node: MdxJsxFlowElement | MdxJsxTextElement, name: string) {
  for (const attribute of node.attributes) {
    if (attribute.type === "mdxJsxAttribute" && attribute.name === name) return attribute.value;
  }
  return undefined;
}
