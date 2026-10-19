import type { MetadataValue } from "./metadata";
import { printMetadata } from "./metadata-print";

// 제목에 있으면 마크다운·JSX로 읽히는 문자. 괄호·마침표처럼 글자 그대로 읽히는 것은 원문이 읽기 쉽게 그대로 둔다.
const MARKDOWN_SPECIAL = /[\\`*_[\]{}<>#&~|!]/g;

/**
 * 새 글의 원문. 기존 글처럼 metadata 다음 빈 줄, 그 다음 제목과 같은 `#` 제목 줄로 시작한다.
 * 제목은 한 줄이어야 한다.
 */
export function newMdx(metadata: { [key: string]: MetadataValue }, title: string): string {
  return `${printMetadata(metadata)}\n\n# ${title.replace(MARKDOWN_SPECIAL, "\\$&")}\n`;
}
