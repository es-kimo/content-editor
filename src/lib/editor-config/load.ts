import { parseEditorConfig, type ConfigIssue } from "./parse";
import { CONFIG_FILE, type EditorConfig } from "./schema";

type Fetch = typeof fetch;

export type LoadedConfig =
  | { kind: "ok"; config: EditorConfig }
  /** 레포 루트에 editor.config.json이 없다. */
  | { kind: "missing" }
  | { kind: "invalid"; issues: ConfigIssue[] };

export class ConfigLoadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConfigLoadError";
  }
}

/**
 * 레포 루트의 editor.config.json을 읽고 검증한다. 글을 읽을 브랜치가 config 안에 있으므로 config 자체는 기본 브랜치에서 읽는다.
 * `repo`는 `owner/name`.
 */
export async function loadEditorConfig(repo: string, accessToken: string, fetchFn: Fetch): Promise<LoadedConfig> {
  const [owner, name] = repo.split("/");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${CONFIG_FILE}`;
  const res = await fetchFn(url, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (res.status === 404) return { kind: "missing" };
  if (!res.ok) throw new ConfigLoadError(`${repo}의 ${CONFIG_FILE}을 읽지 못했다: HTTP ${res.status}`, res.status);

  const result = parseEditorConfig(await res.text());
  return result.ok ? { kind: "ok", config: result.config } : { kind: "invalid", issues: result.issues };
}
