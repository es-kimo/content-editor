/**
 * fixtures.config.json에 적힌 레포·커밋에서 page.mdx만 받아 fixtures/<name>/ 아래에 저장한다.
 * 토큰: GITHUB_TOKEN 환경변수, 없으면 `gh auth token`.
 * private 소스를 읽을 권한이 없으면 경고만 하고 건너뛴다 (테스트도 그 소스는 건너뛴다).
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type Source = { name: string; repo: string; ref: string; root: string; private: boolean; expected: number };
type TreeEntry = { path: string; type: string; sha: string };

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "fixtures");
const CONCURRENCY = 8;

const token = process.env.GITHUB_TOKEN || readGhToken();

function readGhToken(): string | undefined {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function github<T>(url: string): Promise<{ status: number; body?: T }> {
  const res = await fetch(`https://api.github.com${url}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) return { status: res.status };
  return { status: res.status, body: (await res.json()) as T };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function sync(source: Source): Promise<"ok" | "skipped"> {
  const tree = await github<{ tree: TreeEntry[]; truncated: boolean }>(
    `/repos/${source.repo}/git/trees/${source.ref}?recursive=1`,
  );
  if (!tree.body) {
    if (source.private && (tree.status === 404 || tree.status === 403)) {
      console.warn(`[${source.name}] ${source.repo}을 읽을 권한이 없어 건너뜀 (HTTP ${tree.status})`);
      return "skipped";
    }
    throw new Error(`[${source.name}] tree 조회 실패: HTTP ${tree.status}`);
  }
  if (tree.body.truncated) throw new Error(`[${source.name}] tree 응답이 잘림`);

  const prefix = `${source.root}/`;
  const entries = tree.body.tree.filter(
    (e) => e.type === "blob" && e.path.startsWith(prefix) && e.path.endsWith("/page.mdx"),
  );
  if (entries.length !== source.expected) {
    throw new Error(`[${source.name}] page.mdx ${entries.length}개, 기대값 ${source.expected}개`);
  }

  const outDir = path.join(FIXTURES_DIR, source.name);
  await rm(outDir, { recursive: true, force: true });
  await mapLimit(entries, CONCURRENCY, async (entry) => {
    const blob = await github<{ content: string; encoding: string }>(`/repos/${source.repo}/git/blobs/${entry.sha}`);
    if (!blob.body) throw new Error(`[${source.name}] blob 조회 실패: ${entry.path} (HTTP ${blob.status})`);
    const file = path.join(outDir, entry.path.slice(prefix.length));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(blob.body.content, "base64"));
  });
  console.log(`[${source.name}] ${entries.length}개 저장 (${source.repo}@${source.ref.slice(0, 7)})`);
  return "ok";
}

const config = JSON.parse(await readFile(path.join(ROOT, "fixtures.config.json"), "utf8")) as { sources: Source[] };
for (const source of config.sources) await sync(source);
