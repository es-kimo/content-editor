/** 접속 도메인 하나에 고정할 레포. PRD 5.6 */
export type Site = { host: string; repo: string };

export const SITES: readonly Site[] = [
  { host: "editor.yonsei-jshd.com", repo: "es-kimo/yjshd" },
  { host: "editor.khryu.dev", repo: "es-kimo/site" },
];

/** 매핑에 없는 Host(`*.vercel.app`, `localhost` 등)는 `open`이다. */
export type SiteScope = { kind: "pinned"; site: Site } | { kind: "open" };

/** Host 헤더 값에서 포트와 끝의 점을 떼고 소문자로 맞춘다. */
export function normalizeHost(host: string): string {
  let name = host.trim().toLowerCase();
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end !== -1) name = name.slice(0, end + 1);
  } else {
    name = name.replace(/:\d*$/, "");
  }
  return name.replace(/\.$/, "");
}

export function siteForHost(host: string | null | undefined, sites: readonly Site[] = SITES): SiteScope {
  if (!host) return { kind: "open" };
  const name = normalizeHost(host);
  const site = sites.find((s) => normalizeHost(s.host) === name);
  return site ? { kind: "pinned", site } : { kind: "open" };
}

/** 요청 헤더의 Host로 사이트를 고른다. */
export function siteForHeaders(headers: Headers, sites: readonly Site[] = SITES): SiteScope {
  return siteForHost(headers.get("host"), sites);
}

// GitHub의 owner/repo 이름은 대소문자를 구분하지 않는다.
const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** 이 도메인에서 `repo`(`owner/name`) 화면을 열 수 있는지. */
export function allowsRepo(scope: SiteScope, repo: string): boolean {
  return scope.kind === "open" || sameRepo(scope.site.repo, repo);
}

export type RepoAccess<R> =
  | { kind: "all"; repos: R[] }
  | { kind: "pinned"; repo: R }
  /** 도메인에 고정된 레포에 로그인 사용자의 권한이 없다. */
  | { kind: "forbidden"; repo: string };

/** 사용자가 접근할 수 있는 레포 중 이 도메인에서 보여 줄 것을 고른다. */
export function resolveRepoAccess<R extends { full_name: string }>(scope: SiteScope, repos: R[]): RepoAccess<R> {
  if (scope.kind === "open") return { kind: "all", repos };
  const repo = repos.find((r) => sameRepo(r.full_name, scope.site.repo));
  return repo ? { kind: "pinned", repo } : { kind: "forbidden", repo: scope.site.repo };
}
