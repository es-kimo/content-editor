import type { MetadataValue } from "@/lib/mdx-doc";

type Datetime = { date: string; hour: string; minute: string; second: string | null; ms: string | null; z: boolean };

const DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z)?$/;

function parseDatetime(value: string): Datetime | null {
  const match = DATETIME.exec(value);
  if (!match) return null;
  const [, date, hour, minute, second, ms, z] = match;
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return null;
  return { date: date!, hour: hour!, minute: minute!, second: second ?? null, ms: ms ?? null, z: z !== undefined };
}

/** `<input type="datetime-local" step="1">` 값. 초까지만 다룬다. */
function formatLocal(d: Datetime): string {
  return `${d.date}T${d.hour}:${d.minute}:${d.second ?? "00"}`;
}

/**
 * 원래 값의 형식(초, 밀리초, `Z`)을 따라 쓴다. 원래 값이 없으면 사이트 글 대부분이 쓰는 `YYYY-MM-DDTHH:mm:ssZ`.
 * 폼 값은 시간대 변환 없이 적힌 숫자 그대로 쓴다. 기존 글은 `Z`가 붙어 있어도 날짜만 의미가 있는 자정 값이라,
 * 브라우저 시간대로 바꾸면 날짜가 하루 밀린다.
 */
function formatDatetime(d: Datetime, original: Datetime | null): string {
  const style = original ?? { second: "00", ms: null, z: true };
  let text = `${d.date}T${d.hour}:${d.minute}`;
  if (style.second !== null || (d.second !== null && d.second !== "00")) text += `:${d.second ?? "00"}`;
  if (style.ms !== null) text += `.${(d.ms ?? "0").padEnd(style.ms.length, "0")}`;
  return style.z ? `${text}Z` : text;
}

/** 지금 시각을 폼이 원래 값이 없을 때 쓰는 형식(`YYYY-MM-DDTHH:mm:ssZ`)으로. */
export function datetimeNow(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** metadata의 날짜 값을 datetime-local 입력 문자열로. 날짜 형식이 아니면 null. */
export function datetimeInput(value: string): string | null {
  const parsed = parseDatetime(value);
  return parsed ? formatLocal(parsed) : null;
}

/** datetime-local 입력을 metadata 값으로. 빈 입력은 `undefined`(키를 지운다). 입력에서 보이는 값이 그대로면 원래 값을 둔다. */
export function datetimeValue(
  raw: string,
  current: MetadataValue | undefined,
): { ok: true; value: MetadataValue | undefined } | { ok: false; message: string } {
  if (raw.trim() === "") return { ok: true, value: undefined };
  const parsed = parseDatetime(raw.trim());
  if (!parsed) return { ok: false, message: "날짜와 시각을 다시 입력해 주세요." };
  const original = typeof current === "string" ? parseDatetime(current) : null;
  if (original && formatLocal(original) === formatLocal(parsed)) return { ok: true, value: current };
  return { ok: true, value: formatDatetime(parsed, original) };
}
