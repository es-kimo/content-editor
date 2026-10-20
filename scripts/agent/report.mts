/** 밤 근무 아침 보고. 사람 차례를 정하고 보고 글을 만든다. GitHub 호출은 post-report.mts가 한다. */
import { parseDeps, type CommentInfo, type IssueInfo } from "./select.mts";

/** 사람 차례로 넘겼다는 표시. 슬롯과 아침 보고가 이슈 코멘트에 남긴다. */
export const HUMAN_TURN = "<!-- agent:human-turn -->";

/** 사람 작업으로 보지 않는 이슈: 기획 대화, 보고, 잠시 빼 둔 것. */
const NOT_HUMAN_WORK = ["planning", "planner-report", "prd-draft", "agent-report", "blocked"];

/**
 * 이제 사람이 할 차례가 된 사람 작업 이슈. 마일스톤에 있고, 에이전트 몫(준비 라벨)이 아니고,
 * 아직 assign되지 않았고, 의존 이슈가 모두 닫혔다. 마일스톤 끝의 QA 같은 이슈가 여기 해당한다.
 */
export function humanReady(issues: IssueInfo[], readyLabel: string): IssueInfo[] {
  const closed = new Set(issues.filter((i) => i.state === "closed").map((i) => i.number));
  return issues
    .filter((i) => i.state === "open" && i.milestone !== null && i.assignees.length === 0)
    .filter((i) => !i.labels.includes(readyLabel) && !i.labels.some((l) => NOT_HUMAN_WORK.includes(l)))
    .filter((i) => parseDeps(i.body).every((dep) => closed.has(dep)))
    .sort((a, b) => a.number - b.number);
}

/** PR 본문의 `## 에이전트가 정한 것` 절. 없거나 "없음"이면 빈 문자열. */
export function decisionsOf(body: string): string {
  const match = body.match(/^## 에이전트가 정한 것[ \t]*\n([\s\S]*?)(?=^## |^<details>|^---|$(?![\s\S]))/m);
  const text = match?.[1]?.trim() ?? "";
  return text === "없음" || text === "없음." ? "" : text;
}

/** 마지막 사람 차례 코멘트에서 정해 줄 것의 첫 줄. 멘션 줄은 건너뛴다. */
export function reasonOf(comments: CommentInfo[]): string {
  const last = comments.filter((c) => c.body.includes(HUMAN_TURN)).at(-1);
  if (!last) return "";
  const lines = last.body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.includes(HUMAN_TURN) && !l.startsWith("@"));
  const first = lines[0] ?? "";
  return first.length > 120 ? `${first.slice(0, 119)}…` : first;
}

export type ReportInput = {
  /** 밤 근무를 시작한 날 (KST) MM/DD */
  date: string;
  owner: string;
  runUrl: string;
  merged: { number: number; title: string; decisions: string }[];
  humanTurns: { number: number; title: string; reason: string }[];
  /** 지금 에이전트가 고를 수 있는 이슈 수 */
  queue: number;
  /** 슬롯이 사용량 한도나 오류로 중간에 멈췄다 */
  stopped: boolean;
};

export function renderReport(r: ReportInput): string {
  const lines = [
    "<!-- agent:night-report -->",
    `## ${r.date} 밤 근무 보고`,
    "",
    `@${r.owner} merge ${r.merged.length}개 · 내 차례 ${r.humanTurns.length}개 · 남은 에이전트 이슈 ${r.queue}개 · [실행 로그](${r.runUrl})`,
  ];
  if (r.stopped) lines.push("", "> 슬롯이 사용량 한도나 오류로 중간에 멈췄어요. 남은 이슈는 다음 밤에 이어서 해요.");
  if (r.queue === 0 && r.humanTurns.length === 0) lines.push("", "에이전트가 할 이슈가 없어요. 다음 기획이 필요해요.");

  lines.push("", "### 내 차례");
  if (r.humanTurns.length === 0) lines.push("", "없음");
  else lines.push("", ...r.humanTurns.map((h) => `- #${h.number} ${h.title}${h.reason ? ` — ${h.reason}` : ""}`));

  // 에이전트가 정한 것이 있는 PR만 그 절을 아래에 붙인다. 사람은 이 목록만 보고 기획을 고친다.
  lines.push("", "### merge된 PR");
  if (r.merged.length === 0) lines.push("", "없음");
  else lines.push("");
  for (const m of r.merged) {
    lines.push(`- #${m.number} ${m.title}`);
    if (m.decisions) lines.push(...m.decisions.split("\n").map((l) => `  ${l}`));
  }
  return lines.join("\n");
}
