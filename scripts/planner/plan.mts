export type Message = {
  author: string;
  body: string;
  createdAt: string;
};

export type PlanningIssue = {
  number: number;
  title: string;
  author: string;
  body: string;
  createdAt: string;
  labels: string[];
  comments: Message[];
};

/** 레포 소유자(사용자)와 기획자 봇 계정의 login. */
export type People = { owner: string; bot: string };

export type Job =
  | { mode: "prd"; issue: number; version: string }
  | { mode: "breakdown"; issue: number; version: string }
  | { mode: "release"; milestone: number; version: string };

/** 기획 이슈 하나에서 생기는 할 일. 워크플로 하나가 모드 하나를 맡는다 (prd.yml, breakdown.yml). */
export type IssueJob = Extract<Job, { issue: number }>;

export const LABEL = {
  planning: "planning",
  prdDraft: "prd-draft",
  issued: "issued",
} as const;

/**
 * 기획자에게 넘길 대화. 이슈 본문을 첫 메시지로 두고, 소유자와 봇의 글만 남긴다.
 * public 레포라 누구나 코멘트를 달 수 있어서, 남의 글이 기획자에게 지시로 읽히지 않게 한다.
 */
export function conversation(issue: PlanningIssue, people: People): Message[] {
  const allowed = new Set([people.owner, people.bot]);
  if (!allowed.has(issue.author)) return [];
  const opening = { author: issue.author, body: issue.body, createdAt: issue.createdAt };
  return [opening, ...issue.comments].filter((m) => allowed.has(m.author));
}

/** 소유자의 마지막 메시지가 "승인"으로 시작하면 PRD 승인으로 본다. 승인 뒤에는 에이전트가 바로 구현하므로 말뜻을 모델에 맡기지 않는다. */
export function isApproval(body: string): boolean {
  return /^\s*승인/.test(body);
}

/** 이 이슈에서 기획자가 할 일. 마지막 메시지가 소유자 것일 때만 한다. 이슈를 나눈 뒤(issued)는 개발 진행 중이라 답하지 않는다. */
export function nextJob(issue: PlanningIssue, people: People, nextVersion: string): IssueJob | null {
  if (issue.labels.includes(LABEL.issued)) return null;
  const last = conversation(issue, people).at(-1);
  if (!last || last.author !== people.owner) return null;
  const version = versionOf(issue.title) ?? nextVersion;
  if (issue.labels.includes(LABEL.prdDraft) && isApproval(last.body)) {
    return { mode: "breakdown", issue: issue.number, version };
  }
  return { mode: "prd", issue: issue.number, version };
}

/**
 * 이번 실행에서 할 `mode` 일. 제목에 버전이 없는 원문은 다음 버전을 하나씩 차례로 받는다.
 * 한 실행에서 원문 둘이 같은 버전으로 PRD를 쓰지 않게, 앞에서 준 버전을 쓴 버전으로 센다.
 */
export function planJobs(
  mode: IssueJob["mode"],
  issues: PlanningIssue[],
  people: People,
  usedTitles: string[],
  packageVersion: string,
  max: number,
): IssueJob[] {
  const used = [...usedTitles, ...issues.map((i) => i.title)];
  const jobs: IssueJob[] = [];
  for (const issue of issues) {
    if (jobs.length >= max) break;
    const job = nextJob(issue, people, nextVersion(used, packageVersion));
    if (!job || job.mode !== mode) continue;
    if (!versionOf(issue.title)) used.push(job.version);
    jobs.push(job);
  }
  return jobs;
}

const VERSION_PREFIX = /^\[?v(\d+)\.(\d+)\b\]?\s*/;

/** 제목 앞의 `vX.Y` 또는 `[vX.Y]`. */
export function versionOf(title: string): string | null {
  const match = title.match(VERSION_PREFIX);
  return match ? `v${match[1]}.${match[2]}` : null;
}

/**
 * 다음 버전. 마일스톤과 기획 이슈 제목에 이미 쓴 버전 중 가장 큰 것의 minor를 하나 올린다.
 * 기획 이슈 제목까지 보는 것은, 아직 마일스톤이 없는 PRD 초안 둘이 같은 번호를 받지 않게 하려는 것이다.
 */
