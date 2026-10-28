/** 기획자 스크립트가 쓰는 GitHub REST 호출. 레포 앱 코드의 클라이언트(src/lib/github)와 달리 Actions에서 node로 바로 돈다. */
import { createSign } from "node:crypto";

export type GitHub = {
  request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  list<T>(path: string): Promise<T[]>;
};

/**
 * 쓰기 요청은 앞 쓰기가 끝나고 이만큼 지난 뒤에 보낸다. 이슈 21개를 23초에 몰아 만든 뒤 봇 계정이 스팸으로 막혔고,
 * GitHub 문서도 콘텐츠를 만드는 요청 사이에 1초 이상 두라고 한다.
 */
export const WRITE_GAP_MS = 1000;

export function createGitHub(token: string): GitHub {
  // 동시에 불러도 쓰기는 하나씩 나간다.
  let writes: Promise<unknown> = Promise.resolve();
  let lastWriteEnd = -Infinity;

  function serialWrite<T>(send: () => Promise<T>): Promise<T> {
    const run = writes.then(async () => {
      const wait = lastWriteEnd + WRITE_GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        return await send();
      } finally {
        lastWriteEnd = Date.now();
      }
    });
    writes = run.catch(() => undefined);
    return run;
  }

  async function send<T>(path: string, method: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const method = init.method ?? "GET";
    if (method === "GET") return send<T>(path, method, init.body);
    return serialWrite(() => send<T>(path, method, init.body));
  }

  async function list<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; ; page++) {
      const batch = await request<T[]>(`${path}${sep}per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }

  return { request, list };
}

/** GitHub App으로 인증하는 JWT. 설치 토큰을 받을 때만 쓴다. */
export function appJwt(appId: string, privateKey: string, now = Date.now()): string {
  // 러너 시계가 GitHub보다 빠르면 iat가 미래라 거절되므로 1분 앞당긴다. 유효 기간 상한은 10분이다.
  const iat = Math.floor(now / 1000) - 60;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat, exp: iat + 9 * 60, iss: appId })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`;
}

export type ApiIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string | null;
  created_at: string;
  closed_at: string | null;
  user: { login: string };
  labels: { name: string }[];
  milestone: { number: number; title: string } | null;
  assignees?: { login: string }[];
  pull_request?: unknown;
};

export type ApiComment = { user: { login: string }; body: string; created_at: string };

export type ApiMilestone = {
  number: number;
  title: string;
  state: "open" | "closed";
  description: string | null;
  open_issues: number;
  closed_issues: number;
};

export type ApiPull = {
  number: number;
  title: string;
  body: string | null;
  merged_at: string | null;
  labels: { name: string }[];
};

export type ApiLabel = { name: string; description: string | null };
