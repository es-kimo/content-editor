import { createGitHubClient, GitHubApiError, repoPath } from "@/lib/github";

import { parseEditorConfig, type ConfigIssue } from "./parse";
import { CONFIG_FILE, type EditorConfig } from "./schema";

type Fetch = typeof fetch;

export type LoadedConfig =
  | { kind: "ok"; config: EditorConfig }
  /** 레포 루트에 editor.config.json이 없다. */
  | { kind: "missing" }
  | { kind: "invalid"; issues: ConfigIssue[] };

/**
 * 레포 루트의 editor.config.json을 읽고 검증한다. 글을 읽을 브랜치가 config 안에 있으므로 config 자체는 기본 브랜치에서 읽는다.
 * `repo`는 `owner/name`. 404 말고 HTTP 오류는 `GitHubApiError`로 던진다.
 */
export async function loadEditorConfig(repo: string, accessToken: string, fetchFn: Fetch): Promise<LoadedConfig> {
  let res: Response;
  try {
    res = await createGitHubClient(accessToken, fetchFn).rest(`${repoPath(repo)}/contents/${CONFIG_FILE}`, {
      accept: "application/vnd.github.raw+json",
    });
  } catch (error) {
    if (!(error instanceof GitHubApiError)) throw error;
    if (error.status === 404) return { kind: "missing" };
    // 처음 화면이 이 메시지를 그대로 보여 주므로 API 경로 대신 레포와 파일 이름으로 알린다.
    throw new GitHubApiError(`${repo}의 ${CONFIG_FILE}을 읽지 못했다: HTTP ${error.status}`, error.status);
  }

  const result = parseEditorConfig(await res.text());
  return result.ok ? { kind: "ok", config: result.config } : { kind: "invalid", issues: result.issues };
}
