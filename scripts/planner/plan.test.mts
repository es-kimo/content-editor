import { describe, expect, test } from "vitest";

import {
  blockedReason,
  conversation,
  failureComment,
  hasNewRef,
  nextJob,
  nextVersion,
  orderByRefs,
  parseOutput,
  planJobs,
  planningIssueOf,
  prdTitle,
  releaseReady,
  renderMoves,
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

describe("resolveRefs", () => {
  test("#newK를 만든 순서의 실제 번호로 바꾼다", () => {
    expect(resolveRefs("## 의존\n#new1, #new2, #47\n", [90, 91])).toBe("## 의존\n#90, #91, #47\n");
  });

  test("아직 만들지 않은 이슈는 그대로 두고, 다 만든 뒤 다시 부르면 풀린다", () => {
    const body = "## 배경\n사람 확인은 #new2에서\n\n## 의존\n#new1\n";
    const first = resolveRefs(body, [90]);
    expect(first).toBe("## 배경\n사람 확인은 #new2에서\n\n## 의존\n#90\n");
    expect(hasNewRef(first)).toBe(true);
    expect(hasNewRef(resolveRefs(body, [90, 91]))).toBe(false);
  });
});

describe("orderByRefs", () => {
  const spec = (title: string, deps = "없음", extra = "") => ({
    title,
    body: `## 할 일\n- ${title}${extra}\n\n## 의존\n${deps}\n`,
  });
  const titles = (o: ReturnType<typeof orderByRefs<{ title: string; body: string }>>) =>
    o.ok ? o.issues.map((i) => i.title) : o.errors;

  test("모두 앞을 가리키면 순서와 본문을 그대로 둔다", () => {
    const issues = [spec("a"), spec("b", "#new1"), spec("c", "#new1, #new2")];
    expect(orderByRefs(issues)).toEqual({ ok: true, issues, moved: [] });
  });

  test("뒤 이슈를 가리키면 가리킨 이슈를 바로 앞으로 옮기고 번호를 다시 매긴다", () => {
    // #159 두 번째 실행처럼 중간 이슈가 두 칸 뒤를 가리킨 경우
    const o = orderByRefs([spec("a"), spec("b", "#new4"), spec("c", "#new2"), spec("d", "#new1")]);
    expect(titles(o)).toEqual(["a", "d", "b", "c"]);
    expect(o.ok && o.issues.map((i) => i.body.split("## 의존\n")[1]!.trim())).toEqual([
      "없음",
      "#new1",
      "#new2",
      "#new3",
    ]);
  });

  // 만들 때처럼 앞에서부터 실제 번호를 붙인다. 만든 직후 본문의 의존 절을 돌려준다.
  const depsAtCreation = (issues: { body: string }[]) => {
    const created: number[] = [];
    return issues.map((i) => {
      const body = resolveRefs(i.body, created);
      created.push(100 + created.length);
      return body.split("## 의존\n")[1]!.trim();
    });
  };

  test("옮긴 뒤에는 만들 때 의존이 모두 실제 번호로 풀린다", () => {
    const o = orderByRefs([spec("a", "#new3"), spec("b", "#new3, #new1"), spec("c")]);
    expect(o.ok && depsAtCreation(o.issues)).toEqual(["없음", "#100", "#100, #101"]);
  });

  test("옮긴 의존을 절과 줄로 돌려준다", () => {
    const o = orderByRefs([spec("a", "#new2"), spec("b")]);
    expect(o.ok && o.moved).toEqual([{ from: 1, to: 2, section: "의존", line: "#new2", dependency: true }]);
  });

  test("설명 글이 뒤 이슈를 가리키면 순서는 그대로 두고 번호만 새 순서로 맞춘다", () => {
    const o = orderByRefs([spec("a", "#new3", " (이미지 항목은 #new2에서)"), spec("b"), spec("c")]);
    expect(titles(o)).toEqual(["c", "a", "b"]);
    expect(o.ok && o.issues[1]!.body).toContain("이미지 항목은 #new3에서");
    expect(o.ok && o.moved.map((r) => r.section)).toEqual(["의존"]);
  });

  test("#159 세 번째 실행: 앞 이슈들과 사람 확인 이슈 자신이 설명 글로 그 이슈를 불러도 통과한다", () => {
    const issues = [
      spec("메뉴", "없음", " (브라우저 확인은 #new3로 넘긴다)"),
      spec("이미지", "#new1", " (브라우저 확인은 #new3로 넘긴다)"),
      spec("사람 확인", "#new1, #new2", " (앞선 이슈의 PR 본문에서 #new3로 넘긴 항목도 본다)"),
    ];
    expect(orderByRefs(issues)).toEqual({ ok: true, issues, moved: [] });
  });

  test("의존 절은 `---`에서 끝난다", () => {
    const o = orderByRefs([{ body: "## 의존\n없음\n\n---\n#new2 참고" }, { body: "## 의존\n#new1" }]);
    expect(o.ok).toBe(true);
  });

  test("순환이면 경로와 각 참조 줄을 오류로 돌려준다", () => {
    const o = orderByRefs([spec("a"), spec("b", "#new3"), spec("c", "#new2")]);
    expect(o).toEqual({
      ok: false,
      errors: [
        "의존 순환: 이슈 2 → 이슈 3 → 이슈 2",
        "이슈 2의 #new3 (의존: `#new3`)",
        "이슈 3의 #new2 (의존: `#new2`)",
      ],
    });
  });

  test("설명 글끼리 서로 가리켜도 순환이 아니다", () => {
    const o = orderByRefs([spec("a", "없음", " (#new2와 같이 본다)"), spec("b", "#new1", " (#new1 다음)")]);
    expect(titles(o)).toEqual(["a", "b"]);
  });

  test("없는 번호를 가리키거나 자기 자신에 의존하면 오류", () => {
    expect(titles(orderByRefs([spec("a", "#new1"), spec("b", "없음", " #new5")]))).toEqual([
      "이슈 1의 #new1 (의존: `#new1`): 자기 자신에 의존한다",
      "이슈 2의 #new5 (할 일: `- b #new5`): 없는 이슈를 가리킨다",
    ]);
  });
});

describe("renderMoves", () => {
  test("옮긴 것이 없으면 빈 문자열", () => {
    expect(renderMoves(["a"], [])).toBe("");
  });

  test("어느 이슈가 어느 이슈를 어느 절에서 가리켰는지 적는다", () => {
    expect(
      renderMoves(["메뉴", "이미지"], [{ from: 1, to: 2, section: "의존", line: "#new2", dependency: true }]),
    ).toBe(
      "\n\n뒤 이슈를 가리킨 참조가 있어서 가리킨 이슈를 앞으로 옮겼어요.\n- 「메뉴」 → 「이미지」 (의존: `#new2`)",
    );
  });
});

describe("failureComment", () => {
  test("이유를 인용해 넣어서 다음 실행이 대화에서 읽게 한다", () => {
    expect(failureComment("순환 참조: 이슈 2 → 이슈 3 → 이슈 2\n이슈 2의 #new3")).toBe(
      "기획자 실행이 실패했어요.\n\n> 순환 참조: 이슈 2 → 이슈 3 → 이슈 2\n> 이슈 2의 #new3\n\n다시 코멘트를 달면 이 이유를 보고 다시 시도해요.",
    );
  });

  test("이유가 없으면 실행 로그를 보라고 한다", () => {
    expect(failureComment(null)).toContain("실행 로그를 확인해 주세요");
    expect(failureComment("  ")).toContain("실행 로그를 확인해 주세요");
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
