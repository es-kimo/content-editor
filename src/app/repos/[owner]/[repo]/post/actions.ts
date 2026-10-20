"use server";

import { runRepoAction, type ActionContext } from "@/app/_lib/action";
import { postHref } from "@/app/_lib/repo";
import { findCollection, saveBody, saveMetadata, saveSource, type SaveState } from "@/lib/content";
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
  if (!outcome.ok) return saveError(outcome.message);
  if (outcome.value === null) return saveError("config의 컬렉션에 없는 글이다.");
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

/** WYSIWYG 본문 저장. `body`와, 본문에 넣은 이미지를 파일 이름이 `N.ext`인 `image` 파일로 받는다. */
export async function saveBodyAction(repo: string, path: string, baseSha: string, data: FormData): Promise<SaveState> {
  const body = data.get("body");
  if (typeof body !== "string") return saveError("본문을 읽을 수 없다. 새로고침한 뒤 다시 저장한다.");
  const files = data.getAll("image").filter((value): value is File => value instanceof File);
  const images = await Promise.all(
    files.map(async (file) => ({ file: file.name, content: new Uint8Array(await file.arrayBuffer()) })),
  );
  return runSave(repo, path, ({ client, config }) => saveBody(client, repo, config, { path, baseSha, body, images }));
}

/** 원문 모드 저장. 파일 전체를 받는다. */
export async function saveSourceAction(
  repo: string,
  path: string,
  baseSha: string,
  source: string,
): Promise<SaveState> {
  return runSave(repo, path, ({ client, config }) => saveSource(client, repo, config, { path, baseSha, source }));
}
