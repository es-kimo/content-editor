import { datetimeInput } from "./datetime";
import { FIELD_PREFIX, type FormField } from "./form";

/**
 * metadata 폼에 저장하지 않은 변경이 있는지. 고칠 수 있는 필드의 지금 입력을 `buildForm`이 채운 처음 값과 비교한다.
 * 잠긴 필드는 제출되지 않으므로 보지 않는다. 필수값을 비운 중간 입력도 변경이다.
 * @param data 폼의 지금 입력 (`new FormData(form)`)
 */
export function metadataFormChanged(fields: FormField[], data: FormData): boolean {
  return fields.some((field) => {
    if (field.locked !== null) return false;
    // 선택지가 고르지 않은 자리(disabled)에 있으면 FormData에 빠지므로 빈 값으로 본다.
    const value = data.get(FIELD_PREFIX + field.key);
    return comparable(field, typeof value === "string" ? value : "") !== comparable(field, field.initial);
  });
}

// 브라우저는 손대지 않은 입력도 표기를 바꿔 돌려준다. datetime-local은 0초를 떼고(`T00:00`), textarea는 줄바꿈을 `\n`로 바꾼다.
function comparable(field: FormField, value: string): string {
  if (field.type === "datetime") return datetimeInput(value) ?? value;
  return value.replace(/\r\n?/g, "\n");
}
