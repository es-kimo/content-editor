// 새 글 화면(서버)과 새 글 저장 액션이 함께 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { Collection } from "@/lib/editor-config";
import { newMdx, parseMdx, printMdx, setBody, type MdxDoc, type Syntax } from "@/lib/mdx-doc";
import {
  buildForm,
  newMetadata,
  readFormData,
  TITLE_FIELD,
  type FormField,
  type FormValues,
} from "@/lib/metadata-form";

import type { EditorMode } from "./editor-modes";
import {
  sourceToForm,
  type FormModeInput,
  type ModeSwitchProblem,
  type SourceModeInput,
  type SwitchPost,
} from "./mode-switch";
import type { UploadImage } from "./upload";

/**
 * 새 글은 제목으로 글 폴더를 정하므로, 글 설정에 제목 필드가 없는 글 분류에도 제목 칸을 맨 앞에 더한다.
 * 새 글 원문은 언제나 제목을 담아(`newMetadata`) 원문 편집에서 쓴 제목도 이 칸으로 이어진다.
 */
function withTitleField(collection: Collection): Collection {
  if (TITLE_FIELD in collection.metadata) return collection;
  return { ...collection, metadata: { [TITLE_FIELD]: { type: "string", required: true }, ...collection.metadata } };
}

/**
 * 새 글 화면이 편집기를 여는 원문. 빈 제목과 기본값의 글 설정, 빈 본문이다.
 * 새 글 화면은 이 원문을 연 글처럼 다뤄 글 화면의 제목 입력·본문 편집기·글 설정·모드 전환을 그대로 쓴다.
 */
export function newPostSource(collection: Collection, syntax: Syntax, now: Date): string {
  return printMdx(setBody(parseMdx(newMdx(newMetadata(collection, "", now), ""), syntax), ""));
}

/**
 * 새 글 화면이 여는 글. 모드 전환이 여는 글(`post`), 처음 보일 편집 모드(`initial`), 일반 편집기가 여는 doc,
 * 제목을 포함한 글 설정 필드다.
 */
export type NewPost = {
  post: SwitchPost;
  initial: EditorMode;
  doc: Extract<MdxDoc, { ok: true }>;
  fields: FormField[];
};

/**
 * `newPostSource`를 글 화면 편집기가 여는 모양으로 연다. 글 폴더가 아직 없어 파일이 없다.
 * 글 분류의 기본 편집 모드(`editor`)와 상관없이 일반 편집으로 연다. blog의 `editor: "source"`는 JSX가 많은 기존 글이
 * 일반 편집의 구조 검사를 통과하지 못해 정한 것이고, 본문이 빈 새 글에는 그 이유가 없다. 원문 편집은 전환으로 쓴다.
 */
export function openNewPost(original: Collection, syntax: Syntax, now: Date): NewPost {
  const collection = withTitleField(original);
  const metadata = newMetadata(collection, "", now);
  const source = newPostSource(collection, syntax, now);
  const doc = parseMdx(source, syntax);
  // 빈 본문의 새 글 틀이라 언제나 나눌 수 있다. 타입을 좁히려고만 확인한다.
  if (!doc.ok) throw new Error(`새 글 원문을 나눌 수 없다: ${doc.message}`);
  return {
    post: { collection, syntax, source, files: [] },
    initial: "wysiwyg",
    doc,
    fields: buildForm(collection, metadata),
  };
}

/**
 * 원문 편집으로 쓴 새 글을 처음 저장할 일반 편집 입력(제목·설정 값, 본문, 첨부)으로 바꾼다.
 * 새 글은 제목·설정으로 글 폴더와 글 설정을 만들므로, 일반 편집으로 바꿀 수 있는 원문만 저장한다.
 * 바꿀 수 없으면 모드 전환과 같은 이유를 돌려준다. 비운 제목 같은 필수 값은 바꾼 입력을 저장할 때(`createPost`) 필드 오류로 알린다.
 */
export function newPostFromSource<I extends UploadImage>(
  collection: Collection,
  syntax: Syntax,
  input: SourceModeInput<I>,
  now: Date,
): { ok: true; input: FormModeInput<I> } | ModeSwitchProblem {
  const result = sourceToForm(openNewPost(collection, syntax, now).post, input);
  return result.ok ? { ok: true, input: result.input } : result;
}

/** 일반 편집으로 쓴 새 글의 제출된 폼 값. 글 설정에 제목 필드가 없는 글 분류에서도 제목 칸의 값을 담는다. */
export function readNewPostForm(collection: Collection, data: FormData): FormValues {
  return readFormData(withTitleField(collection), data);
}
