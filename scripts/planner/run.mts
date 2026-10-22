/**
 * 기획자 워크플로(prd.yml, breakdown.yml, release.yml)의 GitHub 쪽 일.
 * 모델은 GitHub를 직접 건드리지 않고, 이 스크립트가 고르고(jobs) 넘기고(context) 반영한다(apply).
 *
 *   node scripts/planner/run.mts jobs <prd|breakdown|release>  # 할 일 목록(JSON 배열)
 *   node scripts/planner/run.mts context '<job>'      # $PLANNER_DIR/context.md 작성
 *   node scripts/planner/run.mts apply '<job>' [out.json]  # release는 모델 출력 없이 반영한다
 *   node scripts/planner/run.mts fail '<job>' [out.json]   # 실패를 기획 이슈에 알린다
 *
 * jobs는 이벤트 내용이 아니라 열린 기획 이슈의 상태로 할 일을 고른다. 어느 트리거에서 불러도(코멘트, 수동 실행, 다른 워크플로) 같은 일을 한다.
 * env: GH_TOKEN(기획자 봇), REPO, OWNER, EVENT_NAME, GITHUB_EVENT_PATH, PLANNER_DIR, MODEL, EFFORT, RUN_URL
 */
import { access, readFile, rm, writeFile } from "node:fs/promises";

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
  failureComment,
  hasNewRef,
  orderByRefs,
  parseOutput,
  LABEL,
  planJobs,
  planningIssueOf,
  prdTitle,
  releaseReady,
  renderMoves,
  resolveRefs,
  type IssueJob,
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
/** 한 번 실행에서 다룰 기획 이슈 수. 사용량 한도를 나눠 쓰므로 밀린 것은 다음 실행이 받는다. */
const MAX_JOBS = 3;
const AGENT_READY = "agent-ready";
/** apply가 실패한 이유. 워크플로가 apply와 fail을 따로 부르므로 파일로 넘긴다. */
const errorPath = `${dir}/error.txt`;

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

async function issueJobs(mode: IssueJob["mode"]): Promise<IssueJob[]> {
  const planning = await openPlanning();
  const milestones = await gh.list<ApiMilestone>(`${base}/milestones?state=all`);
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  const used = milestones.map((m) => m.title);
  return planJobs(mode, planning, await people(), used, pkg.version, MAX_JOBS);
}

/** 이슈가 닫혀서 불렸으면 그 이슈의 마일스톤만, 수동 실행이면 열린 마일스톤을 모두 본다. */
async function releaseJobs(): Promise<Job[]> {
  let milestones: ApiMilestone[];
  if (process.env.EVENT_NAME === "issues") {
    const payload = JSON.parse(await readFile(env("GITHUB_EVENT_PATH"), "utf8")) as { issue: ApiIssue };
    const number = payload.issue.milestone?.number;
    if (!number) return [];
    milestones = [await gh.request<ApiMilestone>(`${base}/milestones/${number}`)];
  } else {
    milestones = await gh.list<ApiMilestone>(`${base}/milestones?state=open`);
  }
  return milestones
    .filter((m) =>
      releaseReady({ title: m.title, state: m.state, openIssues: m.open_issues, closedIssues: m.closed_issues }),
    )
    .map((m) => ({ mode: "release", milestone: m.number, version: m.title }));
}

