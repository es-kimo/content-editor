"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isUnauthorized, postHref } from "@/app/_lib/repo";
import { assertRepoAllowed } from "@/app/_lib/site";
import { readAuthConfig, resolvePageSession, SESSION_COOKIE } from "@/lib/auth";
import {
  createGitHubClient,
  findCollection,
  saveBody,
  saveMetadata,
  type GitHubClient,
  type SaveBodyResult,
  type SaveMetadataResult,
} from "@/lib/content";
import { CONFIG_FILE, ConfigLoadError, loadEditorConfig, type Collection, type EditorConfig } from "@/lib/editor-config";
import { readFormData } from "@/lib/metadata-form";

export type SaveState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: { [key: string]: string } }
  | { status: "unchanged" };

const error = (message: string, fields?: { [key: string]: string }): SaveState => ({
  status: "error",
  message,
  fields,
});

type SaveContext = { client: GitHubClient; config: EditorConfig; collection: Collection };

/**
 * 저장 액션의 공통 흐름: 세션 → config → 저장 → 결과를 화면 상태로. 성공하면 새 sha로 글 화면을 다시 연다.
 * 레포·경로·sha는 서버 컴포넌트에서 bind한 값이지만, 직접 보낸 요청일 수 있어 다시 검사한다.
 */
async function runSave(
  repo: string,
  path: string,
  save: (context: SaveContext) => Promise<SaveMetadataResult | SaveBodyResult>,
): Promise<SaveState> {
  await assertRepoAllowed(repo);
  // 갱신은 쿠키를 쓸 수 있는 라우트에서만 한다. 여기서 보내면 입력이 사라지므로 남은 토큰으로 시도하고 401이면 안내한다.
  const page = resolvePageSession(
    (await cookies()).get(SESSION_COOKIE)?.value,
    readAuthConfig().sessionKey,
    Date.now(),
    true,
  );
  if (page.kind !== "ok") return error("로그인이 필요하다. 다른 탭에서 로그인한 뒤 다시 저장한다.");
  const accessToken = page.session.accessToken;
  const relogin = "로그인이 만료됐다. 다른 탭에서 다시 로그인한 뒤 저장한다.";

  let result: SaveMetadataResult | SaveBodyResult;
  try {
    const loaded = await loadEditorConfig(repo, accessToken, fetch);
    if (loaded.kind !== "ok") return error(`${CONFIG_FILE}을 읽을 수 없다.`);
    const found = findCollection(loaded.config, path);
    if (!found) return error("config의 컬렉션에 없는 글이다.");
    result = await save({
      client: createGitHubClient(accessToken, fetch),
      config: loaded.config,
      collection: found.collection,
    });
  } catch (e) {
    if (isUnauthorized(e) || (e instanceof ConfigLoadError && e.status === 401)) return error(relogin);
    throw e;
  }

  if (result.ok) redirect(`${postHref(repo, path)}&${new URLSearchParams({ saved: result.commit })}`);
  switch (result.reason) {
    case "unchanged":
      return { status: "unchanged" };
    case "invalid":
      return error("입력을 확인한다.", Object.fromEntries(result.errors.map((e) => [e.key, e.message])));
    case "changed":
    case "not-fast-forward":
      return error("글을 연 뒤 다른 곳에서 바뀌었다. 입력을 따로 적어 두고 새로고침한 뒤 다시 저장한다.");
    case "compile":
      return error(`저장하면 사이트 빌드가 깨진다 (${result.error.line ?? "?"}행): ${result.error.message}`);
    case "not-editable":
      return error(`원문 모드에서만 고칠 수 있는 글이다: ${result.message}`);
    case "not-found":
      return error("글을 찾을 수 없다.");
  }
}

/** 메타데이터 폼 저장. */
export async function saveMetadataAction(
  repo: string,
  path: string,
  baseSha: string,
  _prev: SaveState,
  data: FormData,
): Promise<SaveState> {
  return runSave(repo, path, ({ client, config, collection }) =>
    saveMetadata(client, repo, config, { path, baseSha, values: readFormData(collection, data) }),
  );
}

/** WYSIWYG 본문 저장. */
export async function saveBodyAction(
  repo: string,
  path: string,
  baseSha: string,
  _prev: SaveState,
  body: string,
): Promise<SaveState> {
  return runSave(repo, path, ({ client, config }) => saveBody(client, repo, config, { path, baseSha, body }));
}
