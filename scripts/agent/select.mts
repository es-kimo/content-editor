export type IssueInfo = {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
  body: string;
};

export type SelectOptions = {
  /** 이 라벨이 붙은 이슈만 고른다. 사람이 할 이슈는 라벨을 달지 않으면 된다. */
  readyLabel: string;
  skipLabels: string[];
};

/** 이슈 본문의 `## 의존` 절에 적힌 이슈 번호. 절이 없거나 "없음"이면 빈 배열. */
export function parseDeps(body: string): number[] {
  const match = body.match(/^## 의존[ \t]*\n([\s\S]*?)(?=^## |^---|$(?![\s\S]))/m);
  if (!match) return [];
  return [...match[1]!.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

/** 다음에 구현할 이슈. 열려 있고, 준비 라벨이 있고, 건너뛸 라벨이 없고, 의존 이슈가 모두 닫힌 것 중 번호가 가장 작은 것. */
export function selectNext(issues: IssueInfo[], options: SelectOptions): IssueInfo | null {
  const closed = new Set(issues.filter((i) => i.state === "closed").map((i) => i.number));
  const candidates = issues
    .filter((i) => i.state === "open")
    .filter((i) => i.labels.includes(options.readyLabel))
    .filter((i) => !i.labels.some((label) => options.skipLabels.includes(label)))
    .filter((i) => parseDeps(i.body).every((dep) => closed.has(dep)))
    .sort((a, b) => a.number - b.number);
  return candidates[0] ?? null;
}
