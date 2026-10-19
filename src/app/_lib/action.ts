import { cookies } from "next/headers";

import { assertRepoAllowed } from "@/app/_lib/site";
import { readAuthConfig, resolvePageSession, SESSION_COOKIE } from "@/lib/auth";
import { CONFIG_FILE, loadEditorConfig, type EditorConfig } from "@/lib/editor-config";
import { createGitHubClient, isUnauthorized, type GitHubClient } from "@/lib/github";

export type ActionContext = { client: GitHubClient; config: EditorConfig };

/**
 * 커밋하는 서버 액션의 공통 흐름: 세션 → config → `run`. 실패하면 화면에 보일 문구를 돌려준다.
 * 레포는 서버 컴포넌트에서 bind한 값이지만, 직접 보낸 요청일 수 있어 다시 검사한다.
 */
export async function runRepoAction<T>(
  repo: string,
  run: (context: ActionContext) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  await assertRepoAllowed(repo);
  // 갱신은 쿠키를 쓸 수 있는 라우트에서만 한다. 여기서 보내면 입력이 사라지므로 남은 토큰으로 시도하고 401이면 안내한다.
  const page = resolvePageSession(
    (await cookies()).get(SESSION_COOKIE)?.value,
    readAuthConfig().sessionKey,
    Date.now(),
    true,
  );
  if (page.kind !== "ok") return { ok: false, message: "로그인이 필요하다. 다른 탭에서 로그인한 뒤 다시 저장한다." };
  const accessToken = page.session.accessToken;

  try {
    const loaded = await loadEditorConfig(repo, accessToken, fetch);
    if (loaded.kind !== "ok") return { ok: false, message: `${CONFIG_FILE}을 읽을 수 없다.` };
    return { ok: true, value: await run({ client: createGitHubClient(accessToken, fetch), config: loaded.config }) };
  } catch (e) {
    if (isUnauthorized(e)) {
      return { ok: false, message: "로그인이 만료됐다. 다른 탭에서 다시 로그인한 뒤 저장한다." };
    }
    throw e;
  }
}
