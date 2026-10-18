import { describe, expect, test } from "vitest";

import { parseDeps, selectNext, type IssueInfo } from "./select.mts";

const issue = (number: number, extra: Partial<IssueInfo> = {}): IssueInfo => ({
  number,
  title: `이슈 ${number}`,
  state: "open",
  labels: [],
  milestone: "M1",
  body: "## 의존\n없음\n",
  ...extra,
});
const options = { milestones: ["M1", "M2"], skipLabels: ["needs-human", "blocked", "spike"] };

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
    const issues = [issue(8, { labels: ["needs-human"] }), issue(13, { labels: ["spike"] }), issue(14)];
    expect(selectNext(issues, options)?.number).toBe(14);
  });

  test("마일스톤 순서가 번호보다 먼저다", () => {
    const issues = [issue(5, { milestone: "M2" }), issue(9, { milestone: "M1" })];
    expect(selectNext(issues, options)?.number).toBe(9);
  });

  test("허용 목록에 없는 마일스톤과 마일스톤 없는 이슈는 고르지 않는다", () => {
    expect(selectNext([issue(19, { milestone: "M4" }), issue(27, { milestone: null })], options)).toBeNull();
  });

  test("의존 이슈가 목록에 없으면(삭제·다른 레포) 닫히지 않은 것으로 본다", () => {
    expect(selectNext([issue(4, { body: "## 의존\n#999\n" })], options)).toBeNull();
  });
});
