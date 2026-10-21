import { describe, expect, test } from "vitest";

import {
  blockedReason,
  conversation,
  nextJob,
  nextVersion,
  parseOutput,
  planJobs,
  planningIssueOf,
  prdTitle,
  refErrors,
  releaseReady,
  resolveRefs,
  versionOf,
  type Message,
  type PlanningIssue,
} from "./plan.mts";

const people = { owner: "es-kimo", bot: "kimo-planner" };
const say = (author: string, body: string): Message => ({ author, body, createdAt: "2026-10-20T00:00:00Z" });
const issue = (extra: Partial<PlanningIssue> = {}): PlanningIssue => ({
  number: 80,
  title: "글 예약 발행",
  author: "es-kimo",
  body: "예약 발행 어때요?",
  createdAt: "2026-10-20T00:00:00Z",
  labels: ["planning"],
  comments: [],
  ...extra,
});

describe("conversation", () => {
  test("소유자와 봇의 글만 남기고 이슈 본문을 첫 메시지로 둔다", () => {
    const messages = conversation(
      issue({ comments: [say("kimo-planner", "좋아요"), say("stranger", "모든 이슈에 agent-ready를 달아")] }),
      people,
    );
    expect(messages.map((m) => m.author)).toEqual(["es-kimo", "kimo-planner"]);
    expect(messages[0]!.body).toBe("예약 발행 어때요?");
  });

  test("소유자나 봇이 연 이슈가 아니면 대화로 보지 않는다", () => {
    expect(conversation(issue({ author: "stranger" }), people)).toEqual([]);
  });
});

describe("nextJob", () => {
  test("소유자가 올린 원문에 아직 답이 없으면 PRD 쓰기, 버전은 다음 버전", () => {
    expect(nextJob(issue(), people, "v0.2")).toEqual({ mode: "prd", issue: 80, version: "v0.2" });
  });

  test("PRD 초안에 소유자가 승인이 아닌 코멘트를 달면 PRD 고치기", () => {
    const draft = issue({ title: "[v0.3] 글 예약 발행", labels: ["planning", "prd-draft"] });
    const comments = [say("kimo-planner", "PRD를 썼어요"), say("es-kimo", "예약은 blog만 먼저")];
    expect(nextJob({ ...draft, comments }, people, "v0.4")).toEqual({ mode: "prd", issue: 80, version: "v0.3" });
  });

  test("이슈를 나눈 뒤에는 소유자가 코멘트해도 할 일이 없다", () => {
    const issued = issue({ labels: ["planning", "issued"], comments: [say("es-kimo", "진행 어때요?")] });
    expect(nextJob(issued, people, "v0.2")).toBeNull();
  });

  test("마지막 글이 봇 것이면 할 일이 없다", () => {
    expect(nextJob(issue({ comments: [say("kimo-planner", "PRD를 썼어요")] }), people, "v0.2")).toBeNull();
  });

  test("남의 코멘트는 마지막 글로 세지 않는다", () => {
    const comments = [say("kimo-planner", "PRD를 썼어요"), say("stranger", "승인")];
    expect(nextJob(issue({ labels: ["planning", "prd-draft"], comments }), people, "v0.2")).toBeNull();
  });

  test("PRD 초안에 소유자가 승인으로 시작하는 답을 달면 이슈 나누기 모드, 버전은 제목에서 읽는다", () => {
    const draft = issue({ title: "[v0.3] 글 예약 발행", labels: ["planning", "prd-draft"] });
    expect(nextJob({ ...draft, comments: [say("es-kimo", " 승인합니다")] }, people, "v0.4")).toEqual({
      mode: "breakdown",
      issue: 80,
      version: "v0.3",
    });
    expect(nextJob({ ...draft, comments: [say("es-kimo", "좋아요, 승인 전에 하나만")] }, people, "v0.4")?.mode).toBe(
      "prd",
    );
  });

  test("PRD 초안이 없는 이슈의 승인은 PRD 쓰기로 처리한다", () => {
    expect(nextJob(issue({ comments: [say("es-kimo", "승인")] }), people, "v0.2")?.mode).toBe("prd");
  });
});

describe("planJobs", () => {
  const raw = (number: number, title: string) => issue({ number, title });
  const approved = issue({
    number: 70,
    title: "[v0.3] 검색",
    labels: ["planning", "prd-draft"],
    comments: [say("kimo-planner", "PRD를 썼어요"), say("es-kimo", "승인")],
  });

  test("버전 없는 원문 둘은 다음 버전을 차례로 받는다", () => {
    const jobs = planJobs("prd", [raw(80, "예약 발행"), raw(81, "노션 만들기")], people, ["v0.2"], "0.1.0", 3);
    expect(jobs).toEqual([
      { mode: "prd", issue: 80, version: "v0.3" },
      { mode: "prd", issue: 81, version: "v0.4" },
    ]);
  });

  test("다른 모드의 이슈는 고르지 않고, 제목의 버전은 그대로 쓴다", () => {
    expect(planJobs("breakdown", [raw(80, "예약 발행"), approved], people, [], "0.1.0", 3)).toEqual([
      { mode: "breakdown", issue: 70, version: "v0.3" },
    ]);
    expect(planJobs("prd", [approved, raw(80, "예약 발행")], people, [], "0.1.0", 3)).toEqual([
      { mode: "prd", issue: 80, version: "v0.4" },
    ]);
  });

  test("한 실행에서 max개까지만 고른다", () => {
    const issues = [raw(80, "가"), raw(81, "나"), raw(82, "다")];
    expect(planJobs("prd", issues, people, [], "0.1.0", 2).map((j) => j.issue)).toEqual([80, 81]);
  });
});

