"use server";

import { runRepoAction } from "@/app/_lib/action";
import { postHref } from "@/app/_lib/repo";
import {
  findCollection,
  saveEdit,
  type EditContent,
  type EditorMode,
  type SaveEditInput,
  type SaveState,
  type UploadImage,
} from "@/lib/content";
import type { Collection } from "@/lib/editor-config";
import { readFormData, type PostAction } from "@/lib/metadata-form";

import { saveError, savedPostHref, saveResultState } from "./save-result";

/**
 * 글 저장에서 FormData 밖으로 받는 값. `text`는 일반 편집이면 본문, 원문 편집이면 파일 전체다.
 * 본문·원문 글자는 FormData에 담지 않는다. 브라우저가 FormData 글자 값의 줄바꿈을 CRLF로 바꿔 보내기 때문이다.
 */
export type PostSaveInput = { action: PostAction; mode: EditorMode; text: string };

const ACTIONS: readonly PostAction[] = ["save-draft", "publish", "update", "unpublish"];

/** 편집 화면이 넣은 이미지. 파일 이름이 `N.ext`인 `image` 파일로 받는다. */
async function readImages(data: FormData): Promise<UploadImage[]> {
  const files = data.getAll("image").filter((value): value is File => value instanceof File);
  return Promise.all(
    files.map(async (file) => ({ file: file.name, content: new Uint8Array(await file.arrayBuffer()) })),
  );
}

/** 한 행동의 저장 입력. 게시 내리기는 상태만 바꾸므로 받은 입력을 담지 않는다. */
async function readEdit(
  collection: Collection,
  target: { path: string; baseSha: string },
  input: PostSaveInput,
  data: FormData,
): Promise<SaveEditInput> {
  const { action } = input;
  if (action === "unpublish") return { ...target, action };
  const images = await readImages(data);
  const content: EditContent =
    input.mode === "source"
      ? { mode: "source", source: input.text, images }
      : { mode: "form", values: readFormData(collection, data), body: input.text, images };
  return { ...target, action, content };
}

/**
 * 글 하나를 행동에 따라 커밋 하나로 저장한다. 일반 편집은 제목·설정(`data`의 폼 값)·본문·첨부를, 원문 편집은 원문과 첨부를 함께 받는다.
 * 경로·sha는 서버 컴포넌트에서 bind한 값이지만, 직접 보낸 요청일 수 있어 다시 검사한다.
 * 성공하면 새 sha와 한 행동으로 열 글 화면 주소를 돌려준다.
 */
export async function savePostAction(
  repo: string,
  path: string,
  baseSha: string,
  input: PostSaveInput,
  data: FormData,
): Promise<SaveState> {
  if (
    !ACTIONS.includes(input?.action) ||
    (input.mode !== "wysiwyg" && input.mode !== "source") ||
    typeof input.text !== "string" ||
    !(data instanceof FormData)
  ) {
    return saveError("입력을 읽지 못했어요. 입력한 내용을 따로 보관한 뒤 글을 다시 열어 저장해 주세요.");
  }
  const outcome = await runRepoAction(repo, async ({ client, config }) => {
    const found = findCollection(config, path);
    if (!found) return null;
    return saveEdit(client, repo, config, await readEdit(found.collection, { path, baseSha }, input, data));
  });
  if (!outcome.ok) return saveError(outcome.message, { detail: outcome.detail });
  if (outcome.value === null) {
    return saveError("편집할 수 있는 글 분류에 없는 글이라 저장할 수 없어요. 글 목록에서 글을 다시 열어 주세요.");
  }
  return saveResultState(outcome.value, (commit) => savedPostHref(postHref(repo, path), commit, input.action));
}
