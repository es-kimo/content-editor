export type IssueInfo = {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
  /** assignee가 있으면 사람 차례다. 에이전트는 고르지 않는다. */
  assignees: string[];
  body: string;
};

export type CommentInfo = { body: string; createdAt: string };

export type SelectOptions = {
  /** 이 라벨이 붙은 이슈만 고른다. 사람이 할 이슈는 라벨을 달지 않으면 된다. */
  readyLabel: string;
  skipLabels: string[];
};

/** 구현 시도가 실패했다는 표시. 밤 근무 슬롯이 이슈 코멘트에 남긴다. */
export const ATTEMPT_FAILED = "<!-- agent:attempt-failed -->";

/** 이슈 본문의 `## 의존` 절에 적힌 이슈 번호. 절이 없거나 "없음"이면 빈 배열. */
export function parseDeps(body: string): number[] {
  const match = body.match(/^## 의존[ \t]*\n([\s\S]*?)(?=^## |^---|$(?![\s\S]))/m);
  if (!match) return [];
  return [...match[1]!.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

/** 구현할 수 있는 이슈를 고를 순서대로. 열려 있고, 준비 라벨이 있고, 건너뛸 라벨과 assignee가 없고, 의존 이슈가 모두 닫힌 것. */
export function candidates(issues: IssueInfo[], options: SelectOptions): IssueInfo[] {
  const closed = new Set(issues.filter((i) => i.state === "closed").map((i) => i.number));
  return issues
    .filter((i) => i.state === "open")
    .filter((i) => i.labels.includes(options.readyLabel))
    .filter((i) => !i.labels.some((label) => options.skipLabels.includes(label)))
    .filter((i) => i.assignees.length === 0)
    .filter((i) => parseDeps(i.body).every((dep) => closed.has(dep)))
    .sort((a, b) => a.number - b.number);
}

/** 다음에 구현할 이슈. 후보 중 번호가 가장 작은 것. */
export function selectNext(issues: IssueInfo[], options: SelectOptions): IssueInfo | null {
  return candidates(issues, options)[0] ?? null;
}

/** `since`(ISO 시각) 뒤에 구현 시도가 실패한 적이 있다. 같은 밤에 같은 이슈를 다시 고르지 않는 데 쓴다. */
export function failedSince(comments: CommentInfo[], since: string): boolean {
  const from = Date.parse(since);
  return comments.some((c) => c.body.includes(ATTEMPT_FAILED) && Date.parse(c.createdAt) >= from);
}
