import { describe, expect, test } from "vitest";

import type { Collection } from "@/lib/editor-config";
import type { MetadataValue } from "@/lib/mdx-doc";
import { testConfig } from "@/test/config";

import { applyForm, buildForm, FIELD_PREFIX, metadataFormChanged, readFormData, type FormField } from "./form";

const board: Collection = testConfig([
  {
    name: "게시판",
    path: "content/{slug}/page.mdx",
    metadata: {
      title: { type: "string", label: "제목", required: true },
      description: { type: "text", label: "요약" },
      keywords: { type: "string[]" },
      "other.createdAt": { type: "datetime", label: "작성일" },
      "other.status": { type: "select", label: "상태", options: ["ready", "draft"], required: true },
    },
  },
]).collections[0]!;

const METADATA: { [key: string]: MetadataValue } = {
  title: "11월 휴진 안내",
  description: "첫 줄\n둘째 줄",
  keywords: ["휴진", "공지"],
  other: { status: "ready", createdAt: "2020-11-20T00:00:00Z" },
};

/** 브라우저가 폼을 제출할 때처럼 잠긴(disabled) 필드는 빼고, 처음 값에 `edits`를 덮은 FormData. */
function formData(fields: FormField[], edits: { [key: string]: string | null } = {}): FormData {
  const data = new FormData();
  for (const field of fields) {
    if (field.locked !== null) continue;
    const value = Object.hasOwn(edits, field.key) ? edits[field.key] : field.initial;
    if (value !== null) data.set(FIELD_PREFIX + field.key, value);
  }
  return data;
}

describe("metadataFormChanged", () => {
  const fields = buildForm(board, METADATA);

  test("처음 값 그대로면 변경이 아니다", () => {
    expect(metadataFormChanged(fields, formData(fields))).toBe(false);
  });

  test("편집할 수 있는 입력을 바꾸면 변경이고, 처음 값으로 되돌리면 변경이 사라진다", () => {
    for (const [key, value] of [
      ["title", "12월 휴진 안내"],
      ["description", "첫 줄"],
      ["keywords", "휴진\n공지\n안내"],
      ["other.createdAt", "2020-11-21T00:00:00"],
      ["other.status", "draft"],
    ] as const) {
      expect(metadataFormChanged(fields, formData(fields, { [key]: value })), key).toBe(true);
    }
    expect(metadataFormChanged(fields, formData(fields, { title: "11월 휴진 안내" }))).toBe(false);
  });

  test("필수값을 비운 중간 입력도 변경이다", () => {
    expect(metadataFormChanged(fields, formData(fields, { title: "" }))).toBe(true);
  });

  test("형식이 틀린 날짜를 적는 중간 입력도 변경이다", () => {
    expect(metadataFormChanged(fields, formData(fields, { "other.createdAt": "2020-11-" }))).toBe(true);
  });

  test("잠긴 필드는 입력 값이 무엇이든 변경으로 보지 않는다", () => {
    const locked = buildForm(board, { ...METADATA, keywords: "휴진, 공지" });
    expect(locked.find((f) => f.key === "keywords")?.locked).not.toBeNull();
    expect(metadataFormChanged(locked, formData(locked))).toBe(false);
    const data = formData(locked);
    data.set(FIELD_PREFIX + "keywords", "휴진, 공지");
    expect(metadataFormChanged(locked, data)).toBe(false);
  });

  test("값이 없는 필수 선택지를 고르지 않은 채 두면 변경이 아니고, 고르면 변경이다", () => {
    const empty = buildForm(board, { title: "제목" });
    expect(metadataFormChanged(empty, formData(empty, { "other.status": null }))).toBe(false);
    expect(metadataFormChanged(empty, formData(empty, { "other.status": "ready" }))).toBe(true);
  });

  test("브라우저가 0초를 뗀 날짜나 바꾼 줄바꿈은 변경으로 보지 않는다", () => {
    expect(
      metadataFormChanged(
        fields,
        formData(fields, { "other.createdAt": "2020-11-20T00:00", description: "첫 줄\r\n둘째 줄" }),
      ),
    ).toBe(false);
  });

  test("목록 끝의 빈 줄이나 줄 앞뒤 공백처럼 저장해도 값이 그대로인 입력은 변경이 아니다", () => {
    for (const keywords of ["휴진\n공지\n", "휴진 \n공지", "\r\n휴진\r\n\r\n 공지\r\n"]) {
      const data = formData(fields, { keywords });
      expect(metadataFormChanged(fields, data), JSON.stringify(keywords)).toBe(false);
      // 저장 쪽도 같은 입력을 바뀌지 않은 값으로 해석한다.
      expect(applyForm(board, METADATA, readFormData(board, data))).toEqual({ ok: true, value: METADATA });
    }
  });

  test("값이 없던 필드에 공백만 적으면 저장해도 키가 생기지 않으므로 변경이 아니다", () => {
    const empty = buildForm(board, { title: "제목", other: { status: "ready" } });
    for (const [key, value] of [
      ["description", "  "],
      ["keywords", "\n \n"],
    ] as const) {
      expect(metadataFormChanged(empty, formData(empty, { [key]: value })), key).toBe(false);
    }
    expect(metadataFormChanged(empty, formData(empty, { description: "요약" }))).toBe(true);
  });
});
