"use client";

import { useState } from "react";

import { useReportUnsaved, useSave } from "@/app/_lib/unsaved";
import type { SaveState } from "@/lib/content/save-flow";
import { FIELD_PREFIX, metadataFormChanged, type FormField } from "@/lib/metadata-form";

import { SaveRow } from "./save-row";

const inputClass = "rounded border px-2 py-1 text-sm disabled:opacity-60";

export function MetadataForm({
  fields,
  action,
}: {
  fields: FormField[];
  action: (data: FormData) => Promise<SaveState>;
}) {
  const save = useSave("metadata");
  const fieldErrors = save.state.status === "error" ? (save.state.fields ?? {}) : {};
  const [changed, setChanged] = useState(false);
  useReportUnsaved("metadata", changed);

  return (
    <form
      onChange={(event) => setChanged(metadataFormChanged(fields, new FormData(event.currentTarget)))}
      // form action은 제출 뒤 입력을 초기화한다. 저장이 실패해도 입력이 남게 직접 보낸다.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        // 변경 없음은 저장해도 지금 값과 같다는 뜻이라, 이 폼만 지금 입력을 저장한 값으로 본다.
        save.request(
          { target: "metadata" },
          () => action(data),
          () => setChanged(false),
        );
      }}
    >
      {/* 저장 중에는 입력을 막는다. 막힌 입력은 제출되지 않지만 제출할 값은 막기 전에 읽어 두었다. */}
      <fieldset disabled={save.locked} className="flex flex-col gap-4">
        {fields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              {field.label}
              {field.required && <span className="text-red-600"> *</span>}
              <span className="ml-2 text-xs font-normal text-zinc-500">{field.key}</span>
            </span>
            <FieldInput field={field} />
            {field.type === "string[]" && !field.locked && (
              <span className="text-xs text-zinc-500">한 줄에 하나씩</span>
            )}
            {field.locked && (
              <span className="text-xs text-amber-600">원문 모드에서만 고칠 수 있다: {field.locked}</span>
            )}
            {fieldErrors[field.key] && <span className="text-xs text-red-600">{fieldErrors[field.key]}</span>}
          </label>
        ))}
        <SaveRow label="저장" save={save} unchanged="바뀐 값이 없어 커밋하지 않았다." />
      </fieldset>
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