export function nextVersion(titles: string[], packageVersion: string): string {
  const [major = 0, minor = 0] = packageVersion.split(".").map(Number);
  let best: [number, number] = [major, minor];
  for (const title of titles) {
    const v = versionOf(title);
    if (!v) continue;
    const [a, b] = v.slice(1).split(".").map(Number) as [number, number];
    if (a > best[0] || (a === best[0] && b > best[1])) best = [a, b];
  }
  return `v${best[0]}.${best[1] + 1}`;
}

/** PRD 초안 이슈 제목 `[vX.Y] 요약`. 버전은 이슈에 정한 것을 쓰고, 모델이 요약 앞에 붙인 버전은 뗀다. */
export function prdTitle(version: string, summary: string, fallback: string): string {
  const text = summary.replace(VERSION_PREFIX, "").trim() || fallback.replace(VERSION_PREFIX, "").trim();
  return `[${version}] ${text}`;
}

/**
 * 같은 묶음의 `#new1`, `#new2`...를 이미 만든 이슈의 실제 번호로 바꾼다. 아직 만들지 않은 이슈는 그대로 둔다.
 * 설명 글은 뒤 이슈나 자기 자신을 가리킬 수 있어서, 묶음을 다 만든 뒤 한 번 더 부른다.
 */
export function resolveRefs(body: string, created: number[]): string {
  return body.replace(/#new(\d+)\b/g, (whole, k: string) => {
    const number = created[Number(k) - 1];
    return number === undefined ? whole : `#${number}`;
  });
}

/** 본문에 아직 실제 번호로 바꾸지 않은 `#newK`가 남았는지. */
export const hasNewRef = (body: string) => /#new\d+\b/.test(body);

/** 이슈 본문의 `#newK` 참조 하나. `from`·`to`는 모델이 낸 순서(1부터)다. `dependency`는 `## 의존` 절 안의 참조다. */
export type NewRef = { from: number; to: number; section: string; line: string; dependency: boolean };

const DEPENDENCY_SECTION = "의존";

