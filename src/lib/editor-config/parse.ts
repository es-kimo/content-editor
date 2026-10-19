import { z } from "zod";

import { editorConfigSchema, METADATA_FIELD_TYPES, type EditorConfig } from "./schema";

/** `path`는 `collections[0].metadata["other.status"].options`처럼 config 안의 위치다. 파일 전체에 대한 오류는 빈 문자열. */
export type ConfigIssue = { path: string; message: string };

export type ConfigResult = { ok: true; config: EditorConfig } | { ok: false; issues: ConfigIssue[] };

/** editor.config.json 내용을 읽고 검증한다. */
export function parseEditorConfig(text: string): ConfigResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: [{ path: "", message: `JSON 문법 오류: ${(error as Error).message}` }] };
  }
  return validateEditorConfig(value);
}

export function validateEditorConfig(value: unknown): ConfigResult {
  const result = editorConfigSchema.safeParse(value, { error: (issue) => issueMessage(issue) ?? koreanLocale(issue) });
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, issues: result.error.issues.flatMap(toConfigIssues) };
}

/** 사람이 읽을 여러 줄 문자열로 만든다. */
export function formatConfigIssues(issues: ConfigIssue[]): string {
  return issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join("\n");
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((key, i) => {
      if (typeof key === "number") return `[${key}]`;
      const name = String(key);
      if (/^[A-Za-z_$][\w$]*$/.test(name)) return i === 0 ? name : `.${name}`;
      return `[${JSON.stringify(name)}]`;
    })
    .join("");
}

function toConfigIssues(issue: z.core.$ZodIssue): ConfigIssue[] {
  // 위치를 키 하나하나로 알려야 오타를 찾기 쉽다.
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({ path: formatPath([...issue.path, key]), message: "알 수 없는 키다" }));
  }
  return [{ path: formatPath(issue.path), message: issue.message }];
}

// 직접 다루지 않는 issue는 zod의 한국어 메시지로 보인다.
const koreanLocale = z.locales.ko().localeError;

const TYPE_NAMES: Record<string, string> = {
  string: "문자열",
  number: "숫자",
  boolean: "true/false",
  array: "배열",
  object: "객체",
  null: "null",
};

function typeOf(input: unknown): string {
  if (input === null) return "null";
  if (Array.isArray(input)) return "array";
  return typeof input;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const quote = (values: readonly unknown[]) => values.map((v) => JSON.stringify(v)).join(", ");

function issueMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) return "필수 항목이 없다";
      return `${TYPE_NAMES[issue.expected] ?? issue.expected} 타입이어야 한다 (받은 값: ${TYPE_NAMES[typeOf(issue.input)] ?? typeOf(issue.input)})`;
    case "too_small":
      if (issue.origin === "string") return "비어 있으면 안 된다";
      if (issue.origin === "array") return `${issue.minimum}개 이상 있어야 한다`;
      return undefined;
    case "invalid_value":
      return `${quote(issue.values)} 중 하나여야 한다 (받은 값: ${JSON.stringify(issue.input)})`;
    case "invalid_union":
      // 판별 키가 맞지 않는 경우다. issue.input은 판별 키의 값이 아니라 필드 객체 전체다.
      if (issue.discriminator === "type") {
        const value = isRecord(issue.input) ? issue.input.type : undefined;
        if (value === undefined) return `필수 항목이 없다. ${quote(METADATA_FIELD_TYPES)} 중 하나`;
        return `${quote(METADATA_FIELD_TYPES)} 중 하나여야 한다 (받은 값: ${JSON.stringify(value)})`;
      }
      return undefined;
    default:
      return undefined;
  }
}
