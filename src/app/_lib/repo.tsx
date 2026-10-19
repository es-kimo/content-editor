import Link from "next/link";
import type { ReactNode } from "react";

import { GitHubAuthError } from "@/lib/auth";
import { GitHubApiError } from "@/lib/content";
import { CONFIG_FILE, ConfigLoadError, loadEditorConfig, type EditorConfig } from "@/lib/editor-config";

export function LoginLink() {
  return (
    <a href="/api/auth/login" className="w-fit rounded bg-black px-4 py-2 text-white dark:bg-white dark:text-black">
      GitHub로 로그인
    </a>
  );
}

export const repoHref = (repo: string, collection?: string) =>
  `/repos/${repo}` + (collection === undefined ? "" : `?${new URLSearchParams({ collection })}`);

export const postHref = (repo: string, path: string) => `/repos/${repo}/post?${new URLSearchParams({ path })}`;

/** 토큰이 폐기됐거나 앱 권한이 해제돼 다시 로그인해야 하는 오류인지. */
export function isUnauthorized(error: unknown): boolean {
  return (error instanceof GitHubApiError || error instanceof GitHubAuthError) && error.status === 401;
}

/** 레포의 config를 읽는다. 쓸 수 없으면 화면에 보일 안내를 돌려준다. */
export async function loadRepoConfig(
  repo: string,
  accessToken: string,
): Promise<{ ok: true; config: EditorConfig } | { ok: false; view: ReactNode }> {
  const fail = (message: ReactNode) => ({
    ok: false as const,
    view: (
      <div className="flex flex-col gap-2">
        <p className="text-red-600">{message}</p>
        <Link href="/" className="text-sm underline">
          처음으로
        </Link>
      </div>
    ),
  });
  try {
    const loaded = await loadEditorConfig(repo, accessToken, fetch);
    if (loaded.kind === "ok") return { ok: true, config: loaded.config };
    if (loaded.kind === "missing") return fail(`${repo} 루트에 ${CONFIG_FILE}이 없다.`);
    return fail(`${CONFIG_FILE} 오류 ${loaded.issues.length}건. 처음 화면에서 내용을 확인한다.`);
  } catch (e) {
    if (e instanceof ConfigLoadError && e.status === 401) return { ok: false, view: <LoginLink /> };
    if (e instanceof ConfigLoadError) return fail(e.message);
    throw e;
  }
}