/** 묶음 안 `#newK` 참조를 그 줄이 속한 `## ` 절과 함께 모은다. 의존인지 설명 글인지 알려야 원인을 가릴 수 있다. */
export function newRefs(bodies: string[]): NewRef[] {
  const refs: NewRef[] = [];
  bodies.forEach((body, i) => {
    let section = "본문";
    for (const line of body.split("\n")) {
      const heading = line.match(/^##\s+(.+)/);
      if (heading) section = heading[1]!.trim();
      // 개발 에이전트의 parseDeps처럼 `---`에서 절이 끝난다. 그 아래 링크는 의존이 아니다.
      if (line.startsWith("---")) section = "본문";
      for (const m of line.matchAll(/#new(\d+)\b/g)) {
        const dependency = section === DEPENDENCY_SECTION;
        refs.push({ from: i + 1, to: Number(m[1]), section, line: line.trim(), dependency });
      }
    }
  });
  return refs;
}

const describeRef = (r: NewRef) => `이슈 ${r.from}의 #new${r.to} (${r.section}: \`${r.line}\`)`;

export type Ordered<T> = { ok: true; issues: T[]; moved: NewRef[] } | { ok: false; errors: string[] };

/**
 * `## 의존`이 모두 앞선 이슈를 가리키도록 묶음 순서를 맞추고, 본문의 모든 `#newK`를 새 순서로 다시 매긴다.
 * 개발 에이전트는 의존이 풀린 이슈 중 번호가 작은 것부터 고르므로, 의존받는 이슈가 먼저 만들어져야 한다.
 * 모델이 뒤 이슈를 가리키는 일이 실행마다 반복돼서(#159) 규칙을 모델에 맡기지 않는다.
 * 가리킨 이슈를 가리키는 이슈 바로 앞으로 옮기고, 나머지는 모델이 정한 순서를 지킨다.
 * 설명 글의 참조는 "사람 확인은 #new21에서"처럼 뒤 이슈나 자기 자신을 이름으로 부르는 것이라 순서에 넣지 않는다.
 * 없는 번호, 자기 의존, 의존 순환은 순서로 풀 수 없어서 하나도 만들기 전에 오류로 돌려준다.
 */
export function orderByRefs<T extends { body: string }>(issues: T[]): Ordered<T> {
  const refs = newRefs(issues.map((i) => i.body));
  const invalid = refs
    .filter((r) => r.to < 1 || r.to > issues.length || (r.dependency && r.to === r.from))
    .map((r) => `${describeRef(r)}: ${r.to === r.from ? "자기 자신에 의존한다" : "없는 이슈를 가리킨다"}`);
  if (invalid.length) return { ok: false, errors: invalid };

  const deps = refs.filter((r) => r.dependency);
  const needs = issues.map((_, i) =>
    [...new Set(deps.filter((r) => r.from === i + 1).map((r) => r.to))].sort((a, b) => a - b),
  );
  const order: number[] = [];
  const state = new Map<number, "visiting" | "done">();
  const path: number[] = [];
  const visit = (k: number): number[] | null => {
    if (state.get(k) === "done") return null;
    if (state.get(k) === "visiting") return [...path.slice(path.indexOf(k)), k];
    state.set(k, "visiting");
    path.push(k);
    for (const to of needs[k - 1]!) {
      const cycle = visit(to);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(k, "done");
    order.push(k);
    return null;
  };
  for (let k = 1; k <= issues.length; k++) {
    const cycle = visit(k);
    if (!cycle) continue;
    const edges = cycle.slice(1).map((to, i) => deps.find((r) => r.from === cycle[i] && r.to === to)!);
    return {
      ok: false,
      errors: [`의존 순환: ${cycle.map((n) => `이슈 ${n}`).join(" → ")}`, ...edges.map(describeRef)],
    };
  }

  const position = new Map(order.map((k, i) => [k, i + 1]));
  return {
    ok: true,
    issues: order.map((k) => {
      const issue = issues[k - 1]!;
      return { ...issue, body: issue.body.replace(/#new(\d+)\b/g, (_, n: string) => `#new${position.get(Number(n))}`) };
    }),
    moved: deps.filter((r) => r.to > r.from),
  };
}

/** 순서를 바꿨을 때 사용자에게 남길 설명. 어느 절의 참조였는지 보여서 의존이 거꾸로였는지 설명 글이었는지 가릴 수 있다. */
export function renderMoves(titles: string[], moved: NewRef[]): string {
  if (!moved.length) return "";
  const lines = moved.map((r) => `- 「${titles[r.from - 1]}」 → 「${titles[r.to - 1]}」 (${r.section}: \`${r.line}\`)`);
  return `\n\n뒤 이슈를 가리킨 참조가 있어서 가리킨 이슈를 앞으로 옮겼어요.\n${lines.join("\n")}`;
}

/** 실패 코멘트. 다음 실행은 이 코멘트를 대화로 읽으므로 이유를 넣어야 같은 실수를 피할 수 있다. */
export function failureComment(reason: string | null): string {
  const why = reason?.trim();
  if (!why) return "기획자 실행이 실패했어요.\n\n실행 로그를 확인해 주세요. 다시 코멘트를 달면 다시 시도해요.";
  const quoted = why
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `기획자 실행이 실패했어요.\n\n${quoted}\n\n다시 코멘트를 달면 이 이유를 보고 다시 시도해요.`;
}

/**
 * 모델이 일을 끝내지 못했다고 답했으면 그 이유. 끝냈으면 null.
 * 입력을 못 읽어도 모델은 스키마에 맞는 "진행 불가" 글을 쓰므로, 형식만 보고 반영하면 그 글이 제안·코멘트로 올라간다.
 */
export function blockedReason(out: unknown): string | null {
  const o = (typeof out === "object" && out !== null ? out : {}) as { status?: unknown; blocked_reason?: unknown };
  if (o.status === "done") return null;
  return typeof o.blocked_reason === "string" && o.blocked_reason.trim() ? o.blocked_reason.trim() : "이유 없음";
}

/** 모델 출력 파일의 내용. 모델이 중간에 끝나면 파일이 없거나 비어 있어서, 실패를 알릴 때 읽다가 다시 실패하지 않게 null로 둔다. */
export function parseOutput(text: string | null): unknown {
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 마일스톤 설명에 남긴 기획 이슈 번호. */
export function planningIssueOf(description: string | null): number | null {
  const match = description?.match(/기획 이슈 #(\d+)/);
  return match ? Number(match[1]) : null;
}

export type MilestoneInfo = {
  title: string;
  state: "open" | "closed";
  openIssues: number;
  closedIssues: number;
};

/** 릴리즈할 마일스톤: 열려 있고, vX.Y 이름이고, 이슈가 모두 닫혔다. */
export function releaseReady(m: MilestoneInfo): boolean {
  return m.state === "open" && /^v\d+\.\d+$/.test(m.title) && m.openIssues === 0 && m.closedIssues > 0;
}
