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
import { TechDetails } from "@/app/_lib/ui";
import {
  FIELD_PREFIX,
  metadataFormChanged,
  optionLabel,
  REQUIRED_MESSAGE,
  splitTitleField,
  withFormValues,
  type FormField,
} from "@/lib/metadata-form";

import { usePostEditor, usePostInput } from "./post-editor";

const inputClass = "rounded border px-2 py-1 text-sm disabled:opacity-60";

type FieldErrors = { [key: string]: string };

type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

type MetadataFormValue = {
  formId: string;
  form: RefObject<HTMLFormElement | null>;
  /** 입력을 연 값의 key. 글의 metadata 원본이나 이어받은 입력이 바뀌면 바뀌고, 입력을 그 값으로 다시 연다. */
  version: string;
  fields: FormField[];
  save: ReturnType<typeof useSave>;
  changed: boolean;
  /** 저장 결과와 브라우저 검사에서 나온 필드별 오류. */
  errors: FieldErrors;
  /** 입력이 바뀌었을 때 미저장 여부를 다시 판정하고 그 필드의 브라우저 검사 오류를 거둔다. */
  inputChanged: (input: EventTarget) => void;
  /** 저장할 때 브라우저 검사에 걸린 필드. 오류 문구를 필드 옆에 남긴다. */
  invalid: (field: FormField, input: FieldElement) => void;
};

const MetadataFormContext = createContext<MetadataFormValue | null>(null);

function useMetadataForm(): MetadataFormValue {
  const value = useContext(MetadataFormContext);
  if (!value) throw new Error("MetadataForm 안에서만 쓴다.");
  return value;
}

/**
 * 글 설정 폼 하나를 화면 위의 제목 입력(`MetadataTitleInput`)과 본문 다음의 글 설정(`MetadataSettings`)으로 나눠 보인다.
 * 둘 사이에 본문 편집기가 있어 한 form으로 감쌀 수 없으므로, 제목 입력은 `form` 속성으로 같은 form에 속하게 한다.
 * 일반 편집으로 글을 저장할 때 이 폼의 값을 본문과 함께 낸다. 원문 편집에서는 원문이 글 설정을 담으므로 숨긴다.
 * 입력은 sha가 아닌 metadata 원본(`version`)이 바뀔 때만 다시 연다.
 */
export function MetadataForm({
  version,
  fields,
  children,
}: {
  version: string;
  fields: FormField[];
  children: ReactNode;
}) {
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const save = useSave("post");
  const { mode, carried } = usePostEditor();
  // 원문 편집에서 이어받은 값이 있으면 그 값으로 입력을 다시 연다. 글의 지금 값과 다르면 처음부터 변경이다.
  const values = carried.wysiwyg?.input.values;
  const opened = carried.wysiwyg ? `${version}:${carried.wysiwyg.key}` : version;
  const openedFields = values ? withFormValues(fields, values) : fields;
  // 다시 연 입력은 처음 값이라, 판정과 브라우저 검사 오류를 그때의 version과 함께 두고 version이 바뀌면 버린다.
  const [changedAt, setChanged] = useState({ version: opened, changed: false });
  const [invalidAt, setInvalid] = useState<{ version: string; errors: FieldErrors }>({ version: opened, errors: {} });
  const changed =
    changedAt.version === opened ? changedAt.changed : values !== undefined && metadataFormChanged(fields, values);
  const invalidErrors = invalidAt.version === opened ? invalidAt.errors : {};
  // 숨은 폼의 입력은 저장하지 않고 원문 편집으로 넘어간 것이라 미저장으로 알리지 않는다.
  useReportUnsaved("metadata", changed && mode === "wysiwyg");
  usePostInput("settings", () => {
    const element = form.current;
    if (!element) return null;
    setInvalid({ version: opened, errors: {} });
    // 검사에 걸린 칸은 `invalid`가 오류를 남기고 접힌 글 설정을 펼친다.
    if (!element.reportValidity()) return null;
    // 변경 없음은 저장해도 지금 값과 같다는 뜻이라, 지금 입력을 저장한 값으로 본다.
    return { data: new FormData(element), unchanged: () => setChanged({ version: opened, changed: false }) };
  });

  const value: MetadataFormValue = {
    formId,
    form,
    version: opened,
    fields: openedFields,
    save,
    changed,
    errors: { ...invalidErrors, ...(save.state.status === "error" ? save.state.fields : undefined) },
    inputChanged: (input) => {
      if (form.current) {
        setChanged({ version: opened, changed: metadataFormChanged(fields, new FormData(form.current)) });
      }
      const key = input instanceof Element ? (input.getAttribute("name") ?? "").slice(FIELD_PREFIX.length) : "";
      if (key in invalidErrors) {
        setInvalid({
          version: opened,
          errors: Object.fromEntries(Object.entries(invalidErrors).filter(([k]) => k !== key)),
        });
      }
    },
    invalid: (field, input) => {
      const message = input.validity.valueMissing ? REQUIRED_MESSAGE : "형식에 맞게 입력해 주세요.";
      setInvalid((current) => ({
        version: opened,
        errors: { ...(current.version === opened ? current.errors : {}), [field.key]: message },
      }));
    },
  };
  return <MetadataFormContext value={value}>{children}</MetadataFormContext>;
}

