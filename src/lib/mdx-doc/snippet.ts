import { arrayAttribute, jsxElements, stringAttribute, type JsxElement } from "./jsx";
import { parseMarkdown, type Syntax } from "./split";

/** 본문에 넣을 컴포넌트 템플릿. inline은 문장 안에, block은 앞뒤를 빈 줄로 띄워 넣는다. */
export type ComponentSnippet = { text: string; kind: "inline" | "block" };

export type InsertedSnippet = { source: string; cursor: number };

const MERMAID_TEMPLATE = "<Mermaid chart={`\nflowchart TD\n    A[시작] --> B[끝]\n`} />";

/**
 * 컴포넌트 이름별 삽입 템플릿. blog의 `Footnote`·`FootnoteRef`·`Mermaid`·`TOC`는 속성이 없으면 사이트에서 렌더링되지 않는다.
 * 각주 번호는 `body`에서 읽는다. 코드 블록·문자열 안의 글자는 JSX 요소가 아니므로 세지 않는다.
 * 지금 쓰고 있는 본문은 문법 오류일 수 있으므로, 읽을 수 없으면 각주가 없는 글로 보고 번호를 매긴다.
 */
export function componentSnippet(name: string, body: string, syntax: Syntax = {}): ComponentSnippet {
  switch (name) {
    case "Footnote": {
      const next = nextFootnoteId(body, syntax);
      return { kind: "inline", text: `<Footnote id="${next}">${next}</Footnote>` };
    }
    case "FootnoteRef": {
      const { footnotes, refs } = footnoteIds(body, syntax);
      const missing = footnotes.filter((id) => !refs.has(id));
      const id = missing.length === 0 ? "" : String(Math.min(...missing));
      return { kind: "block", text: `<FootnoteRef ids={["${id}"]}>\n  출처\n</FootnoteRef>` };
    }
    case "Mermaid":
      return { kind: "block", text: MERMAID_TEMPLATE };
    case "TOC":
      return { kind: "block", text: "<TOC items={toc} />" };
    default:
      return { kind: "block", text: `<${name} />` };
  }
}

/**
 * 선택 영역 `from..to`를 템플릿으로 바꾼다. 커서는 넣은 템플릿 바로 뒤다.
 * block 템플릿은 앞뒤가 빈 줄이 되도록 이미 있는 줄바꿈을 세어 모자란 만큼만 더한다. 글 맨 앞에는 더하지 않고, 글 끝에는 줄바꿈 하나로 끝낸다.
 */
export function insertSnippet(source: string, from: number, to: number, snippet: ComponentSnippet): InsertedSnippet {
  const before = source.slice(0, from);
  const after = source.slice(to);
  if (snippet.kind === "inline") {
    return { source: before + snippet.text + after, cursor: from + snippet.text.length };
  }
  const leading = before === "" ? "" : "\n".repeat(Math.max(0, 2 - trailingNewlines(before)));
  const trailing = after === "" ? "\n" : "\n".repeat(Math.max(0, 2 - leadingNewlines(after)));
  const cursor = before.length + leading.length + snippet.text.length;
  return { source: before + leading + snippet.text + trailing + after, cursor };
}

export function trailingNewlines(text: string): number {
  return text.length - text.replace(/\n+$/, "").length;
}

export function leadingNewlines(text: string): number {
  return text.length - text.replace(/^\n+/, "").length;
}

/** 새 `Footnote`에 쓸 번호. 순서와 상관없이 가장 큰 숫자 id 다음이다. */
export function nextFootnoteId(body: string, syntax: Syntax = {}): number {
  const ids = footnoteIds(body, syntax).footnotes;
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

/** 숫자인 `Footnote` id 목록과, `FootnoteRef`의 `ids`에 적힌 숫자 id 집합. */
function footnoteIds(body: string, syntax: Syntax): { footnotes: number[]; refs: Set<number> } {
  const footnotes: number[] = [];
  const refs = new Set<number>();
  let root;
  try {
    root = parseMarkdown(body, syntax);
  } catch {
    return { footnotes, refs };
  }
  for (const element of jsxElements(root)) {
    if (element.name === "Footnote") {
      const id = numericId(stringAttribute(element, "id"));
      if (id !== null) footnotes.push(id);
    } else if (element.name === "FootnoteRef") {
      for (const value of stringArrayAttribute(element, "ids")) {
        const id = numericId(value);
        if (id !== null) refs.add(id);
      }
    }
  }
  return { footnotes, refs };
}

/** `ids={["1", "2"]}`처럼 문자열 리터럴만 담은 배열 속성. 다른 모양의 원소는 건너뛴다. */
function stringArrayAttribute(element: JsxElement, name: string): string[] {
  return (arrayAttribute(element, name) ?? []).flatMap((item) =>
    item?.type === "Literal" && typeof item.value === "string" ? [item.value] : [],
  );
}

export function numericId(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}
