/**
 * `claude -p --output-format stream-json`의 메시지 배열에서 실행 결과를 분류한다.
 * - limit: 사용량·속도 한도. 시도 실패로 세지 않고 나중에 다시 시도한다.
 * - max_turns: 턴 상한에 걸림. 시도 실패로 센다.
 * - error: 그 밖의 오류. 시도 실패로 센다.
 * - ok: 정상 종료. `--json-schema`로 받은 결과가 있으면 `structured`에 담는다.
 * - missing: 실행 기록이 없다 (Claude가 시작하지 못함).
 */
export type RunKind = "ok" | "limit" | "max_turns" | "error" | "missing";
export type RunInfo = { kind: RunKind; models: string[]; detail: string; structured?: unknown };

type ResultMessage = {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
  modelUsage?: Record<string, unknown>;
  structured_output?: unknown;
};

type RateLimitEvent = { type: "rate_limit_event"; rate_limit_info?: { status?: string } };

const LIMIT_PATTERN = /usage limit|rate limit|limit reached|rate_limit|429|overloaded/i;

const isRateLimitEvent = (m: unknown): m is RateLimitEvent =>
  typeof m === "object" && m !== null && (m as RateLimitEvent).type === "rate_limit_event";

export function classifyRun(messages: unknown): RunInfo {
  if (!Array.isArray(messages) || messages.length === 0) return { kind: "missing", models: [], detail: "" };
  const result = [...messages]
    .reverse()
    .find((m): m is ResultMessage => typeof m === "object" && m !== null && (m as ResultMessage).type === "result");
  // rate_limit_event는 한도에 닿지 않아도 사용률을 알리려고 온다. 문구 검사에서 빼고, 거절됐을 때만 한도로 본다.
  const rejected = messages.some((m) => isRateLimitEvent(m) && m.rate_limit_info?.status === "rejected");
  const text = JSON.stringify(messages.filter((m) => !isRateLimitEvent(m)).slice(-3));
  if (!result) {
    return { kind: rejected || LIMIT_PATTERN.test(text) ? "limit" : "error", models: [], detail: "result 메시지 없음" };
  }
  const models = Object.keys(result.modelUsage ?? {});
  const detail = (result.result ?? result.subtype ?? "").slice(0, 300);
  if (result.subtype === "error_max_turns") return { kind: "max_turns", models, detail };
  if (result.is_error || result.subtype !== "success") {
    return {
      kind: rejected || LIMIT_PATTERN.test(`${result.result ?? ""} ${text}`) ? "limit" : "error",
      models,
      detail,
    };
  }
  if (result.structured_output !== undefined && result.structured_output !== null) {
    return { kind: "ok", models, detail, structured: result.structured_output };
  }
  return { kind: "ok", models, detail };
}
