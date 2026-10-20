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
  | { mode: "converse"; issue: number; version: string }
  | { mode: "breakdown"; issue: number; version: string }
  | { mode: "propose"; version: string }
  | { mode: "release"; milestone: number; version: string };

export const LABEL = {
  planning: "planning",
  report: "planner-report",
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

/** 이 이슈에서 기획자가 할 일. 마지막 메시지가 소유자 것일 때만 답한다. */
export function nextJob(issue: PlanningIssue, people: People, nextVersion: string): Job | null {
  const last = conversation(issue, people).at(-1);
  if (!last || last.author !== people.owner) return null;
  const version = versionOf(issue.title) ?? nextVersion;
  if (issue.labels.includes(LABEL.prdDraft) && isApproval(last.body)) {
    return { mode: "breakdown", issue: issue.number, version };
  }
  return { mode: "converse", issue: issue.number, version };
}

/** 기획자가 답했고 소유자의 답을 기다리는 이슈. 이슈를 만든 뒤(issued)는 개발 진행 중이라 기다림으로 세지 않는다. */
export function waitingOnOwner(issue: PlanningIssue, people: People): boolean {
  if (issue.labels.includes(LABEL.issued)) return false;
  return conversation(issue, people).at(-1)?.author === people.bot;
}

export type Snapshot = {
  agentReady: number;
  agentPrs: number;
  /** 소유자의 답을 기다리는 기획 이슈 번호 */
  waiting: number[];
};

/** 제안 보고서를 올리면 안 되는 이유. 없으면 null. 답하지 않은 보고서가 쌓이지 않게, 기다리는 이슈가 있으면 올리지 않는다. */
export function proposalBlocker(s: Snapshot): string | null {
  if (s.agentReady > 0) return `에이전트가 맡을 이슈 ${s.agentReady}개가 열려 있음`;
  if (s.agentPrs > 0) return `열린 에이전트 PR ${s.agentPrs}개`;
  if (s.waiting.length > 0) return `답을 기다리는 기획 이슈: ${s.waiting.map((n) => `#${n}`).join(", ")}`;
  return null;
}

/** 제목 앞의 `vX.Y` 또는 `[vX.Y]`. */
export function versionOf(title: string): string | null {
  const match = title.match(/^\[?v(\d+)\.(\d+)\b/);
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

/** 같은 묶음에서 앞서 만든 이슈를 가리키는 `#new1`, `#new2`...를 실제 번호로 바꾼다. */
export function resolveRefs(body: string, created: number[]): string {
  return body.replace(/#new(\d+)\b/g, (whole, k: string) => {
    const number = created[Number(k) - 1];
    if (number === undefined) throw new Error(`${whole}: 아직 만들지 않은 이슈를 가리킨다`);
    return `#${number}`;
  });
}

/** 이슈 묶음의 `#newK` 참조가 모두 자기보다 앞선 이슈를 가리키는지. 하나라도 만들기 전에 확인한다. */
export function refErrors(bodies: string[]): string[] {
  const errors: string[] = [];
  bodies.forEach((body, i) => {
    for (const m of body.matchAll(/#new(\d+)\b/g)) {
      const k = Number(m[1]);
      if (k < 1 || k > i) errors.push(`이슈 ${i + 1}의 #new${k}: 앞선 이슈(1~${i})만 가리킬 수 있다`);
    }
  });
  return errors;
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
