/** 기획자 스크립트가 쓰는 GitHub REST 호출. 레포 앱 코드의 클라이언트(src/lib/github)와 달리 Actions에서 node로 바로 돈다. */
export type GitHub = {
  request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  list<T>(path: string): Promise<T[]>;
};

export function createGitHub(token: string): GitHub {
  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: HTTP ${res.status} ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
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
