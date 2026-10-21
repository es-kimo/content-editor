// 새 글 화면(서버)과 새 글 저장 액션이 함께 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { Collection } from "@/lib/editor-config";
import { newMdx, parseMdx, printMdx, setBody, type Syntax } from "@/lib/mdx-doc";
import { newMetadata } from "@/lib/metadata-form";

import {
  sourceToForm,
  type FormModeInput,
  type ModeSwitchProblem,
  type SourceModeInput,
  type SwitchPost,
} from "./mode-switch";
import type { UploadImage } from "./upload";

/**
 * 새 글 화면이 편집기를 여는 원문. 빈 제목과 기본값의 글 설정, 빈 본문이다.
 * 새 글 화면은 이 원문을 연 글처럼 다뤄 글 화면의 제목 입력·본문 편집기·글 설정·모드 전환을 그대로 쓴다.
 */
export function newPostSource(collection: Collection, syntax: Syntax, now: Date): string {
  return printMdx(setBody(parseMdx(newMdx(newMetadata(collection, "", now), ""), syntax), ""));
}

/** 새 글 화면의 모드 전환이 여는 글. 글 폴더가 아직 없어 파일이 없다. */
export function newSwitchPost(collection: Collection, syntax: Syntax, now: Date): SwitchPost {
  return { collection, syntax, source: newPostSource(collection, syntax, now), files: [] };
}

/**
 * 원문 편집으로 쓴 새 글을 처음 저장할 일반 편집 입력(제목·설정 값, 본문, 첨부)으로 바꾼다.
 * 새 글은 제목·설정으로 글 폴더와 글 설정을 만들므로, 일반 편집으로 바꿀 수 있는 원문만 저장한다.
 * 바꿀 수 없으면 모드 전환과 같은 이유를 돌려준다.
 */
export function newPostFromSource<I extends UploadImage>(
  collection: Collection,
  syntax: Syntax,
  input: SourceModeInput<I>,
  now: Date,
): { ok: true; input: FormModeInput<I> } | ModeSwitchProblem {
  const result = sourceToForm(newSwitchPost(collection, syntax, now), input);
  return result.ok ? { ok: true, input: result.input } : result;
}
