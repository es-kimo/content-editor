/**
 * 다음에 구현할 이슈를 골라 JSON으로 출력한다. 없으면 빈 출력.
 * env: GH_TOKEN, REPO(owner/name), SHIFT_STARTED(이번 밤 근무 시작 시각, ISO. 이 뒤에 실패한 이슈는 건너뛴다)
 */
import { createGitHub, type ApiComment, type ApiIssue } from "../planner/github.mts";
import { candidates, failedSince, type IssueInfo } from "./select.mts";

const repo = process.env.REPO!;
const gh = createGitHub(process.env.GH_TOKEN!);

const issues: IssueInfo[] = (await gh.list<ApiIssue>(`/repos/${repo}/issues?state=all`))
  .filter((i) => !i.pull_request)
  .map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    body: i.body ?? "",
    labels: i.labels.map((l) => l.name),
    assignees: (i.assignees ?? []).map((a) => a.login),
  }));

for (const issue of candidates(issues, { readyLabel: "agent-ready", skipLabels: ["blocked", "spike"] })) {
  const since = process.env.SHIFT_STARTED;
  if (since) {
    const comments = (await gh.list<ApiComment>(`/repos/${repo}/issues/${issue.number}/comments`)).map((c) => ({
      body: c.body,
      createdAt: c.created_at,
    }));
    if (failedSince(comments, since)) continue;
  }
  console.log(JSON.stringify({ number: issue.number, title: issue.title }));
  break;
}