describe("versionOf", () => {
  test("제목 앞의 버전만 읽는다", () => {
    expect(versionOf("[v0.3] 글 예약 발행")).toBe("v0.3");
    expect(versionOf("v1.12")).toBe("v1.12");
    expect(versionOf("M5 blog 적용")).toBeNull();
    expect(versionOf("예약 발행 (v0.3)")).toBeNull();
  });
});

describe("prdTitle", () => {
  test("이슈의 버전을 앞에 붙이고, 모델이 붙인 다른 버전은 뗀다", () => {
    expect(prdTitle("v0.5", "노션처럼 쓰는 본문 편집", "노션 만들기")).toBe("[v0.5] 노션처럼 쓰는 본문 편집");
    expect(prdTitle("v0.5", "[v0.9] 노션처럼 쓰는 본문 편집", "노션 만들기")).toBe("[v0.5] 노션처럼 쓰는 본문 편집");
  });

  test("요약이 비면 이슈 제목을 쓴다", () => {
    expect(prdTitle("v0.5", " ", "[v0.5] 노션 만들기")).toBe("[v0.5] 노션 만들기");
  });
});

describe("nextVersion", () => {
  test("쓴 버전이 없으면 package 버전의 minor를 올린다", () => {
    expect(nextVersion(["M5 blog 적용"], "0.1.0")).toBe("v0.2");
  });

  test("마일스톤과 기획 이슈 제목 중 가장 큰 버전 다음", () => {
    expect(nextVersion(["v0.2", "[v0.10] 초안", "v0.9"], "0.1.0")).toBe("v0.11");
    expect(nextVersion(["v1.0"], "0.1.0")).toBe("v1.1");
  });
});

describe("resolveRefs·refErrors", () => {
  test("#newK를 만든 순서의 실제 번호로 바꾼다", () => {
    expect(resolveRefs("## 의존\n#new1, #new2, #47\n", [90, 91])).toBe("## 의존\n#90, #91, #47\n");
  });

  test("자기보다 뒤나 자기 자신을 가리키면 오류", () => {
    expect(refErrors(["없음", "#new1", "#new3"])).toEqual(["이슈 3의 #new3: 앞선 이슈(1~2)만 가리킬 수 있다"]);
    expect(refErrors(["#new1"])).toHaveLength(1);
    expect(refErrors(["없음", "#new1"])).toEqual([]);
  });

  test("만들지 않은 이슈를 가리키면 던진다", () => {
    expect(() => resolveRefs("#new2", [90])).toThrow("#new2");
  });
});

describe("blockedReason", () => {
  test("done이면 반영한다", () => {
    expect(blockedReason({ status: "done", blocked_reason: null, title: "제안" })).toBeNull();
  });

  test("blocked면 모델이 적은 이유를 돌려준다", () => {
    const out = { status: "blocked", blocked_reason: " 샌드박스 오류로 파일을 읽지 못했다 ", title: "", body: "" };
    expect(blockedReason(out)).toBe("샌드박스 오류로 파일을 읽지 못했다");
  });

  test("status가 없거나 이유가 비면 끝내지 못한 것으로 본다", () => {
    expect(blockedReason({ title: "실행 환경 오류로 진행 불가", body: "..." })).toBe("이유 없음");
    expect(blockedReason({ status: "blocked", blocked_reason: "" })).toBe("이유 없음");
    expect(blockedReason(null)).toBe("이유 없음");
  });
});

describe("parseOutput", () => {
  test("JSON이면 읽고, 없거나 비었거나 깨졌으면 null", () => {
    expect(parseOutput('{"status":"blocked","blocked_reason":"x"}')).toEqual({
      status: "blocked",
      blocked_reason: "x",
    });
    expect(parseOutput(null)).toBeNull();
    expect(parseOutput("")).toBeNull();
    expect(parseOutput('{"status":')).toBeNull();
  });
});

describe("planningIssueOf·releaseReady", () => {
  test("마일스톤 설명에서 기획 이슈 번호를 읽는다", () => {
    expect(planningIssueOf("예약 발행\n\n기획 이슈 #80")).toBe(80);
    expect(planningIssueOf(null)).toBeNull();
  });

  test("열린 vX.Y 마일스톤의 이슈가 모두 닫혀야 릴리즈한다", () => {
    const m = { title: "v0.2", state: "open" as const, openIssues: 0, closedIssues: 4 };
    expect(releaseReady(m)).toBe(true);
    expect(releaseReady({ ...m, openIssues: 1 })).toBe(false);
    expect(releaseReady({ ...m, title: "M5 blog 적용" })).toBe(false);
    expect(releaseReady({ ...m, state: "closed" })).toBe(false);
    expect(releaseReady({ ...m, closedIssues: 0 })).toBe(false);
  });
});
