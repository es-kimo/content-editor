/**
 * claude-code-action의 execution_file(SDK 메시지 배열)에서 실행 결과를 분류한다.
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

const LIMIT_PATTERN = /usage limit|rate limit|limit reached|rate_limit|429|overloaded/i;

export function classifyRun(messages: unknown): RunInfo {
  if (!Array.isArray(messages) || messages.length === 0) return { kind: "missing", models: [], detail: "" };
  const result = [...messages]
    .reverse()
    .find((m): m is ResultMessage => typeof m === "object" && m !== null && (m as ResultMessage).type === "result");
  const text = JSON.stringify(messages.slice(-3));
  if (!result) {
    return { kind: LIMIT_PATTERN.test(text) ? "limit" : "error", models: [], detail: "result 메시지 없음" };
  }
  const models = Object.keys(result.modelUsage ?? {});
  const detail = (result.result ?? result.subtype ?? "").slice(0, 300);
  if (result.subtype === "error_max_turns") return { kind: "max_turns", models, detail };
  if (result.is_error || result.subtype !== "success") {
    return { kind: LIMIT_PATTERN.test(`${result.result ?? ""} ${text}`) ? "limit" : "error", models, detail };
  }
  // 정상 종료여도 action은 num_turns(도구 결과 수)를 --max-turns(모델 호출 수)와 비교해 실패로 돌리고
  // structured_output을 내보내지 않는다 (anthropics/claude-code-action#1795). 워크플로는 결과를 여기서 읽는다.
  if (result.structured_output !== undefined && result.structured_output !== null) {
    return { kind: "ok", models, detail, structured: result.structured_output };
  }
  return { kind: "ok", models, detail };
}
