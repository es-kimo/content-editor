import type { Collection, MetadataField } from "@/lib/editor-config";
import { lookupMetadata, type MetadataValue } from "@/lib/mdx-doc";

import { datetimeInput, datetimeValue } from "./datetime";
import { fieldLabel } from "./labels";

export type MetadataObject = { [key: string]: MetadataValue };

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
  /** 글의 지금 값. 값이 없거나 잠긴 필드는 없다. 미저장 판정이 저장과 같은 규칙으로 비교하는 기준이다. */
  current?: MetadataValue;
};

export type FormValues = { [key: string]: string };

export type ApplyResult =
  { ok: true; value: MetadataObject } | { ok: false; errors: { key: string; message: string }[] };

export const FIELD_PREFIX = "metadata:";

/** 필수 필드를 비웠을 때 필드 옆 안내. 브라우저 검사에 걸렸을 때도 같은 문구를 쓴다. */
export const REQUIRED_MESSAGE = "값을 입력해 주세요.";

/** 입력 해석에 필요한 필드 정보. 서버의 config 필드와 클라이언트의 `FormField`가 같은 해석을 쓴다. */
type InputField = { type: MetadataField["type"]; options?: readonly string[] };

/** config의 metadata 정의와 글의 지금 값으로 폼을 만든다. config에 적힌 순서를 따른다. */
export function buildForm(collection: Collection, metadata: MetadataObject): FormField[] {
  return Object.entries(collection.metadata).map(([key, field]) => {
    const found = lookupMetadata(metadata, key);
    const base = {
      key,
      label: fieldLabel(key, field.label),
      type: field.type,
      required: field.required ?? false,
      options: field.type === "select" ? [...field.options] : [],
    };
    if (found.kind === "blocked") return { ...base, initial: "", locked: found.reason };
    if (found.kind === "missing") return { ...base, initial: "", locked: null };
    const initial = toInput(field, found.value);
    if (initial === null) return { ...base, initial: "", locked: `값이 ${field.type} 형식이 아니다` };
    if (field.type === "select" && !base.options.includes(initial)) base.options.unshift(initial);
    return { ...base, initial, locked: null, current: found.value };
  });
}

/** 글 화면 위에 따로 두는 제목 필드의 키. */
export const TITLE_FIELD = "title";

/**
 * 폼 필드를 화면 위의 제목 입력과 '글 설정'에 접어 둘 나머지로 나눈다. 둘은 같은 폼이라 함께 저장된다.
 * 잠긴 필드와 config의 다른 필드는 모두 나머지에 config 순서대로 남는다. 제목 필드가 없으면 `title`은 null.
 */
export function splitTitleField(fields: FormField[]): { title: FormField | null; settings: FormField[] } {
  return {
    title: fields.find((field) => field.key === TITLE_FIELD) ?? null,
    settings: fields.filter((field) => field.key !== TITLE_FIELD),
  };
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
    const found = lookupMetadata(metadata, key);
    if (found.kind === "blocked") continue;
    const current = found.kind === "found" ? found.value : undefined;
    if (current !== undefined && toInput(field, current) === null) continue;

    const parsed = savedValue(field, raw, current);
    if (!parsed.ok) {
      errors.push({ key, message: parsed.message });
      continue;
    }
    if (field.required && isEmpty(parsed.value)) {
      errors.push({ key, message: REQUIRED_MESSAGE });
      continue;
    }
    if (parsed.value === undefined) {
      if (current !== undefined) remove(next, key);
      continue;
    }
    set(next, key, parsed.value);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: next };
}

/**
 * metadata 폼에 저장하지 않은 변경이 있는지. 고칠 수 있는 필드의 지금 입력을 저장(`applyForm`)과 같은 규칙으로 해석해
 * 글의 지금 값과 비교한다. 그래서 저장해도 값이 그대로인 입력(끝의 빈 줄, CRLF, 0초를 뗀 날짜)은 변경이 아니다.
 * 잠긴 필드는 제출되지 않으므로 보지 않는다. 필수값을 비우거나 형식이 틀린 중간 입력도 변경이다.
 * @param data 폼의 지금 입력 (`new FormData(form)`)
 */
export function metadataFormChanged(fields: FormField[], data: FormData): boolean {
  return fields.some((field) => {
    if (field.locked !== null) return false;
    // 선택지가 고르지 않은 자리(disabled)에 있으면 FormData에 빠지므로 빈 값으로 본다.
    const raw = data.get(FIELD_PREFIX + field.key);
    const parsed = savedValue(field, typeof raw === "string" ? raw : "", field.current);
    return !parsed.ok || !sameValue(parsed.value, field.current);
  });
}

/** 입력 하나를 저장하면 그 키가 가질 값. `undefined`는 키가 없다는 뜻이다. 원래 없던 키는 빈 입력으로 더하지 않는다. */
function savedValue(
  field: InputField,
  raw: string,
  current: MetadataValue | undefined,
): { ok: true; value: MetadataValue | undefined } | { ok: false; message: string } {
  const parsed = fromInput(field, raw, current);
  if (parsed.ok && current === undefined && isEmpty(parsed.value)) return { ok: true, value: undefined };
  return parsed;
}

// 폼으로 고칠 수 있는 값은 문자열이거나 문자열 배열이다.
const sameValue = (a: MetadataValue | undefined, b: MetadataValue | undefined) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, i) => item === b[i]) : a === b;

export function set(metadata: MetadataObject, key: string, value: MetadataValue) {
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
    case "datetime":
      return typeof value === "string" ? datetimeInput(value) : null;
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
  field: InputField,
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
      if (!field.options?.includes(raw) && raw !== current) {
        return { ok: false, message: "목록에 없는 값이에요. 목록에서 골라 주세요." };
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
    case "datetime":
      return datetimeValue(raw, current);
  }
}
