import type { Collection, MetadataField } from "@/lib/editor-config";
import type { MetadataValue } from "@/lib/mdx-doc";

type MetadataObject = { [key: string]: MetadataValue };

/** 폼 입력 하나. 직렬화할 수 있는 값만 담아 클라이언트 컴포넌트에 그대로 넘긴다. */
export type FormField = {
  /** config의 키 (`other.createdAt`). 폼 입력의 name에도 쓴다. */
  key: string;
  label: string;
  type: MetadataField["type"];
  required: boolean;
  /** select의 선택지. 지금 값이 선택지에 없으면 그 값을 맨 앞에 더해 그대로 둘 수 있게 한다. */
  options: string[];
  /** 폼에 처음 채울 값. string[]는 한 줄에 하나. */
  initial: string;
  /**
   * 지금 값이 필드 타입과 맞지 않아 폼으로 고치지 않는 이유. 이 필드는 저장할 때 원래 값을 그대로 둔다.
   * (yjshd 강좌의 `keywords`는 배열이 아니라 문자열인 글이 있다)
   */
  locked: string | null;
};

export type FormValues = { [key: string]: string };

export type ApplyResult =
  { ok: true; value: MetadataObject } | { ok: false; errors: { key: string; message: string }[] };

export const FIELD_PREFIX = "metadata:";

/** config의 metadata 정의와 글의 지금 값으로 폼을 만든다. config에 적힌 순서를 따른다. */
export function buildForm(collection: Collection, metadata: MetadataObject): FormField[] {
  return Object.entries(collection.metadata).map(([key, field]) => {
    const found = lookup(metadata, key);
    const base = {
      key,
      label: field.label ?? key,
      type: field.type,
      required: field.required ?? false,
      options: field.type === "select" ? [...field.options] : [],
    };
    if (found.kind === "blocked") return { ...base, initial: "", locked: found.reason };
    if (found.kind === "missing") return { ...base, initial: "", locked: null };
    const initial = toInput(field, found.value);
    if (initial === null) return { ...base, initial: "", locked: `값이 ${field.type} 형식이 아니다` };
    if (field.type === "select" && !base.options.includes(initial)) base.options.unshift(initial);
    return { ...base, initial, locked: null };
  });
}

/** 제출된 FormData에서 config 필드의 값만 꺼낸다. 없는 입력은 빠진다. */
export function readFormData(collection: Collection, data: FormData): FormValues {
  const values: FormValues = {};
  for (const key of Object.keys(collection.metadata)) {
    const value = data.get(FIELD_PREFIX + key);
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/**
 * 폼 값을 metadata에 반영한 새 객체를 만든다. config에 없는 키와 키 순서는 그대로 둔다.
 * 원래 없던 키는 값을 채웠을 때만 끝에 더한다. 고칠 수 없는 필드(locked)와 제출되지 않은 필드는 원래 값을 둔다.
 */
export function applyForm(collection: Collection, metadata: MetadataObject, values: FormValues): ApplyResult {
  const next = structuredClone(metadata);
  const errors: { key: string; message: string }[] = [];
  for (const [key, field] of Object.entries(collection.metadata)) {
    const raw = values[key];
    if (raw === undefined) continue;
    const found = lookup(metadata, key);
    if (found.kind === "blocked") continue;
    const current = found.kind === "found" ? found.value : undefined;
    if (current !== undefined && toInput(field, current) === null) continue;

    const parsed = fromInput(field, raw, current);
    if (!parsed.ok) {
      errors.push({ key, message: parsed.message });
      continue;
    }
    if (field.required && isEmpty(parsed.value)) {
      errors.push({ key, message: "필수 항목이다" });
      continue;
    }
    if (parsed.value === undefined || (current === undefined && isEmpty(parsed.value))) {
      if (current !== undefined) remove(next, key);
      continue;
    }
    set(next, key, parsed.value);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: next };
}

type Lookup =
  | { kind: "found"; value: MetadataValue }
  | { kind: "missing" }
  /** 중간 키가 객체가 아니어서 그 안에 값을 넣을 수 없다. */
  | { kind: "blocked"; reason: string };

function lookup(metadata: MetadataObject, key: string): Lookup {
  const parts = key.split(".");
  let node: MetadataObject = metadata;
  for (const [i, part] of parts.entries()) {
    if (!Object.hasOwn(node, part)) return { kind: "missing" };
    const value = node[part]!;
    if (i === parts.length - 1) return { kind: "found", value };
    if (!isObject(value)) return { kind: "blocked", reason: `${parts.slice(0, i + 1).join(".")}가 객체가 아니다` };
    node = value;
  }
  return { kind: "missing" };
}

function set(metadata: MetadataObject, key: string, value: MetadataValue) {
  const parts = key.split(".");
  let node = metadata;
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(node, part)) define(node, part, {});
    node = node[part] as MetadataObject;
  }
  define(node, parts.at(-1)!, value);
}

