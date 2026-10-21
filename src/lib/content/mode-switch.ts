// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { Collection } from "@/lib/editor-config";
import { metadataText, parseMdx, printMdx, readMetadata, setMetadata, type MdxDoc, type Syntax } from "@/lib/mdx-doc";
import {
  applyForm,
  buildForm,
  readStatus,
  withStatus,
  type FormValues,
  type MetadataObject,
} from "@/lib/metadata-form";

import { missingImagesInBody } from "./body-image";
import { editorModes, type EditorModes } from "./editor-modes";
import { applyUploads, sourceUploads, type UploadImage, type UploadProblem } from "./upload";

type SourceOnly = NonNullable<EditorModes["sourceOnly"]>;

/**
 * 모드를 바꾸는 글. 글을 연 시점의 원문과 글 폴더 파일 이름이다.
 * 일반 편집의 저장은 연 원문에 제목·설정·본문·첨부를 반영하므로, 전환도 같은 원문에 반영해 저장과 같은 결과를 낸다.
 */
export type SwitchPost = { collection: Collection; syntax: Syntax; source: string; files: string[] };

/** 일반 편집 입력. `values`는 제목을 포함한 설정 폼 값, `images`는 본문이 쓰는 새 이미지다. */
export type FormModeInput<I extends UploadImage = UploadImage> = { values: FormValues; body: string; images: I[] };

/** 원문 편집 입력. `images`는 원문이 가리키는 새 이미지다. */
export type SourceModeInput<I extends UploadImage = UploadImage> = { source: string; images: I[] };

/** 지금 입력을 다른 모드로 이어받지 못한 이유. */
export type ModeSwitchProblem =
  /** 원문을 원문 모드로만 열 수 있다 (`editorModes`의 `sourceOnly`). `message`는 기술 원문이다. */
  | ({ ok: false } & SourceOnly)
  /** 원문에서 고친 것 중 일반 편집이 담지 못하는 것이 있다 (가져오기, 폼에 없거나 잠긴 설정, 설정의 표기 등). */
  | { ok: false; reason: "lossy" }
  /**
   * 일반 편집기가 본문을 읽지 못하거나 열면 본문 구조가 바뀐다 (`sameBodyStructure`).
   * 편집기가 열어 봐야 알 수 있어 화면이 정한다.
   */
  | { ok: false; reason: "structure" }
  /** 설정 폼 값을 글 설정에 쓸 수 없다. */
  | { ok: false; reason: "invalid"; errors: { key: string; message: string }[] }
  /** 새 이미지를 원문에 이을 수 없다. */
  | { ok: false; reason: "image"; file: string; problem: UploadProblem }
  /** 본문이 복구한 보관본에서 파일이 빠진 첨부를 아직 가리킨다 (`missingImagesInBody`). */
  | { ok: false; reason: "missing-image"; files: string[] };

/** 전환 버튼 가까이에 보일 이유와 할 일. */
export const MODE_SWITCH_MESSAGES: { [reason in ModeSwitchProblem["reason"]]: string } = {
  doc: "원문을 글 설정과 본문으로 나눌 수 없어 일반 편집으로 바꿀 수 없어요. 원문 편집에서 고친 곳을 확인해 주세요.",
  metadata: "원문의 글 설정을 폼으로 읽을 수 없어 일반 편집으로 바꿀 수 없어요. 원문 편집에서 글 설정을 확인해 주세요.",
  lossy:
    "원문에서 고친 것 중 일반 편집이 담을 수 없는 것(가져오기, 폼에 없는 설정 등)이 있어 일반 편집으로 바꿀 수 없어요. 원문 편집에서 저장한 뒤 바꿔 주세요.",
  structure:
    "일반 편집이 이 본문을 그대로 읽을 수 없어 일반 편집으로 바꿀 수 없어요. 원문 편집에서 고치거나 저장해 주세요.",
  invalid: "글 설정에 확인할 항목이 있어 원문 편집으로 바꿀 수 없어요. 글 설정을 고친 뒤 바꿔 주세요.",
  image:
    "넣은 이미지를 원문으로 옮길 수 없어 원문 편집으로 바꿀 수 없어요. 이미지를 다시 넣거나 저장한 뒤 바꿔 주세요.",
  "missing-image":
    "보관하지 못한 이미지가 본문에 남아 있어 원문 편집으로 바꿀 수 없어요. 이미지를 다시 넣고, 다시 고르라는 안내가 보이는 자리는 지워 주세요.",
};

/**
 * 일반 편집 입력을 원문 편집 입력으로 바꾼다. 연 원문에 설정 폼 값·본문을 쓰고 새 이미지의 import를 더한다.
 * 첨부는 원문이 가리키므로 그대로 이어받는다. 게시 상태는 폼에 없어 연 원문의 값이 남는다.
 * 비운 필수 값(아직 제목을 쓰지 않은 새 글 등)도 빈 값 그대로 옮긴다. 전환은 저장이 아니라 검사는 저장할 때 한다.
 * 다만 본문이 빠진 첨부를 가리키면 바꾸지 않는다. 원문에는 그 import가 없어, 원문 편집에서 그대로 저장하면
 * 사이트가 만들 수 없는 글이 된다.
 * @param missing 복구한 보관본에서 파일이 빠진 첨부 이름.
 */
