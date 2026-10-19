import { parseMarkdown, type MdxDoc, type Syntax } from "./split";

/** 본문이 바뀌었을 때만 본문 구간을 바꾼다. 같거나 구간으로 나눌 수 없는 글이면 doc을 그대로 돌려준다. */
export function setBody(doc: MdxDoc, body: string): MdxDoc {
  if (!doc.ok || doc.body === body) return doc;
  return { ...doc, body };
}

/**
 * WYSIWYG 에디터에서 저장할 본문. 에디터는 글을 열기만 해도 본문을 다시 쓰므로(목록 기호, 빈 줄 등),
 * 사용자가 고치지 않았거나 고친 뒤 처음 상태로 되돌렸으면 원본을 돌려줘 diff가 생기지 않게 한다.
 * @param normalized 에디터가 글을 열며 다시 쓴 본문. 다시 쓰지 않았으면 null.
 * @param edited 사용자가 고친 뒤의 본문. 고치지 않았으면 null.
 */
export function editedBody(original: string, normalized: string | null, edited: string | null): string {
  if (edited === null || edited === (normalized ?? original)) return original;
  return edited;
}

/**
 * 두 본문이 렌더링했을 때 같은 구조인지 본다. WYSIWYG 에디터가 다시 쓴 본문이 원본과 같은 글인지 판단하는 데 쓴다.
 * 목록 기호(`*`→`-`)나 강조 기호처럼 마크다운 표기만 다른 것은 같다고 본다. HTML은 글자 사이 공백을 하나로 보이므로
 * 텍스트의 연속 공백 차이도 같다고 본다. 둘 중 하나라도 읽을 수 없으면 다르다고 본다.
 */
export function sameBodyStructure(a: string, b: string, syntax: Syntax = {}): boolean {
  let left: unknown;
  let right: unknown;
  try {
    left = structure(parseMarkdown(a, syntax));
    right = structure(parseMarkdown(b, syntax));
  } catch {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

/** 위치(position)와 estree(data)를 뺀 노드. 같은 표기라도 위치가 달라지므로 비교에서 뺀다. */
function structure(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(structure);
  if (node === null || typeof node !== "object") return node;
  const result: { [key: string]: unknown } = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "position" || key === "data") continue;
    result[key] = structure(value);
  }
  if (result.type === "text" && typeof result.value === "string") {
    result.value = result.value.replace(/\s+/g, " ");
  }
  return result;
}
