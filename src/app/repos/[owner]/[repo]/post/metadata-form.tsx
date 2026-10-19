"use client";

import { startTransition, useActionState } from "react";

import { FIELD_PREFIX, type FormField } from "@/lib/metadata-form";

import type { SaveState } from "./actions";

const inputClass = "rounded border px-2 py-1 text-sm disabled:opacity-60";

export function MetadataForm({
  fields,
  action,
}: {
  fields: FormField[];
  action: (state: SaveState, data: FormData) => Promise<SaveState>;
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  const fieldErrors = state.status === "error" ? (state.fields ?? {}) : {};

  return (
    <form
      className="flex flex-col gap-4"
      // form action은 제출 뒤 입력을 초기화한다. 저장이 실패해도 입력이 남게 직접 보낸다.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => dispatch(data));
      }}
    >
      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {field.label}
            {field.required && <span className="text-red-600"> *</span>}
            <span className="ml-2 text-xs font-normal text-zinc-500">{field.key}</span>
          </span>
          <FieldInput field={field} />
          {field.type === "string[]" && !field.locked && <span className="text-xs text-zinc-500">한 줄에 하나씩</span>}
          {field.locked && <span className="text-xs text-amber-600">원문 모드에서만 고칠 수 있다: {field.locked}</span>}
          {fieldErrors[field.key] && <span className="text-xs text-red-600">{fieldErrors[field.key]}</span>}
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded bg-black px-4 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
        {state.status === "unchanged" && <p className="text-sm text-zinc-500">바뀐 값이 없어 커밋하지 않았다.</p>}
      </div>
    </form>
  );
}

function FieldInput({ field }: { field: FormField }) {
  const common = {
    name: FIELD_PREFIX + field.key,
    defaultValue: field.initial,
    // 잠긴 필드는 제출되지 않아 원래 값이 그대로 남는다.
    disabled: field.locked !== null,
    required: field.required,
    className: inputClass,
  };
  switch (field.type) {
    case "string":
      return <input type="text" {...common} />;
    case "text":
    case "string[]":
      return <textarea rows={field.type === "text" ? 3 : 4} {...common} />;
    case "datetime":
      return <input type="datetime-local" step={1} {...common} className={`${inputClass} w-fit`} />;
    case "select":
      return (
        <select {...common} className={`${inputClass} w-fit`}>
          {!field.required && <option value="">(없음)</option>}
          {/* 빈 자리가 없으면 브라우저가 첫 선택지를 골라 손대지 않은 값이 저장되고 필수 검증도 비껴간다. */}
          {field.required && field.initial === "" && (
            <option value="" disabled>
              (선택)
            </option>
          )}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
  }
}