/** 화면 위의 제목 입력. config에 제목 필드가 없으면 그리지 않는다. 일반 편집에서 글 설정·본문과 함께 저장한다. */
export function MetadataTitleInput() {
  const { formId, version, fields, save, errors, inputChanged, invalid } = useMetadataForm();
  const { mode } = usePostEditor();
  const { title } = splitTitleField(fields);
  if (!title) return null;
  return (
    <div hidden={mode === "source"}>
      <FieldRow
        key={version}
        field={title}
        error={errors[title.key]}
        input={
          <FieldInput
            field={title}
            // 저장 중에는 입력을 막는다. 막힌 입력은 제출되지 않지만 저장할 값은 막기 전에 읽어 두었다.
            disabled={save.locked}
            form={formId}
            onChange={inputChanged}
            onInvalid={(input) => invalid(title, input)}
          />
        }
      />
    </div>
  );
}

/**
 * 제목을 뺀 글 설정 필드를 기본으로 접어 둔다.
 * 접힌 동안에도 요약 줄에 오류와 미저장 변경을 보이고, 숨긴 필드에 오류가 나면 펼친다.
 */
export function MetadataSettings() {
  const { formId, form, version, fields, save, changed, errors, inputChanged, invalid } = useMetadataForm();
  const { mode } = usePostEditor();
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
    <>
      {mode === "source" && (
        <>
          <h2 className="font-medium">글 설정</h2>
          <p className="text-sm text-zinc-500">원문 편집에서는 글 설정을 원문에서 고쳐요.</p>
        </>
      )}
      <form
        id={formId}
        ref={form}
        hidden={mode === "source"}
        onChange={(event) => inputChanged(event.target)}
        // 입력 칸에서 Enter를 눌러도 저장하지 않는다. 저장은 상태별 버튼으로만 한다.
        onSubmit={(event) => event.preventDefault()}
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
      </form>
    </>
  );
}

function FieldRow({ field, input, error }: { field: FormField; input: ReactNode; error: string | undefined }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {field.label}
          {field.required && <span className="text-red-600"> *</span>}
        </span>
        {input}
        {field.type === "string[]" && !field.locked && (
          <span className="text-xs text-zinc-500">한 줄에 하나씩 입력해 주세요.</span>
        )}
        {field.locked && (
          <span className="text-xs text-amber-600">
            지금 값의 형식이 달라 여기서 고칠 수 없어요. 원문 편집에서 고쳐 주세요.
          </span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </label>
      {field.locked && (
        <TechDetails
          items={[
            ["항목 키", field.key],
            ["잠긴 이유 원문", field.locked],
          ]}
        />
      )}
    </div>
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
              {optionLabel(field.key, option)}
            </option>
          ))}
        </select>
      );
  }
}
