import { describe, expect, test } from "vitest";

import { ATTEMPT_FAILED, candidates, failedSince, parseDeps, selectNext, type IssueInfo } from "./select.mts";

const issue = (number: number, extra: Partial<IssueInfo> = {}): IssueInfo => ({
  number,
  title: `이슈 ${number}`,
  state: "open",
  labels: ["agent-ready"],
  assignees: [],
  milestone: null,
  body: "## 의존\n없음\n",
  ...extra,
});
const options = { readyLabel: "agent-ready", skipLabels: ["blocked", "spike"] };

describe("parseDeps", () => {
  test("의존 절의 번호만 읽는다", () => {
    const body = "## 할 일\n- #99 참고\n\n## 의존\n#3, #25\n\n---\n[PRD](x) #100";
    expect(parseDeps(body)).toEqual([3, 25]);
  });

  test("없음이거나 절이 없으면 빈 배열", () => {
    expect(parseDeps("## 의존\n없음\n")).toEqual([]);
    expect(parseDeps("## 할 일\n- #1\n")).toEqual([]);
  });

  test("의존 절이 본문 끝이어도 읽는다", () => {
    expect(parseDeps("## 의존\n#8")).toEqual([8]);
  });
});

describe("selectNext", () => {
  test("의존 이슈가 열려 있으면 건너뛴다", () => {
    const issues = [issue(3), issue(4, { body: "## 의존\n#3\n" }), issue(5)];
    expect(selectNext(issues, options)?.number).toBe(3);
    expect(selectNext([issue(3, { state: "closed" }), ...issues.slice(1)], options)?.number).toBe(4);
  });

  test("건너뛸 라벨이 있으면 고르지 않는다", () => {
    const issues = [
      issue(8, { labels: ["agent-ready", "blocked"] }),
      issue(13, { labels: ["agent-ready", "spike"] }),
      issue(14),
    ];
    expect(selectNext(issues, options)?.number).toBe(14);
  });

  test("준비 라벨이 없는 이슈는 고르지 않는다", () => {
    expect(selectNext([issue(19, { labels: [] }), issue(27, { labels: ["site"] })], options)).toBeNull();
    expect(
      selectNext([issue(19, { labels: [] }), issue(27, { labels: ["site", "agent-ready"] })], options)?.number,
    ).toBe(27);
  });

  test("후보가 여럿이면 번호가 작은 것부터", () => {
    expect(selectNext([issue(52), issue(47), issue(50)], options)?.number).toBe(47);
  });

  test("의존 이슈가 목록에 없으면(삭제·다른 레포) 닫히지 않은 것으로 본다", () => {
    expect(selectNext([issue(4, { body: "## 의존\n#999\n" })], options)).toBeNull();
  });

  test("assignee가 있으면 사람 차례라 고르지 않는다", () => {
    expect(selectNext([issue(5, { assignees: ["es-kimo"] }), issue(6)], options)?.number).toBe(6);
    expect(selectNext([issue(5, { assignees: ["es-kimo"] })], options)).toBeNull();
  });
});

describe("candidates", () => {
  test("고를 수 있는 이슈를 번호 순서로 모두 돌려준다", () => {
    const issues = [issue(9), issue(3, { assignees: ["es-kimo"] }), issue(7), issue(8, { body: "## 의존\n#9\n" })];
    expect(candidates(issues, options).map((i) => i.number)).toEqual([7, 9]);
  });
});

describe("failedSince", () => {
  const failed = (createdAt: string) => ({ body: `${ATTEMPT_FAILED}\n구현 시도 실패`, createdAt });

  test("시작 시각 뒤의 실패 표시만 센다", () => {
    expect(failedSince([failed("2026-10-21T15:00:00Z")], "2026-10-21T14:00:00Z")).toBe(true);
    expect(failedSince([failed("2026-10-20T15:00:00Z")], "2026-10-21T14:00:00Z")).toBe(false);
  });

  test("실패 표시가 없는 코멘트는 세지 않는다", () => {
    expect(failedSince([{ body: "구현 시도 실패", createdAt: "2026-10-21T15:00:00Z" }], "2026-10-21T14:00:00Z")).toBe(
      false,
    );
  });
});