export function formToSource<I extends UploadImage>(
  post: SwitchPost,
  input: FormModeInput<I>,
  missing: string[] = [],
): { ok: true; input: SourceModeInput<I> } | ModeSwitchProblem {
  const opened = openForm(post, post.source);
  if (!opened.ok) return opened;
  let next: MdxDoc = opened.doc;
  if (opened.metadata) {
    const applied = applyForm(post.collection, opened.metadata, input.values, { required: false });
    if (!applied.ok) return { ok: false, reason: "invalid", errors: applied.errors };
    next = setMetadata(opened.doc, applied.value);
  }
  const edited = applyUploads(next, input.body, input.images, post.files);
  if (!edited.ok) return edited;
  const left = missingImagesInBody(edited.doc, input.body, missing, post.syntax);
  if (left.length > 0) return { ok: false, reason: "missing-image", files: left };
  return { ok: true, input: { source: printMdx(edited.doc), images: input.images } };
}

/**
 * 원문 편집 입력을 일반 편집 입력으로 바꾼다. 원문의 글 설정을 폼 값으로, 본문을 그대로, 원문이 가리키는 첨부를 이어받는다.
 * 이어받은 입력을 다시 원문으로 바꿔도 지금 원문과 같은 글이어야 한다. 아니면 일반 편집으로 저장할 때 잃는 것이 있어 바꾸지 않는다.
 * 게시 상태는 저장 행동이 정하므로 원문에서 바꾼 상태는 비교하지 않는다.
 * @returns `doc`은 연 원문에 새 이미지 import를 더한 것이다. 일반 편집이 넣은 이미지를 본문 이미지로 읽는 데 쓴다.
 */
export function sourceToForm<I extends UploadImage>(
  post: SwitchPost,
  input: SourceModeInput<I>,
): { ok: true; input: FormModeInput<I>; doc: MdxDoc } | ModeSwitchProblem {
  const current = openForm(post, input.source);
  if (!current.ok) return current;

  const opened = openForm(post, post.source);
  const values =
    current.metadata && opened.ok && opened.metadata
      ? formValues(post.collection, opened.metadata, current.metadata)
      : ({} as FormValues);
  const carried: FormModeInput<I> = { values, body: current.doc.body, images: sourceUploads(input, input.source) };
  const back = formToSource(post, carried);
  if (!back.ok) return { ok: false, reason: "lossy" };
  const restored = parseMdx(back.input.source, post.syntax);
  if (!sameDoc(restored, current.doc)) return { ok: false, reason: "lossy" };
  return { ok: true, input: carried, doc: restored };
}

/**
 * 원문을 일반 편집으로 열 수 있으면 나눈 원문과 글 설정 값을. 열 수 있는지는 글을 처음 열 때와 같이 `editorModes`가 정한다.
 * 글 설정 export가 없으면 `metadata`는 null이다.
 */
function openForm(
  post: SwitchPost,
  source: string,
): { ok: true; doc: Extract<MdxDoc, { ok: true }>; metadata: MetadataObject | null } | ModeSwitchProblem {
  const doc = parseMdx(source, post.syntax);
  const metadata = readMetadata(doc);
  const { sourceOnly } = editorModes({ collection: post.collection, doc, metadata });
  if (sourceOnly) return { ok: false, ...sourceOnly };
  // sourceOnly가 없으면 둘 다 성립한다. 타입을 좁히려고만 확인한다.
  if (!doc.ok || (metadata && !metadata.editable))
    throw new Error("editorModes가 일반 편집을 허용한 원문을 열 수 없다");
  return { ok: true, doc, metadata: metadata && metadata.value };
}

/**
 * 원문의 글 설정을 연 글의 설정 폼 값으로. 연 글에서 잠긴 필드는 폼이 제출하지 않으므로 빼고,
 * 원문에서 폼 형식에 맞지 않게 된 필드도 뺀다. 뺀 필드가 원문에서 바뀌었으면 되돌린 비교(`sameDoc`)가 잡는다.
 */
function formValues(collection: Collection, opened: MetadataObject, source: MetadataObject): FormValues {
  const editable = new Set(buildForm(collection, opened).flatMap((field) => (field.locked ? [] : [field.key])));
  return Object.fromEntries(
    buildForm(collection, source).flatMap((field) =>
      editable.has(field.key) && !field.locked ? [[field.key, field.initial]] : [],
    ),
  );
}

/**
 * 일반 편집으로 되돌린 원문(`restored`)이 지금 원문(`source`)과 같은 글인지. 본문과 글 설정 밖의 구간은 글자까지 같아야 한다.
 * 글 설정은 저장할 때 다시 쓰므로 값만 비교하고, 게시 상태는 되돌린 쪽 값으로 맞춰 비교한다.
 */
function sameDoc(restored: MdxDoc, source: MdxDoc): boolean {
  if (!restored.ok || !source.ok || restored.body !== source.body) return false;
  const rest = (doc: Extract<MdxDoc, { ok: true }>) => {
    const metadata = metadataText(doc);
    return JSON.stringify(doc.head.map((segment) => (segment.text === metadata ? null : segment.text)));
  };
  if (rest(restored) !== rest(source)) return false;
  const left = readMetadata(restored);
  const right = readMetadata(source);
  if (!left?.editable || !right?.editable) return left === right;
  const status = readStatus(left.value);
  const value = (status && withStatus(right.value, status)) || right.value;
  return JSON.stringify(left.value) === JSON.stringify(value);
}
