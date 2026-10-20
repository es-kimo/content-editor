"use server";

import { runRepoAction, type ActionContext } from "@/app/_lib/action";
import { postHref } from "@/app/_lib/repo";
import { findCollection, saveBody, saveMetadata, saveSource, type SaveState, type UploadImage } from "@/lib/content";
import type { Collection } from "@/lib/editor-config";
import { readFormData } from "@/lib/metadata-form";

import { saveError, saveResultState, type SaveResult } from "./save-result";

type SaveContext = ActionContext & { collection: Collection };

/**
 * 저장 액션의 공통 흐름: 세션 → config → 저장 → 결과를 화면 상태로. 성공하면 새 sha로 열 글 화면 주소를 돌려준다.
 * 경로·sha는 서버 컴포넌트에서 bind한 값이지만, 직접 보낸 요청일 수 있어 다시 검사한다.
 */
async function runSave(
  repo: string,
  path: string,
  save: (context: SaveContext) => Promise<SaveResult>,
): Promise<SaveState> {
  const outcome = await runRepoAction(repo, async ({ client, config }) => {
    const found = findCollection(config, path);
    return found ? save({ client, config, collection: found.collection }) : null;
  });
  if (!outcome.ok) return saveError(outcome.message, { detail: outcome.detail });
  if (outcome.value === null) {
    return saveError("편집할 수 있는 글 분류에 없는 글이라 저장할 수 없어요. 글 목록에서 글을 다시 열어 주세요.");
  }
  return saveResultState(
    outcome.value,
    (commit) => `${postHref(repo, path)}&${new URLSearchParams({ saved: commit })}`,
  );
}

/** 메타데이터 폼 저장. */
export async function saveMetadataAction(
  repo: string,
  path: string,
  baseSha: string,
  data: FormData,
): Promise<SaveState> {
  return runSave(repo, path, ({ client, config, collection }) =>
    saveMetadata(client, repo, config, { path, baseSha, values: readFormData(collection, data) }),
  );
}

/**
 * 편집 화면이 넣은 이미지. 파일 이름이 `N.ext`인 `image` 파일로 받는다.
 * 본문·원문 글자는 FormData에 담지 않고 따로 받는다. 브라우저가 FormData 글자 값의 줄바꿈을 CRLF로 바꿔 보내기 때문이다.
 */
async function readImages(images: FormData): Promise<UploadImage[]> {
  const files = images.getAll("image").filter((value): value is File => value instanceof File);
  return Promise.all(
    files.map(async (file) => ({ file: file.name, content: new Uint8Array(await file.arrayBuffer()) })),
  );
}

/** WYSIWYG 본문 저장. 본문과 본문에 넣은 이미지를 받는다. */
export async function saveBodyAction(
  repo: string,
  path: string,
  baseSha: string,
  body: string,
  images: FormData,
): Promise<SaveState> {
  if (typeof body !== "string" || !(images instanceof FormData)) {
    return saveError("본문을 읽지 못했어요. 본문을 따로 보관한 뒤 글을 다시 열어 저장해 주세요.");
  }
  const uploads = await readImages(images);
  return runSave(repo, path, ({ client, config }) =>
    saveBody(client, repo, config, { path, baseSha, body, images: uploads }),
  );
}

/** 원문 모드 저장. 파일 전체와 원문에 넣은 이미지를 받는다. */
export async function saveSourceAction(
  repo: string,
  path: string,
  baseSha: string,
  source: string,
  images: FormData,
): Promise<SaveState> {
  if (typeof source !== "string" || !(images instanceof FormData)) {
    return saveError("원문을 읽지 못했어요. 원문을 따로 보관한 뒤 글을 다시 열어 저장해 주세요.");
  }
  const uploads = await readImages(images);
  return runSave(repo, path, ({ client, config }) =>
    saveSource(client, repo, config, { path, baseSha, source, images: uploads }),
  );
}
