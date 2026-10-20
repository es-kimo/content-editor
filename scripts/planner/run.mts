/**
 * 기획자 워크플로의 GitHub 쪽 일. 모델은 GitHub를 직접 건드리지 않고, 이 스크립트가 고르고(jobs) 넘기고(context) 반영한다(apply).
 *
 *   node scripts/planner/run.mts jobs                 # 이번 이벤트에서 할 일 목록(JSON 배열)
 *   node scripts/planner/run.mts context '<job>'      # $PLANNER_DIR/context.md 작성
 *   node scripts/planner/run.mts apply '<job>' [out.json]  # release는 모델 출력 없이 반영한다
 *   node scripts/planner/run.mts fail '<job>' [out.json]   # 실패를 기획 이슈에 알린다
 *
 * env: GH_TOKEN(기획자 봇), REPO, OWNER, EVENT_NAME, EVENT_ACTION, GITHUB_EVENT_PATH, MODE, PLANNER_DIR, MODEL, EFFORT, RUN_URL
 */
import { readFile, writeFile } from "node:fs/promises";

import {
  renderConversation,
  renderHeader,
  renderReleaseNotes,
  renderState,
  type ReleaseItem,
  type RepoState,
} from "./context.mts";
import {
  createGitHub,
  type ApiComment,
  type ApiIssue,
  type ApiLabel,
  type ApiMilestone,
  type ApiPull,
} from "./github.mts";
import {
  blockedReason,
  parseOutput,
  LABEL,
  nextJob,
  nextVersion,
  planningIssueOf,
  proposalBlocker,
  refErrors,
  releaseReady,
  resolveRefs,
  versionOf,
  waitingOnOwner,
  type Job,
  type People,
  type PlanningIssue,
} from "./plan.mts";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`env ${name}가 없다`);
  return value;
};

const repo = env("REPO");
const gh = createGitHub(env("GH_TOKEN"));
const dir = process.env.PLANNER_DIR ?? ".planner";
const base = `/repos/${repo}`;
/** 한 번 실행에서 답할 기획 이슈 수. 사용량 한도를 나눠 쓰므로 밀린 것은 다음 실행이 받는다. */
const MAX_JOBS = 3;
const AGENT_READY = "agent-ready";

async function people(): Promise<People> {
  const bot = await gh.request<{ login: string }>("/user");
  return { owner: env("OWNER"), bot: bot.login };
}

const issuesOnly = (items: ApiIssue[]) => items.filter((i) => !i.pull_request);

async function toPlanning(i: ApiIssue): Promise<PlanningIssue> {
  const comments = await gh.list<ApiComment>(`${base}/issues/${i.number}/comments`);
  return {
    number: i.number,
    title: i.title,
    author: i.user.login,
    body: i.body ?? "",
    createdAt: i.created_at,
    labels: i.labels.map((l) => l.name),
    comments: comments.map((c) => ({ author: c.user.login, body: c.body, createdAt: c.created_at })),
  };
}

async function openPlanning(): Promise<PlanningIssue[]> {
  const issues = issuesOnly(await gh.list<ApiIssue>(`${base}/issues?state=open&labels=${LABEL.planning}`));
  return Promise.all(issues.map(toPlanning));
}

async function upcomingVersion(planning: PlanningIssue[]): Promise<string> {
  const milestones = await gh.list<ApiMilestone>(`${base}/milestones?state=all`);
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  return nextVersion([...milestones.map((m) => m.title), ...planning.map((p) => p.title)], pkg.version);
}