async function jobs(mode: string | undefined): Promise<Job[]> {
  switch (mode) {
    case "prd":
    case "breakdown":
      return issueJobs(mode);
    case "release":
      return releaseJobs();
    default:
      throw new Error(`알 수 없는 모드: ${mode}`);
  }
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
  if (job.mode === "release") throw new Error("릴리즈는 모델 입력을 만들지 않는다");
  // 앞 할 일의 실패 이유가 이번 할 일의 실패 코멘트에 붙지 않게 한다.
  await rm(errorPath, { force: true });
  const state = await repoState();
  const issue = await gh.request<ApiIssue>(`${base}/issues/${job.issue}`);
  const parts = [
    renderHeader(job, state),
    renderConversation(await toPlanning(issue), await people()),
    renderState(state),
  ];
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

type PrdOut = { comment: string; title: string };
type BreakdownOut = {
  comment: string;
  milestone_description: string;
  issues: { title: string; body: string; labels: string[]; agent: boolean }[];
};
async function applyPrd(job: Extract<Job, { mode: "prd" }>, out: PrdOut): Promise<void> {
  // prd-draft를 달면 승인 한 번에 이슈 나누기가 돈다. 나눌 PRD 파일이 없으면 달지 않는다.
  const prd = `${job.version}-PRD.md`;
  await access(`${dir}/wiki/${prd}`).catch(() => {
    throw new Error(`기획자가 wiki/${prd}를 쓰지 않았다`);
  });
  const issue = await gh.request<ApiIssue>(`${base}/issues/${job.issue}`);
  // 다음 버전 번호는 기획 이슈 제목으로 예약한다 (nextVersion). 그래서 제목에 버전이 꼭 붙어 있어야 한다.
  const title = prdTitle(job.version, out.title, issue.title);
  if (title !== issue.title) await gh.request(`${base}/issues/${job.issue}`, { method: "PATCH", body: { title } });
  await comment(job.issue, out.comment);
  if (!issue.labels.some((l) => l.name === LABEL.prdDraft)) await addLabels(job.issue, [LABEL.prdDraft]);
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
  const ordered = orderByRefs(out.issues);
  if (!ordered.ok) throw new Error(ordered.errors.join("\n"));
  const known = new Set((await gh.list<ApiLabel>(`${base}/labels`)).map((l) => l.name));
  const milestone = await milestoneFor(job.version, out.milestone_description, job.issue);

  const created: number[] = [];
  const lines: string[] = [];
  const dropped = new Set<string>();
  const unresolved: { number: number; body: string }[] = [];
  for (const spec of ordered.issues) {
    const labels = spec.labels.filter((l) => l !== AGENT_READY && known.has(l));
    spec.labels.filter((l) => l !== AGENT_READY && !known.has(l)).forEach((l) => dropped.add(l));
    if (spec.agent) labels.push(AGENT_READY);
    const body = resolveRefs(spec.body, created);
    const issue = await gh.request<ApiIssue>(`${base}/issues`, {
      method: "POST",
      body: { title: spec.title, body, labels, milestone },
    });
    created.push(issue.number);
    lines.push(`- #${issue.number} ${spec.title} · ${spec.agent ? "에이전트" : "사람"}`);
    if (hasNewRef(body)) unresolved.push({ number: issue.number, body: spec.body });
  }
  // 의존은 앞선 이슈만 가리키니 만들 때 다 풀렸다. 남은 것은 설명 글이 뒤 이슈나 자기 자신을 가리킨 것이다.
  for (const { number, body } of unresolved) {
    await gh.request(`${base}/issues/${number}`, { method: "PATCH", body: { body: resolveRefs(body, created) } });
  }

  const notes =
    renderMoves(
      out.issues.map((i) => i.title),
      ordered.moved,
    ) + (dropped.size ? `\n\n레포에 없는 라벨이라 달지 않았어요: ${[...dropped].join(", ")}` : "");
  await comment(job.issue, `${out.comment}\n\n### 만든 이슈 (${job.version})\n${lines.join("\n")}${notes}`);
  await removeLabel(job.issue, LABEL.prdDraft);
  await addLabels(job.issue, [LABEL.issued]);
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
    case "prd":
      return applyPrd(job, out as PrdOut);
    case "breakdown":
      return applyBreakdown(job, out as BreakdownOut);
  }
}

async function fail(job: Job, outPath: string | undefined): Promise<void> {
  if (job.mode === "release") return;
  const out = parseOutput(outPath ? await readFile(outPath, "utf8").catch(() => null) : null);
  const error = await readFile(errorPath, "utf8").catch(() => null);
  await rm(errorPath, { force: true });
  // apply 오류에는 모델이 멈춘 이유도 들어 있으니 그쪽을 먼저 쓴다. 모델 실행 자체가 실패했으면 출력의 이유만 있다.
  const reason = error ?? (out ? blockedReason(out) : null);
  // 실패도 봇의 마지막 글이 되므로 같은 이슈를 계속 다시 돌리지 않는다. 다시 하려면 사용자가 코멘트를 단다.
  await comment(job.issue, failureComment(reason));
}

const [command, jobArg, outPath] = process.argv.slice(2);
switch (command) {
  case "jobs":
    console.log(JSON.stringify(await jobs(jobArg)));
    break;
  case "context":
    await context(JSON.parse(jobArg!) as Job);
    break;
  case "apply":
    try {
      await apply(JSON.parse(jobArg!) as Job, outPath);
    } catch (e) {
      await writeFile(errorPath, e instanceof Error ? e.message : String(e));
      throw e;
    }
    break;
  case "fail":
    await fail(JSON.parse(jobArg!) as Job, outPath);
    break;
  default:
    throw new Error(`알 수 없는 명령: ${command}`);
}
