import type { Element, ElementContent, Properties, Root, RootContent } from "hast";
import type { MdxFlowExpression, MdxJsxFlowElement, MdxJsxTextElement, MdxTextExpression } from "mdast-util-mdx";
import { defaultHandlers, toHast, type State } from "mdast-util-to-hast";

import { parseMarkdown, type MdastRoot, type Syntax } from "./split";

/** 미리보기에서 실제 그림으로 보일 이미지. import 변수명 → 이미지 주소. */
export type PreviewImages = { [name: string]: string };

export type MdxPreview = { ok: true; tree: Root } | { ok: false; message: string };

// 화면(globals.css)이 이 class로 자리 표시를 꾸민다.
const PREVIEW_COMPONENT_CLASS = "mdx-component";
const PREVIEW_EXPRESSION_CLASS = "mdx-expression";

/**
 * MDX 원문(본문만이거나 파일 전체)을 미리보기용 HTML 트리로 만든다. import·export는 보이지 않는다.
 * 소문자 HTML 태그는 사이트처럼 실제 요소로 그리되 문자열 속성만 옮긴다.
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
      paragraph: (state: State, node: Paragraph) => paragraph(state, node, images),
      mdxjsEsm: () => undefined,
      mdxJsxFlowElement: jsx,
      mdxJsxTextElement: jsx,
      mdxFlowExpression: (_state: State, node: MdxFlowExpression) => expression(node, "div"),
      mdxTextExpression: (_state: State, node: MdxTextExpression) => expression(node, "span"),
    },
  });
  removeUnsafeUrls(tree as Root);
  openLinksInNewTab(tree as Root);
  return { ok: true, tree: tree as Root };
}

type Paragraph = Extract<MdastRoot["children"][number], { type: "paragraph" }>;

/**
 * JSX와 공백만 있는 문단은 `<p>`로 감싸지 않고 블록으로 그린다. MDX 컴파일러도 이렇게 풀어서
 * 한 줄짜리 `<p className="…">…</p>`가 사이트에서 `<p>` 안의 `<p>`가 되지 않는다.
 */
function paragraph(state: State, node: Paragraph, images: PreviewImages): ElementContent | ElementContent[] {
  const jsxOnly = node.children.every(
    (child) =>
      child.type === "mdxJsxTextElement" ||
      child.type === "mdxTextExpression" ||
      (child.type === "text" && child.value.trim() === ""),
  );
  if (!jsxOnly || node.children.every((child) => child.type === "text")) return defaultHandlers.paragraph(state, node);
  return node.children.flatMap((child) => {
    if (child.type === "mdxJsxTextElement") return jsxElement(state, child, images, "div");
    if (child.type === "mdxTextExpression") return expression(child, "div");
    return [];
  });
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

// 미리보기는 편집 화면 안에 있으므로 같은 탭에서 이동하면 저장하지 않은 본문을 잃는다.
function openLinksInNewTab(node: Root | RootContent): void {
  if (node.type === "element" && node.tagName === "a") {
    node.properties.target = "_blank";
    node.properties.rel = ["noopener", "noreferrer"];
  }
  if ("children" in node) for (const child of node.children) openLinksInNewTab(child);
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
  // MDX에서 소문자 태그는 사이트 컴포넌트가 아니라 HTML 요소로 그려진다.
  if (HTML_TAGS.has(node.name)) {
    return { type: "element", tagName: node.name, properties: htmlProperties(node), children };
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

// 편집 화면에 그대로 그려도 안전한 태그만 둔다. 그 밖의 태그(input, button, script 등)는 자리 표시로 남는다.
const HTML_TAGS = new Set([
  ..."p br hr div span figure figcaption blockquote pre code".split(" "),
  ..."ul ol li dl dt dd table thead tbody tr th td".split(" "),
  ..."h1 h2 h3 h4 h5 h6 a b strong i em u s del small sub sup mark".split(" "),
]);

/**
 * 문자열 속성만 옮긴다. `{식}` 값은 에디터에서 계산할 수 없고, `on*`은 스크립트를 실행하며,
 * `style` 문자열은 화면 렌더러가 해석하다 실패할 수 있어 뺀다.
 */
function htmlProperties(node: MdxJsxFlowElement | MdxJsxTextElement): Properties {
  const properties: Properties = {};
  for (const attribute of node.attributes) {
    if (attribute.type !== "mdxJsxAttribute" || /^on/i.test(attribute.name) || attribute.name === "style") continue;
    const { name, value } = attribute;
    if (name === "className" || name === "class") {
      if (typeof value === "string") properties.className = value.split(/\s+/).filter(Boolean);
    } else if (typeof value === "string") {
      properties[name] = value;
    } else if (value === null || value === undefined) {
      properties[name] = true;
    }
  }
  return properties;
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
