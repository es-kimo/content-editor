"use client";

import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { useReportUnsaved, useSave } from "@/app/_lib/unsaved";
import type { SaveState } from "@/lib/content/save-flow";
import { FIELD_PREFIX, metadataFormChanged, splitTitleField, type FormField } from "@/lib/metadata-form";

import { SaveRow } from "./save-row";

const inputClass = "rounded border px-2 py-1 text-sm disabled:opacity-60";

type FieldErrors = { [key: string]: string };

type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

type MetadataFormValue = {
  formId: string;
  form: RefObject<HTMLFormElement | null>;
  /** 글의 지금 metadata 원본. 바뀌면 입력을 그 값으로 다시 연다. */
  version: string;
  fields: FormField[];
  save: ReturnType<typeof useSave>;
  changed: boolean;
  /** 저장 결과와 브라우저 검사에서 나온 필드별 오류. */
  errors: FieldErrors;
  /** 입력이 바뀌었을 때 미저장 여부를 다시 판정하고 그 필드의 브라우저 검사 오류를 거둔다. */
  inputChanged: (input: EventTarget) => void;
  /** 제출할 때 브라우저 검사에 걸린 필드. 오류 문구를 필드 옆에 남긴다. */
  invalid: (field: FormField, input: FieldElement) => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
};

const MetadataFormContext = createContext<MetadataFormValue | null>(null);

function useMetadataForm(): MetadataFormValue {
  const value = useContext(MetadataFormContext);
  if (!value) throw new Error("MetadataForm 안에서만 쓴다.");
  return value;
}

/**
 * 글 설정 폼 하나를 화면 위의 제목 입력(`MetadataTitleInput`)과 본문 다음의 글 설정(`MetadataSettings`)으로 나눠 보인다.
 * 둘 사이에 본문 편집기의 form이 있어 한 form으로 감쌀 수 없으므로, 제목 입력은 `form` 속성으로 같은 form에 속하게 한다.
 * 본문을 저장해도 고치던 입력이 남도록 입력은 sha가 아닌 metadata 원본(`version`)이 바뀔 때만 다시 연다.
 */
export function MetadataForm({
  version,
  fields,
  action,
  children,
}: {
  version: string;
  fields: FormField[];
  action: (data: FormData) => Promise<SaveState>;
  children: ReactNode;
}) {
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const save = useSave("metadata");
  // 다시 연 입력은 처음 값이라, 판정과 브라우저 검사 오류를 그때의 version과 함께 두고 version이 바뀌면 버린다.
  const [changedAt, setChanged] = useState({ version, changed: false });
  const [invalidAt, setInvalid] = useState<{ version: string; errors: FieldErrors }>({ version, errors: {} });
  const changed = changedAt.version === version && changedAt.changed;
  const invalidErrors = invalidAt.version === version ? invalidAt.errors : {};
  useReportUnsaved("metadata", changed);

  const value: MetadataFormValue = {
    formId,
    form,
    version,
    fields,
    save,
    changed,
    errors: { ...invalidErrors, ...(save.state.status === "error" ? save.state.fields : undefined) },
    inputChanged: (input) => {
      if (form.current) setChanged({ version, changed: metadataFormChanged(fields, new FormData(form.current)) });
      const key = input instanceof Element ? (input.getAttribute("name") ?? "").slice(FIELD_PREFIX.length) : "";
      if (key in invalidErrors) {
        setInvalid({ version, errors: Object.fromEntries(Object.entries(invalidErrors).filter(([k]) => k !== key)) });
      }
    },
    invalid: (field, input) => {
      const message = input.validity.valueMissing ? "값을 입력해 주세요." : "형식에 맞게 입력해 주세요.";
      setInvalid((current) => ({
        version,
        errors: { ...(current.version === version ? current.errors : {}), [field.key]: message },
      }));
    },
    // form action은 제출 뒤 입력을 초기화한다. 저장이 실패해도 입력이 남게 직접 보낸다.
    submit: (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setInvalid({ version, errors: {} });
      // 변경 없음은 저장해도 지금 값과 같다는 뜻이라, 이 폼만 지금 입력을 저장한 값으로 본다.
      save.request(
        { target: "metadata" },
        () => action(data),
        () => setChanged({ version, changed: false }),
      );
    },
  };
  return <MetadataFormContext value={value}>{children}</MetadataFormContext>;
}

