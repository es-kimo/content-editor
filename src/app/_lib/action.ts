import { readSession } from "@/app/_lib/session";
import { assertRepoAllowed } from "@/app/_lib/site";
import { CONFIG_FILE, loadEditorConfig, type EditorConfig } from "@/lib/editor-config";
import { createGitHubClient, isUnauthorized, type GitHubClient } from "@/lib/github";

export type ActionContext = { client: GitHubClient; config: EditorConfig };

/**
 * 커밋하는 서버 액션의 공통 흐름: 세션 → config → `run`. 실패하면 화면에 보일 안내와 기술 상세에 둘 원문을 돌려준다.
 * 레포는 서버 컴포넌트에서 bind한 값이지만, 직접 보낸 요청일 수 있어 다시 검사한다.
 */
export async function runRepoAction<T>(
  repo: string,
  run: (context: ActionContext) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string; detail?: string }> {
  await assertRepoAllowed(repo);
  // 갱신하지 않으므로 남은 토큰으로 시도하고 401이면 안내한다.
  const page = await readSession({ refresh: false });
  if (page.kind !== "ok") {
    return { ok: false, message: "로그인이 필요해요. 다른 탭에서 로그인한 뒤 다시 저장해 주세요." };
  }
  const accessToken = page.session.accessToken;

  try {
    const loaded = await loadEditorConfig(repo, accessToken, fetch);
    if (loaded.kind !== "ok") {
      return {
        ok: false,
        message: "레포의 편집 설정을 읽지 못했어요. 처음 화면에서 레포 상태를 확인해 주세요.",
        detail: `${CONFIG_FILE}: ${loaded.kind}`,
      };
    }
    return { ok: true, value: await run({ client: createGitHubClient(accessToken, fetch), config: loaded.config }) };
  } catch (e) {
    if (isUnauthorized(e)) {
      return { ok: false, message: "로그인이 만료됐어요. 다른 탭에서 다시 로그인한 뒤 저장해 주세요." };
    }
    throw e;
  }
}
