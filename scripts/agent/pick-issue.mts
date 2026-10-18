/**
 * 다음에 구현할 이슈를 골라 JSON으로 출력한다. 없으면 빈 출력.
 * env: GH_TOKEN, REPO(owner/name), AGENT_MILESTONES(쉼표 구분, 우선순위 순)
 */
import { selectNext, type IssueInfo } from "./select.mts";

type ApiIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string | null;
  labels: { name: string }[];
  milestone: { title: string } | null;
  pull_request?: unknown;
};

const repo = process.env.REPO!;
const milestones = (process.env.AGENT_MILESTONES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function listIssues(): Promise<IssueInfo[]> {
  const issues: IssueInfo[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GH_TOKEN}` },
    });
    if (!res.ok) throw new Error(`이슈 목록 조회 실패: HTTP ${res.status}`);
    const batch = (await res.json()) as ApiIssue[];
    for (const i of batch) {
      if (i.pull_request) continue;
      issues.push({
        number: i.number,
        title: i.title,
        state: i.state,
        body: i.body ?? "",
        labels: i.labels.map((l) => l.name),
        milestone: i.milestone?.title ?? null,
      });
    }
    if (batch.length < 100) return issues;
  }
}

const next = selectNext(await listIssues(), {
  milestones,
  skipLabels: ["needs-human", "blocked", "spike", "in progress"],
});
if (next) console.log(JSON.stringify({ number: next.number, title: next.title }));
