export type IssueInfo = {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
  milestone: string | null;
  body: string;
};

export type SelectOptions = {
  /** 이 순서대로 우선한다. 목록에 없는 마일스톤의 이슈는 고르지 않는다. */
  milestones: string[];
  skipLabels: string[];
};

/** 이슈 본문의 `## 의존` 절에 적힌 이슈 번호. 절이 없거나 "없음"이면 빈 배열. */
export function parseDeps(body: string): number[] {
  const match = body.match(/^## 의존[ \t]*\n([\s\S]*?)(?=^## |^---|$(?![\s\S]))/m);
  if (!match) return [];
  return [...match[1]!.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

/** 다음에 구현할 이슈. 열려 있고, 건너뛸 라벨이 없고, 의존 이슈가 모두 닫힌 것 중 마일스톤·번호 순으로 첫 번째. */
export function selectNext(issues: IssueInfo[], options: SelectOptions): IssueInfo | null {
  const closed = new Set(issues.filter((i) => i.state === "closed").map((i) => i.number));
  const rank = (i: IssueInfo) => options.milestones.indexOf(i.milestone ?? "");
  const candidates = issues
    .filter((i) => i.state === "open")
    .filter((i) => rank(i) !== -1)
    .filter((i) => !i.labels.some((label) => options.skipLabels.includes(label)))
    .filter((i) => parseDeps(i.body).every((dep) => closed.has(dep)))
    .sort((a, b) => rank(a) - rank(b) || a.number - b.number);
  return candidates[0] ?? null;
}
