import { describe, expect, test } from "vitest";

import { HUMAN_TURN, decisionsOf, humanReady, reasonOf, renderReport, type ReportInput } from "./report.mts";
import type { IssueInfo } from "./select.mts";

const issue = (number: number, extra: Partial<IssueInfo> = {}): IssueInfo => ({
  number,
  title: `이슈 ${number}`,
  state: "open",
  labels: ["ui"],
  assignees: [],
  milestone: "v0.3",
  body: "## 의존\n없음\n",
  ...extra,
});

describe("humanReady", () => {
  test("의존 이슈가 모두 닫힌 사람 작업 이슈만 고른다", () => {
    const issues = [
      issue(97, { state: "closed", labels: ["ui", "agent-ready"] }),
      issue(98, { body: "## 의존\n#97\n" }),
      issue(99, { body: "## 의존\n#100\n" }),
      issue(100, { labels: ["ui", "agent-ready"] }),
    ];
    expect(humanReady(issues, "agent-ready").map((i) => i.number)).toEqual([98]);
  });

  test("에이전트 몫, 이미 assign된 것, 마일스톤 밖, 기획·보고 이슈는 고르지 않는다", () => {
    const issues = [
      issue(1, { labels: ["agent-ready"] }),
      issue(2, { assignees: ["es-kimo"] }),
      issue(3, { milestone: null }),
      issue(4, { labels: ["planning"] }),
      issue(5, { labels: ["blocked"] }),
    ];
    expect(humanReady(issues, "agent-ready")).toEqual([]);
  });
});

describe("decisionsOf", () => {
  const body = (decisions: string) =>
    `Closes #9\n\n## 작업 내용\n- 무엇\n\n## 에이전트가 정한 것\n${decisions}\n\n<details><summary>리뷰</summary>\n\n## 숨은 절\n</details>\n\n---\n바닥글`;

  test("절의 내용만 읽고 리뷰 접힘과 바닥글은 뺀다", () => {
    expect(decisionsOf(body("- 버튼 이름을 '넣기'로 → '추가'도 가능 → PRD 용어"))).toBe(
      "- 버튼 이름을 '넣기'로 → '추가'도 가능 → PRD 용어",
    );
  });

  test("없음이거나 절이 없으면 빈 문자열", () => {
    expect(decisionsOf(body("없음"))).toBe("");
    expect(decisionsOf("Closes #9\n\n## 작업 내용\n- 무엇\n")).toBe("");
  });

  test("다음 절 앞에서 끊는다", () => {
    expect(decisionsOf("## 에이전트가 정한 것\n- 하나\n## 확인 방법\n- 테스트")).toBe("- 하나");
  });
});

describe("reasonOf", () => {
  const turn = (text: string, createdAt = "2026-10-21T15:00:00Z") => ({
    body: `${HUMAN_TURN}\n@es-kimo 정해 줄 것이 있어요 · [실행 로그](x)\n\n${text}\n\n답을 코멘트로 남기고 assign을 풀면 다음 밤에 이어서 해요.`,
    createdAt,
  });

  test("마지막 사람 차례 코멘트의 멘션 다음 첫 줄", () => {
    expect(reasonOf([turn("예전 질문"), { body: "답", createdAt: "x" }, turn("design.md를 누가 고칠지")])).toBe(
      "design.md를 누가 고칠지",
    );
  });

  test("멘션만 있는 줄은 이유로 쓰지 않는다", () => {
    const body = `${HUMAN_TURN}\n@es-kimo\n\n의존 작업이 모두 끝나서 이 이슈를 할 차례예요.`;
    expect(reasonOf([{ body, createdAt: "x" }])).toBe("의존 작업이 모두 끝나서 이 이슈를 할 차례예요.");
  });

  test("사람 차례 코멘트가 없으면 빈 문자열", () => {
    expect(reasonOf([{ body: "그냥 코멘트", createdAt: "x" }])).toBe("");
  });
});

describe("renderReport", () => {
  const base: ReportInput = {
    date: "10/21",
    owner: "es-kimo",
    runUrl: "https://run",
    merged: [],
    humanTurns: [],
    queue: 3,
    stopped: false,
  };

  test("소유자를 멘션하고 내 차례를 merge 목록보다 먼저 쓴다", () => {
    const text = renderReport({
      ...base,
      merged: [{ number: 110, title: "목차 폼", decisions: "- 목차 위치를 본문 앞으로" }],
      humanTurns: [{ number: 98, title: "QA", reason: "" }],
    });
    expect(text).toContain("@es-kimo merge 1개 · 내 차례 1개 · 남은 에이전트 이슈 3개");
    expect(text.indexOf("### 내 차례")).toBeLessThan(text.indexOf("### merge된 PR"));
    expect(text).toContain("- #98 QA\n");
    expect(text).toContain("- #110 목차 폼\n  - 목차 위치를 본문 앞으로");
  });

  test("정한 것이 없는 PR은 제목 한 줄만 쓴다", () => {
    const text = renderReport({
      ...base,
      merged: [
        { number: 84, title: "미저장 표시", decisions: "" },
        { number: 86, title: "첨부", decisions: "" },
      ],
    });
    expect(text).toContain("### merge된 PR\n\n- #84 미저장 표시\n- #86 첨부");
  });

  test("남은 일이 없으면 기획이 필요하다고 쓴다", () => {
    expect(renderReport({ ...base, queue: 0 })).toContain("다음 기획이 필요해요");
    expect(renderReport({ ...base, queue: 0, humanTurns: [{ number: 1, title: "t", reason: "r" }] })).not.toContain(
      "다음 기획이 필요해요",
    );
  });

  test("슬롯이 멈췄으면 알린다", () => {
    expect(renderReport({ ...base, stopped: true })).toContain("중간에 멈췄어요");
    expect(renderReport(base)).not.toContain("중간에 멈췄어요");
  });
});