/** 화면 위의 제목 입력. config에 제목 필드가 없으면 그리지 않는다. 글 설정과 함께 '글 설정 저장'으로 저장한다. */
export function MetadataTitleInput() {
  const { formId, version, fields, save, errors, inputChanged, invalid } = useMetadataForm();
  const { title } = splitTitleField(fields);
  if (!title) return null;
  return (
    <FieldRow
      key={version}
      field={title}
      error={errors[title.key]}
      input={
        <FieldInput
          field={title}
          // 저장 중에는 입력을 막는다. 막힌 입력은 제출되지 않지만 제출할 값은 막기 전에 읽어 두었다.
          disabled={save.locked}
          form={formId}
          onChange={inputChanged}
          onInvalid={(input) => invalid(title, input)}
        />
      }
    />
  );
}

/**
 * 제목을 뺀 글 설정 필드를 기본으로 접어 두고, 그 아래에 '글 설정 저장'을 둔다.
 * 접힌 동안에도 요약 줄에 오류와 미저장 변경을 보이고, 숨긴 필드에 오류가 나면 펼친다.
 */
export function MetadataSettings() {
  const { formId, form, version, fields, save, changed, errors, inputChanged, invalid, submit } = useMetadataForm();
  const { settings } = splitTitleField(fields);
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const settingsError = settings.some((field) => errors[field.key]);

  // 저장 결과가 바뀔 때 숨긴 필드에 오류가 있으면 펼친다. 사용자가 다시 접으면 접힌 채 둔다.
  const [seenState, setSeenState] = useState(save.state);
  if (seenState !== save.state) {
    setSeenState(save.state);
    if (settingsError) setOpen(true);
  }

  return (
    <form
      id={formId}
      ref={form}
      onChange={(event) => inputChanged(event.target)}
      onSubmit={submit}
      className="flex flex-col gap-2"
    >
      {settings.length > 0 && (
        <details ref={details} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer">
            <span className="font-medium">글 설정</span>
            {settingsError && <span className="ml-2 text-sm text-red-600">확인할 항목이 있어요</span>}
            {changed && <span className="ml-2 text-sm text-amber-600">저장하지 않은 변경이 있어요</span>}
          </summary>
          <fieldset key={version} disabled={save.locked} className="mt-2 flex flex-col gap-4">
            {settings.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                error={errors[field.key]}
                input={
                  <FieldInput
                    field={field}
                    onInvalid={(input) => {
                      // 브라우저는 검사에 걸린 칸으로 초점을 옮기는데, 접힌 칸에는 옮기지 못하므로 그 전에 바로 펼친다.
                      if (details.current) details.current.open = true;
                      setOpen(true);
                      invalid(field, input);
                    }}
                  />
                }
              />
            ))}
          </fieldset>
        </details>
      )}
      {settings.length === 0 && changed && <p className="text-sm text-amber-600">저장하지 않은 변경이 있어요</p>}
      <SaveRow label="글 설정 저장" save={save} unchanged="바뀐 값이 없어 커밋하지 않았다." />
    </form>
  );
}

function FieldRow({ field, input, error }: { field: FormField; input: ReactNode; error: string | undefined }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">
        {field.label}
        {field.required && <span className="text-red-600"> *</span>}
        <span className="ml-2 text-xs font-normal text-zinc-500">{field.key}</span>
      </span>
      {input}
      {field.type === "string[]" && !field.locked && <span className="text-xs text-zinc-500">한 줄에 하나씩</span>}
      {field.locked && <span className="text-xs text-amber-600">원문 모드에서만 고칠 수 있다: {field.locked}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

function FieldInput({
  field,
  disabled = false,
  form,
  onChange,
  onInvalid,
}: {
  field: FormField;
  disabled?: boolean;
  /** form 밖에 그리는 입력이 속할 form의 id. */
  form?: string;
  /** form 밖에 그리는 입력은 form의 onChange에 닿지 않아 직접 받는다. */
  onChange?: (input: EventTarget) => void;
  onInvalid: (input: FieldElement) => void;
}) {
  const common = {
    name: FIELD_PREFIX + field.key,
    defaultValue: field.initial,
    // 잠긴 필드는 제출되지 않아 원래 값이 그대로 남는다.
    disabled: disabled || field.locked !== null,
    required: field.required,
    form,
    className: inputClass,
    onChange: onChange && ((event: ChangeEvent<FieldElement>) => onChange(event.currentTarget)),
    onInvalid: (event: FormEvent<FieldElement>) => onInvalid(event.currentTarget),
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
