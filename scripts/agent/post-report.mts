/**
 * 밤 근무가 끝나면 사람 차례를 정하고 `agent-report` 이슈에 아침 보고를 남긴다.
 * 의존이 모두 풀린 사람 작업 이슈는 소유자에게 assign한다. 보고는 소유자를 @멘션해 푸시 알림이 가게 한다.
 * env: GH_TOKEN(봇), REPO, OWNER, SHIFT_STARTED, SLOTS_RESULT(slot job 결과), RUN_URL
 */
import { createGitHub, type ApiComment, type ApiIssue, type ApiPull } from "../planner/github.mts";
import { HUMAN_TURN, decisionsOf, humanReady, reasonOf, renderReport, type ReportInput } from "./report.mts";
import { AGENT_PICK, candidates, toIssueInfo } from "./select.mts";

const repo = process.env.REPO!;
const owner = process.env.OWNER!;
const started = process.env.SHIFT_STARTED!;
const gh = createGitHub(process.env.GH_TOKEN!);
const base = `/repos/${repo}`;

const issues = (await gh.list<ApiIssue>(`${base}/issues?state=all`)).filter((i) => !i.pull_request).map(toIssueInfo);

for (const issue of humanReady(issues, AGENT_PICK.readyLabel)) {
  await gh.request(`${base}/issues/${issue.number}/comments`, {
    method: "POST",
    body: { body: `${HUMAN_TURN}\n@${owner}\n\n의존 작업이 모두 끝나서 이 이슈를 할 차례예요.` },
  });
  await gh.request(`${base}/issues/${issue.number}/assignees`, { method: "POST", body: { assignees: [owner] } });
  issue.assignees = [owner];
  console.log(`#${issue.number} 사람 차례로 assign`);
}

const humanTurns: ReportInput["humanTurns"] = [];
for (const issue of issues.filter((i) => i.state === "open" && i.assignees.includes(owner))) {
  const comments = await gh.list<ApiComment>(`${base}/issues/${issue.number}/comments`);
  const reason = reasonOf(comments.map((c) => ({ body: c.body, createdAt: c.created_at })));
  humanTurns.push({ number: issue.number, title: issue.title, reason });
}

// 최근에 바뀐 닫힌 PR 100개 안에 이번 밤 merge가 모두 들어 있다 (하룻밤 슬롯 수가 그보다 적다).
const pulls = await gh.request<ApiPull[]>(`${base}/pulls?state=closed&sort=updated&direction=desc&per_page=100`);
const merged = pulls
  .filter((p) => p.merged_at && Date.parse(p.merged_at) >= Date.parse(started))
  .filter((p) => p.labels.some((l) => l.name === "agent"))
  .sort((a, b) => a.number - b.number)
  .map((p) => ({ number: p.number, title: p.title, decisions: decisionsOf(p.body ?? "") }));

const kst = new Date(Date.parse(started) + 9 * 60 * 60 * 1000);
const body = renderReport({
  date: `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`,
  owner,
  runUrl: process.env.RUN_URL!,
  merged,
  humanTurns,
  queue: candidates(issues, AGENT_PICK).length,
  stopped: process.env.SLOTS_RESULT !== "success" && process.env.SLOTS_RESULT !== "skipped",
});
console.log(body);

const open = await gh.list<ApiIssue>(`${base}/issues?state=open&labels=agent-report`);
const report =
  open[0]?.number ??
  (
    await gh.request<{ number: number }>(`${base}/issues`, {
      method: "POST",
      body: {
        title: "에이전트 아침 보고",
        body: "밤 근무가 끝나면 결과와 내 차례를 코멘트로 남겨요.",
        labels: ["agent-report"],
      },
    })
  ).number;
await gh.request(`${base}/issues/${report}/comments`, { method: "POST", body: { body } });
