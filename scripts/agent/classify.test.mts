import { describe, expect, test } from "vitest";

import { classifyRun } from "./classify.mts";

const init = { type: "system", subtype: "init", model: "claude-opus-5-5" };
const result = (extra: Record<string, unknown>) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "끝",
  modelUsage: { "claude-opus-5-5": {}, "claude-haiku-5-5": {} },
  ...extra,
});

describe("classifyRun", () => {
  test("정상 종료와 사용 모델", () => {
    expect(classifyRun([init, result({})])).toEqual({
      kind: "ok",
      models: ["claude-opus-5-5", "claude-haiku-5-5"],
      detail: "끝",
    });
  });

  test("정상 종료면 json-schema 결과를 structured로 넘긴다", () => {
    const output = { status: "done", summary: "요약" };
    expect(classifyRun([init, result({ num_turns: 287, structured_output: output })])).toMatchObject({
      kind: "ok",
      structured: output,
    });
  });

  test("오류로 끝나면 structured_output이 있어도 넘기지 않는다", () => {
    const info = classifyRun([
      init,
      result({ subtype: "error_during_execution", is_error: true, structured_output: { status: "done" } }),
    ]);
    expect(info.kind).toBe("error");
    expect(info.structured).toBeUndefined();
  });

  test("턴 상한", () => {
    expect(classifyRun([init, result({ subtype: "error_max_turns", is_error: true })]).kind).toBe("max_turns");
  });

  test.each([
    "Claude AI usage limit reached|1760000000",
    "API Error: 429 rate_limit_error",
    "API Error: 529 overloaded_error",
  ])("한도·과부하: %s", (text) => {
    expect(classifyRun([init, result({ subtype: "error_during_execution", is_error: true, result: text })]).kind).toBe(
      "limit",
    );
  });

  test("result 메시지 없이 한도 문구로 끝나면 limit", () => {
    expect(classifyRun([init, { type: "assistant", message: { content: "usage limit reached" } }]).kind).toBe("limit");
  });

  test("그 밖의 오류는 error", () => {
    expect(
      classifyRun([init, result({ subtype: "error_during_execution", is_error: true, result: "boom" })]).kind,
    ).toBe("error");
  });

  test("기록이 없으면 missing", () => {
    expect(classifyRun(null).kind).toBe("missing");
    expect(classifyRun([]).kind).toBe("missing");
  });
});