function remove(metadata: MetadataObject, key: string) {
  const parts = key.split(".");
  let node = metadata;
  for (const part of parts.slice(0, -1)) node = node[part] as MetadataObject;
  delete node[parts.at(-1)!];
}

// `__proto__` 같은 키가 프로토타입을 바꾸지 않게 own property로 정의한다. 이미 있는 키는 자리를 지킨다.
function define(node: MetadataObject, key: string, value: MetadataValue) {
  Object.defineProperty(node, key, { value, enumerable: true, writable: true, configurable: true });
}

const isObject = (value: MetadataValue): value is MetadataObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isEmpty = (value: MetadataValue | undefined) =>
  value === undefined ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

/** 지금 값을 폼 입력 문자열로. 필드 타입과 맞지 않으면 null. */
function toInput(field: MetadataField, value: MetadataValue): string | null {
  switch (field.type) {
    // <input type="text">는 줄바꿈을 지워 제출하므로, 손대지 않아도 값이 바뀌지 않게 잠근다.
    case "string":
      return typeof value === "string" && !/[\r\n]/.test(value) ? value : null;
    case "text":
    case "select":
      return typeof value === "string" ? value : null;
    case "datetime": {
      if (typeof value !== "string") return null;
      const parsed = parseDatetime(value);
      return parsed ? formatLocal(parsed) : null;
    }
    // 제출할 때 줄마다 trim하고 빈 줄을 버리므로, 그렇게 해도 그대로 돌아오는 배열만 폼에 싣는다.
    case "string[]":
      return Array.isArray(value) &&
        value.every((item) => typeof item === "string" && item !== "" && item.trim() === item && !/[\r\n]/.test(item))
        ? value.join("\n")
        : null;
  }
}

/** 폼 입력을 metadata 값으로. `undefined`는 키를 지운다는 뜻이다. */
function fromInput(
  field: MetadataField,
  raw: string,
  current: MetadataValue | undefined,
): { ok: true; value: MetadataValue | undefined } | { ok: false; message: string } {
  switch (field.type) {
    case "string":
      // input 한 줄에는 줄바꿈이 없어야 한다. 직접 보낸 요청에서 들어온 줄바꿈은 공백으로 바꾼다.
      return { ok: true, value: raw.replace(/\r\n|[\r\n]/g, " ") };
    case "text":
      // 브라우저는 textarea 줄바꿈을 CRLF로 보낸다. 원본 글은 LF라 그대로 두면 바꾸지 않아도 값이 달라진다.
      return { ok: true, value: raw.replace(/\r\n?/g, "\n") };
    case "select":
      if (raw === "") return { ok: true, value: undefined };
      if (!field.options.includes(raw) && raw !== current) {
        return { ok: false, message: `선택지에 없는 값이다: ${raw}` };
      }
      return { ok: true, value: raw };
    case "string[]":
      return {
        ok: true,
        value: raw
          .split(/\r\n|[\r\n]/)
          .map((line) => line.trim())
          .filter((line) => line !== ""),
      };
    case "datetime": {
      if (raw.trim() === "") return { ok: true, value: undefined };
      const parsed = parseDatetime(raw.trim());
      if (!parsed) return { ok: false, message: `날짜 형식이 아니다: ${raw}` };
      const original = typeof current === "string" ? parseDatetime(current) : null;
      if (original && formatLocal(original) === formatLocal(parsed)) return { ok: true, value: current };
      return { ok: true, value: formatDatetime(parsed, original) };
    }
  }
}

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