async function jobs(): Promise<Job[]> {
  const event = env("EVENT_NAME");
  if (event === "issues" && process.env.EVENT_ACTION === "closed") {
    const payload = JSON.parse(await readFile(env("GITHUB_EVENT_PATH"), "utf8")) as { issue: ApiIssue };
    const number = payload.issue.milestone?.number;
    if (!number) return [];
    const m = await gh.request<ApiMilestone>(`${base}/milestones/${number}`);
    const ready = releaseReady({
      title: m.title,
      state: m.state,
      openIssues: m.open_issues,
      closedIssues: m.closed_issues,
    });
    return ready ? [{ mode: "release", milestone: number, version: m.title }] : [];
  }

  const who = await people();
  const planning = await openPlanning();
  const version = await upcomingVersion(planning);
  if (event === "schedule" || process.env.MODE === "propose") {
    const open = await gh.list<ApiIssue>(`${base}/issues?state=open`);
    const blocker = proposalBlocker({
      agentReady: issuesOnly(open).filter((i) => i.labels.some((l) => l.name === AGENT_READY)).length,
      agentPrs: open.filter((i) => i.pull_request && i.labels.some((l) => l.name === "agent")).length,
      waiting: planning.filter((p) => waitingOnOwner(p, who)).map((p) => p.number),
    });
    if (blocker) {
      console.error(`제안 건너뜀: ${blocker}`);
      return [];
    }
    return [{ mode: "propose", version }];
  }
  return planning
    .map((p) => nextJob(p, who, version))
    .filter((j): j is Job => j !== null)
    .slice(0, MAX_JOBS);
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function repoState(): Promise<RepoState> {
  const [open, closed, milestones, pulls, labels] = await Promise.all([
    gh.list<ApiIssue>(`${base}/issues?state=open`),
    gh.request<ApiIssue[]>(`${base}/issues?state=closed&sort=updated&direction=desc&per_page=30`),
    gh.list<ApiMilestone>(`${base}/milestones?state=all`),
    gh.request<ApiPull[]>(`${base}/pulls?state=closed&sort=updated&direction=desc&per_page=30`),
    gh.list<ApiLabel>(`${base}/labels`),
  ]);
  return {
    repo,
    today: todayKst(),
    openIssues: issuesOnly(open),
    recentClosed: issuesOnly(closed),
    milestones,
    mergedPulls: pulls.filter((p) => p.merged_at),
    labels,
  };
}

/** 마일스톤 이슈와 그 이슈를 닫은 merge된 PR. */
async function releaseItems(milestone: number): Promise<ReleaseItem[]> {
  const issues = issuesOnly(await gh.list<ApiIssue>(`${base}/issues?state=all&milestone=${milestone}`));
  const pulls = (await gh.list<ApiPull>(`${base}/pulls?state=closed`)).filter((p) => p.merged_at);
  return issues.map((i) => ({
    number: i.number,
    title: i.title,
    pulls: pulls.filter((p) => new RegExp(`Closes #${i.number}\\b`).test(p.body ?? "")).map((p) => p.number),
  }));
}

async function context(job: Job): Promise<void> {
  const state = await repoState();
  const parts = [renderHeader(job, state)];
  if (job.mode === "converse" || job.mode === "breakdown") {
    const issue = await gh.request<ApiIssue>(`${base}/issues/${job.issue}`);
    parts.push(renderConversation(await toPlanning(issue), await people()));
  }
  parts.push(renderState(state));
  await writeFile(`${dir}/context.md`, parts.join("\n\n---\n\n") + "\n");
}

function footer(): string {
  const run = process.env.RUN_URL ? ` · [실행 로그](${process.env.RUN_URL})` : "";
  const model = process.env.MODEL ? ` · ${process.env.MODEL} · effort ${process.env.EFFORT ?? "?"}` : "";
  return `\n\n---\n<sub>기획자${model}${run}</sub>`;
}

const comment = (issue: number, body: string) =>
  gh.request(`${base}/issues/${issue}/comments`, { method: "POST", body: { body: body + footer() } });

const addLabels = (issue: number, labels: string[]) =>
  gh.request(`${base}/issues/${issue}/labels`, { method: "POST", body: { labels } });

async function removeLabel(issue: number, label: string): Promise<void> {
  try {
    await gh.request(`${base}/issues/${issue}/labels/${encodeURIComponent(label)}`, { method: "DELETE" });
  } catch {
    // 이미 없는 라벨이면 404. 지우려던 상태와 같으니 넘어간다.
  }
}

type ConverseOut = { comment: string; title: string | null; state: "prd-draft" | null };
type BreakdownOut = {
  comment: string;
  milestone_description: string;
  issues: { title: string; body: string; labels: string[]; agent: boolean }[];
};
type ProposeOut = { title: string; body: string };

async function applyConverse(job: Extract<Job, { mode: "converse" }>, out: ConverseOut): Promise<void> {
  const issue = await gh.request<ApiIssue>(`${base}/issues/${job.issue}`);
  let title = out.title ?? issue.title;
  // 다음 버전 번호는 기획 이슈 제목으로 예약한다 (nextVersion). PRD 초안이면 버전이 꼭 붙어 있어야 한다.
  if (out.state === LABEL.prdDraft && !versionOf(title)) title = `[${job.version}] ${title}`;
  if (title !== issue.title) await gh.request(`${base}/issues/${job.issue}`, { method: "PATCH", body: { title } });
  await comment(job.issue, out.comment);
  if (out.state === LABEL.prdDraft) await addLabels(job.issue, [LABEL.prdDraft]);
}

async function milestoneFor(version: string, description: string, planning: number): Promise<number> {
  const existing = (await gh.list<ApiMilestone>(`${base}/milestones?state=all`)).find((m) => m.title === version);
  if (existing) {
    if (existing.state === "closed")
      throw new Error(`마일스톤 ${version}은 이미 닫혔다. 새 버전으로 PRD를 다시 잡아야 한다`);
    return existing.number;
  }
  const created = await gh.request<ApiMilestone>(`${base}/milestones`, {
    method: "POST",
    body: { title: version, description: `${description}\n\n기획 이슈 #${planning}` },
  });
  return created.number;
}

async function applyBreakdown(job: Extract<Job, { mode: "breakdown" }>, out: BreakdownOut): Promise<void> {
  if (out.issues.length === 0) throw new Error("만들 이슈가 없다");
  const errors = refErrors(out.issues.map((i) => i.body));
  if (errors.length) throw new Error(errors.join("\n"));
  const known = new Set((await gh.list<ApiLabel>(`${base}/labels`)).map((l) => l.name));
  const milestone = await milestoneFor(job.version, out.milestone_description, job.issue);

  const created: number[] = [];
  const lines: string[] = [];
  const dropped = new Set<string>();
  for (const spec of out.issues) {
    const labels = spec.labels.filter((l) => l !== AGENT_READY && known.has(l));
    spec.labels.filter((l) => l !== AGENT_READY && !known.has(l)).forEach((l) => dropped.add(l));
    if (spec.agent) labels.push(AGENT_READY);
    const issue = await gh.request<ApiIssue>(`${base}/issues`, {
      method: "POST",
      body: { title: spec.title, body: resolveRefs(spec.body, created), labels, milestone },
    });
    created.push(issue.number);
    lines.push(`- #${issue.number} ${spec.title} · ${spec.agent ? "에이전트" : "사람"}`);
  }

  const notes = dropped.size ? `\n\n레포에 없는 라벨이라 달지 않았어요: ${[...dropped].join(", ")}` : "";
  await comment(job.issue, `${out.comment}\n\n### 만든 이슈 (${job.version})\n${lines.join("\n")}${notes}`);
  await removeLabel(job.issue, LABEL.prdDraft);
  await addLabels(job.issue, [LABEL.issued]);
}

async function applyPropose(out: ProposeOut): Promise<void> {
  const issue = await gh.request<ApiIssue>(`${base}/issues`, {
    method: "POST",
    body: { title: out.title, body: out.body + footer(), labels: [LABEL.planning, LABEL.report] },
  });
  console.log(`제안 이슈 #${issue.number}`);
}

async function applyRelease(job: Extract<Job, { mode: "release" }>): Promise<void> {
  const tag = `${job.version}.0`;
  const releases = await gh.list<{ tag_name: string; html_url: string }>(`${base}/releases`);
  const notes = renderReleaseNotes(job.version, repo, await releaseItems(job.milestone));
  const release =
    releases.find((r) => r.tag_name === tag) ??
    (await gh.request<{ html_url: string }>(`${base}/releases`, {
      method: "POST",
      body: { tag_name: tag, target_commitish: "main", name: job.version, body: notes, draft: true },
    }));
  const m = await gh.request<ApiMilestone>(`${base}/milestones/${job.milestone}`, {
    method: "PATCH",
    body: { state: "closed" },
  });
  const planning = planningIssueOf(m.description);
  if (planning) {
    await comment(
      planning,
      `${job.version} 이슈가 모두 닫혀서 릴리즈 초안을 만들었어요.\n\n릴리즈 초안: ${release.html_url}\n확인 후 publish하면 \`${tag}\` 태그가 생겨요.`,
    );
    await gh.request(`${base}/issues/${planning}`, { method: "PATCH", body: { state: "closed" } });
  }
}

async function apply(job: Job, outPath: string | undefined): Promise<void> {
  // 릴리즈는 모델 없이 마일스톤 이슈로 노트를 만든다.
  if (job.mode === "release") return applyRelease(job);
  const out = JSON.parse(await readFile(outPath!, "utf8")) as unknown;
  const reason = blockedReason(out);
  if (reason) throw new Error(`기획자가 멈춤: ${reason}`);
  switch (job.mode) {
    case "converse":
      return applyConverse(job, out as ConverseOut);
    case "breakdown":
      return applyBreakdown(job, out as BreakdownOut);
    case "propose":
      return applyPropose(out as ProposeOut);
  }
}

async function fail(job: Job, outPath: string | undefined): Promise<void> {
  if (job.mode !== "converse" && job.mode !== "breakdown") return;
  const out = parseOutput(outPath ? await readFile(outPath, "utf8").catch(() => null) : null);
  const reason = out ? blockedReason(out) : null;
  // 실패도 봇의 마지막 글이 되므로 같은 이슈를 계속 다시 돌리지 않는다. 다시 하려면 사용자가 코멘트를 단다.
  await comment(
    job.issue,
    `기획자 실행이 실패했어요.${reason ? `\n\n> ${reason}` : ""}\n\n실행 로그를 확인해 주세요. 다시 코멘트를 달면 다시 시도해요.`,
  );
}

const [command, jobArg, outPath] = process.argv.slice(2);
const job = jobArg ? (JSON.parse(jobArg) as Job) : null;
switch (command) {
  case "jobs":
    console.log(JSON.stringify(await jobs()));
    break;
  case "context":
    await context(job!);
    break;
  case "apply":
    await apply(job!, outPath);
    break;
  case "fail":
    await fail(job!, outPath);
    break;
  default:
    throw new Error(`알 수 없는 명령: ${command}`);
}
