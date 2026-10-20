import type { ApiIssue, ApiLabel, ApiMilestone, ApiPull } from "./github.mts";
import { conversation, type Job, type People, type PlanningIssue } from "./plan.mts";

export type RepoState = {
  repo: string;
  /** KST 날짜 YYYY-MM-DD */
  today: string;
  openIssues: ApiIssue[];
  recentClosed: ApiIssue[];
  milestones: ApiMilestone[];
  mergedPulls: ApiPull[];
  labels: ApiLabel[];
};

const issueLine = (i: ApiIssue) => {
  const labels = i.labels.map((l) => l.name).join(", ");
  return `- #${i.number} ${i.title}${labels ? ` [${labels}]` : ""}${i.milestone ? ` (${i.milestone.title})` : ""}`;
};

export function renderConversation(issue: PlanningIssue, people: People): string {
  const lines = [`# 기획 이슈 #${issue.number} ${issue.title}`, "", `라벨: ${issue.labels.join(", ") || "없음"}`];
  for (const m of conversation(issue, people)) {
    lines.push("", `## ${m.author === people.owner ? "사용자" : "기획자(너)"} · ${m.createdAt}`, "", m.body.trim());
  }
  return lines.join("\n");
}

export function renderState(s: RepoState): string {
  const list = (items: string[]) => (items.length ? items.join("\n") : "- 없음");
  return [
    "# 레포 현황",
    "",
    "## 열린 이슈",
    list(s.openIssues.map(issueLine)),
    "",
    "## 최근 닫힌 이슈",
    list(s.recentClosed.map(issueLine)),
    "",
    "## 마일스톤",
    list(s.milestones.map((m) => `- ${m.title} (${m.state}, 열림 ${m.open_issues} / 닫힘 ${m.closed_issues})`)),
    "",
    "## 최근 merge된 PR",
    list(s.mergedPulls.map((p) => `- #${p.number} ${p.title} (${p.merged_at?.slice(0, 10)})`)),
    "",
    "## 라벨",
    list(s.labels.map((l) => `- \`${l.name}\`${l.description ? `: ${l.description}` : ""}`)),
  ].join("\n");
}

export type ReleaseItem = { number: number; title: string; pulls: number[] };

/**
 * 마일스톤 이슈로 만든 릴리즈 노트. 에이전트 PR 제목이 이미 한 문장 요약이라 모델 없이 이슈 제목을 그대로 쓴다.
 * PR이 있는 이슈는 변경, 없는 이슈는 사람이 한 작업으로 나눈다.
 */
export function renderReleaseNotes(version: string, repo: string, items: ReleaseItem[]): string {
  const line = (i: ReleaseItem) => {
    const refs = i.pulls.length ? i.pulls : [i.number];
    return `- ${i.title.replace(/^\[v\d+\.\d+\]\s*/, "")} (${refs.map((n) => `#${n}`).join(", ")})`;
  };
  const sorted = [...items].sort((a, b) => a.number - b.number);
  const changed = sorted.filter((i) => i.pulls.length);
  const manual = sorted.filter((i) => !i.pulls.length);
  const parts = [`[${version} PRD](https://github.com/${repo}/wiki/${version}-PRD)`];
  if (changed.length) parts.push(["## 변경", ...changed.map(line)].join("\n"));
  if (manual.length) parts.push(["## 사람이 한 작업", ...manual.map(line)].join("\n"));
  return parts.join("\n\n") + "\n";
}

export function renderHeader(job: Job, s: RepoState): string {
  const target =
    job.mode === "converse" || job.mode === "breakdown"
      ? `이 이슈의 버전: ${job.version} (제목에 버전이 없으면 다음 버전)`
      : `다음 버전: ${job.version}`;
  return [
    `# 이번 실행`,
    "",
    `- 모드: ${job.mode}`,
    `- 레포: ${s.repo} · wiki: https://github.com/${s.repo}/wiki`,
    `- 오늘(KST): ${s.today}`,
    `- ${target}`,
  ].join("\n");
}
