import { describe, expect, test } from "vitest";

import type { Collection } from "@/lib/editor-config";
import type { MetadataValue } from "@/lib/mdx-doc";
import { testConfig } from "@/test/config";

import { applyForm, blocksModeSwitch, buildForm, FIELD_PREFIX, readFormData, splitTitleField } from "./form";
import { fieldLabel, optionLabel, STATUS_FIELD } from "./labels";

const collection = (metadata: Collection["metadata"]): Collection =>
  testConfig([{ name: "게시판", path: "content/{slug}/page.mdx", metadata }]).collections[0]!;

const board = collection({
  title: { type: "string", label: "제목", required: true },
  description: { type: "text", label: "요약" },
  keywords: { type: "string[]" },
  "other.createdAt": { type: "datetime", label: "작성일" },
  "other.status": { type: "select", label: "상태", options: ["ready", "draft"] },
});

const METADATA: { [key: string]: MetadataValue } = {
  title: "11월 휴진 안내",
  description: "첫 줄\n둘째 줄",
  keywords: ["휴진", "공지"],
  alternate: { canonical: "/x" },
  other: { status: "ready", createdAt: "2020-11-20T00:00:00Z", views: 3 },
};

/** 게시 상태가 아닌 select 필드가 있는 글 분류. 상태는 폼에 넣지 않으므로 select 동작은 이 필드로 본다. */
const withCategory = collection({
  ...board.metadata,
  "other.category": { type: "select", label: "분류", options: ["공지", "안내"], required: true },
});

const initialValues = (c: Collection, metadata: { [key: string]: MetadataValue }) =>
  Object.fromEntries(buildForm(c, metadata).map((f) => [f.key, f.initial]));

describe("buildForm", () => {
  test("config 순서대로 필드를 만들고 중첩 키의 지금 값을 채운다", () => {
    expect(buildForm(board, METADATA).map((f) => [f.key, f.initial, f.locked])).toEqual([
      ["title", "11월 휴진 안내", null],
      ["description", "첫 줄\n둘째 줄", null],
      ["keywords", "휴진\n공지", null],
      ["other.createdAt", "2020-11-20T00:00:00", null],
    ]);
  });

  test("게시 상태는 상태별 저장 행동으로만 바꾸므로 config에 있어도 폼에 넣지 않는다", () => {
    expect(buildForm(board, METADATA).map((f) => f.key)).not.toContain(STATUS_FIELD);
    expect(buildForm(board, { other: { status: "hidden" } }).map((f) => f.key)).not.toContain(STATUS_FIELD);
    expect(buildForm(board, { other: "x" }).map((f) => f.key)).not.toContain(STATUS_FIELD);
  });

  test("config의 label·type·required·options를 필드에 옮긴다", () => {
    expect(buildForm(withCategory, METADATA).map((f) => [f.key, f.label, f.type, f.required, f.options])).toEqual([
      ["title", "제목", "string", true, []],
      ["description", "요약", "text", false, []],
      ["keywords", "검색어", "string[]", false, []],
      ["other.createdAt", "작성일", "datetime", false, []],
      ["other.category", "분류", "select", true, ["공지", "안내"]],
    ]);
  });

  test("라벨은 config의 사용자 라벨을 우선하고, 없으면 알려진 필드는 기본 이름을, 알 수 없는 필드는 키를 보인다", () => {
    const labels = collection({
      title: { type: "string", label: "글 제목" },
      description: { type: "text" },
      keywords: { type: "string[]" },
      "other.createdAt": { type: "datetime" },
      "other.code": { type: "string" },
    });
    expect(buildForm(labels, {}).map((f) => [f.key, f.label])).toEqual([
      ["title", "글 제목"],
      ["description", "요약"],
      ["keywords", "검색어"],
      ["other.createdAt", "작성일"],
      ["other.code", "other.code"],
    ]);
    expect(fieldLabel(STATUS_FIELD)).toBe("상태");
    expect(fieldLabel("toString")).toBe("toString");
  });

  test("값이 없는 필드는 빈 값으로 연다", () => {
    const fields = buildForm(board, { title: "제목" });
    expect(fields.map((f) => [f.key, f.initial, f.locked])).toEqual([
      ["title", "제목", null],
      ["description", "", null],
      ["keywords", "", null],
      ["other.createdAt", "", null],
    ]);
  });

  test("타입이 맞지 않는 값은 잠근다", () => {
    const fields = buildForm(board, { title: 1, keywords: "휴진, 공지", other: "x" });
    expect(fields.map((f) => [f.key, f.locked !== null])).toEqual([
      ["title", true],
      ["description", false],
      ["keywords", true],
      ["other.createdAt", true],
    ]);
  });

  test("한 줄 입력이 지우는 줄바꿈이 든 string 값은 잠그고 원래 값을 둔다", () => {
    const fields = buildForm(board, { title: "가\n나", description: "가\n나" });
    expect(fields.find((f) => f.key === "title")!.locked).not.toBeNull();
    expect(fields.find((f) => f.key === "description")!.locked).toBeNull();
    // 브라우저가 줄바꿈을 지워 보낸 값이 와도 원래 값을 둔다.
    expect(applyForm(board, { title: "가\n나" }, { title: "가나" })).toEqual({ ok: true, value: { title: "가\n나" } });
  });

  test.each([[[" 휴진"]], [["휴진 "]], [["휴진", ""]], [["가\n나"]]])(
    "제출하면 그대로 돌아오지 않는 string[] 값 %j는 잠그고 원래 값을 둔다",
    (keywords) => {
      expect(buildForm(board, { keywords }).find((f) => f.key === "keywords")!.locked).not.toBeNull();
      expect(applyForm(board, { keywords }, { keywords: "휴진" })).toEqual({ ok: true, value: { keywords } });
    },
  );

  test("선택지에 없는 지금 값은 선택지 맨 앞에 더해 그대로 고를 수 있게 한다", () => {
    const field = buildForm(withCategory, { other: { category: "행사" } }).find((f) => f.key === "other.category")!;
    expect(field.options).toEqual(["행사", "공지", "안내"]);
    expect(field.initial).toBe("행사");
  });
});

describe("optionLabel", () => {
  test("상태 필드의 ready·draft는 ‘게시 대상’·‘초안’으로 보이고 저장할 선택지 값은 그대로다", () => {
    expect(["ready", "draft"].map((value) => [value, optionLabel(STATUS_FIELD, value)])).toEqual([
      ["ready", "게시 대상"],
      ["draft", "초안"],
    ]);
  });

  test("상태 필드의 알 수 없는 값과 다른 필드의 값은 그대로 보인다", () => {
    expect(optionLabel(STATUS_FIELD, "hidden")).toBe("hidden");
    expect(optionLabel(STATUS_FIELD, "toString")).toBe("toString");
    expect(optionLabel("category", "ready")).toBe("ready");
  });
});

describe("splitTitleField", () => {
  test("제목 필드를 따로 꺼내고 잠긴 필드를 포함한 나머지를 config 순서대로 남긴다", () => {
    const { title, settings } = splitTitleField(buildForm(board, { ...METADATA, keywords: "문자열" }));
    expect(title?.initial).toBe("11월 휴진 안내");
    expect(settings.map((f) => [f.key, f.locked === null])).toEqual([
      ["description", true],
      ["keywords", false],
      ["other.createdAt", true],
    ]);
  });

  test("config에 제목 필드가 없으면 모든 필드가 나머지에 남는다", () => {
    const fields = buildForm(collection({ description: { type: "text" } }), METADATA);
    const { title, settings } = splitTitleField(fields);
    expect(title).toBeNull();
    expect(settings.map((f) => f.key)).toEqual(["description"]);
  });
});

describe("readFormData", () => {
  test("config 필드 이름의 입력만 꺼낸다", () => {
    const data = new FormData();
    data.set(`${FIELD_PREFIX}title`, "새 제목");
    data.set(`${FIELD_PREFIX}other.status`, "draft");
    data.set(`${FIELD_PREFIX}alternate`, "끼어든 값");
    data.set("path", "content/a/page.mdx");
    expect(readFormData(board, data)).toEqual({ title: "새 제목", "other.status": "draft" });
  });
});

describe("applyForm", () => {
  test("처음 값 그대로 내면 metadata가 같다", () => {
    expect(applyForm(board, METADATA, initialValues(board, METADATA))).toEqual({ ok: true, value: METADATA });
    const odd = { ...METADATA, title: "가\n나", keywords: [" 휴진", ""] };
    expect(applyForm(board, odd, initialValues(board, odd))).toEqual({ ok: true, value: odd });
  });

  test("폼 값을 반영하고 폼에 없는 키와 키 순서는 보존한다", () => {
    const result = applyForm(board, METADATA, {
      title: "12월 휴진 안내",
      description: "새 설명",
      keywords: "휴진\n\n  12월 \n",
      "other.createdAt": "2020-12-01T09:30:00",
      "other.status": "draft",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        title: "12월 휴진 안내",
        description: "새 설명",
        keywords: ["휴진", "12월"],
        alternate: { canonical: "/x" },
        other: { status: "draft", createdAt: "2020-12-01T09:30:00Z", views: 3 },
      },
    });
    if (!result.ok) return;
    expect(Object.keys(result.value)).toEqual(["title", "description", "keywords", "alternate", "other"]);
    expect(Object.keys(result.value.other!)).toEqual(["status", "createdAt", "views"]);
  });

  test("원래 metadata 객체는 바꾸지 않는다", () => {
    const before = structuredClone(METADATA);
    applyForm(board, METADATA, { title: "다른 제목", "other.status": "draft" });
    expect(METADATA).toEqual(before);
  });

  test("제출되지 않은 필드는 원래 값을 둔다", () => {
    expect(applyForm(board, METADATA, { title: "새 제목" })).toEqual({
      ok: true,
      value: { ...METADATA, title: "새 제목" },
    });
  });

  test("없던 중첩 키는 값을 채웠을 때만 객체를 만들어 끝에 더한다", () => {
    expect(applyForm(board, { title: "제목" }, { "other.createdAt": "", "other.status": "", description: "" })).toEqual(
      { ok: true, value: { title: "제목" } },
    );
    expect(
      applyForm(board, { title: "제목" }, { "other.status": "draft", "other.createdAt": "2026-10-19T00:00" }),
    ).toEqual({ ok: true, value: { title: "제목", other: { createdAt: "2026-10-19T00:00:00Z", status: "draft" } } });
  });

  test("select와 datetime을 비우면 키를 지우고, 문자열을 비우면 빈 문자열로 둔다", () => {
    const result = applyForm(board, METADATA, { description: "", "other.status": "", "other.createdAt": "" });
    expect(result).toEqual({
      ok: true,
      value: { ...METADATA, description: "", other: { views: 3 } },
    });
  });

  test("필수 항목이 비면 오류다", () => {
    expect(applyForm(board, METADATA, { title: "  " })).toEqual({
      ok: false,
      errors: [{ key: "title", message: "값을 입력해 주세요." }],
    });
  });

  test("필수 검사를 끄면 비운 필수 항목을 빈 값 그대로 반영하고, 형식 오류는 그대로 오류다", () => {
    expect(applyForm(board, METADATA, { title: "" }, { required: false })).toEqual({
      ok: true,
      value: { ...METADATA, title: "" },
    });
    expect(applyForm(board, METADATA, { "other.createdAt": "어제" }, { required: false })).toMatchObject({
      ok: false,
      errors: [{ key: "other.createdAt" }],
    });
  });

  test("선택지에 없는 값은 받지 않는다. 원래 값이면 받는다", () => {
    expect(applyForm(board, METADATA, { "other.status": "hidden" })).toEqual({
      ok: false,
      errors: [{ key: "other.status", message: "목록에 없는 값이에요. 목록에서 골라 주세요." }],
    });
    const hidden = { other: { status: "hidden" } };
    expect(applyForm(board, hidden, { "other.status": "hidden" })).toEqual({ ok: true, value: hidden });
  });

  test("날짜 형식이 아니거나 없는 날짜면 오류다", () => {
    for (const value of ["2020-11-20", "어제", "2020-02-30T00:00", "2020-11-20T24:00"]) {
      expect(applyForm(board, METADATA, { "other.createdAt": value })).toEqual({
        ok: false,
        errors: [{ key: "other.createdAt", message: "날짜와 시각을 다시 입력해 주세요." }],
      });
    }
  });

  test("날짜는 원래 값의 형식(초·밀리초·Z)을 따르고, 같은 시각이면 원래 문자열을 그대로 둔다", () => {
    const at = (createdAt: string, input: string) => {
      const result = applyForm(board, { other: { createdAt } }, { "other.createdAt": input });
      return result.ok ? (result.value.other as { createdAt: string }).createdAt : result;
    };
    expect(at("2024-04-26T00:00:00Z", "2024-04-26T00:00")).toBe("2024-04-26T00:00:00Z");
    expect(at("2024-04-26T00:00:00.000Z", "2024-04-26T00:00:00")).toBe("2024-04-26T00:00:00.000Z");
    expect(at("2024-04-26T00:00:00.123Z", "2024-04-26T00:00:00")).toBe("2024-04-26T00:00:00.123Z");
    expect(at("2024-04-26T00:00:00Z", "2024-05-01T08:00")).toBe("2024-05-01T08:00:00Z");
    expect(at("2024-04-26T00:00:00.000Z", "2024-05-01T08:00:15")).toBe("2024-05-01T08:00:15.000Z");
    expect(at("2024-04-26T00:00:00", "2024-05-01T08:00")).toBe("2024-05-01T08:00:00");
    expect(at("2024-04-26T00:00", "2024-05-01T08:00")).toBe("2024-05-01T08:00");
  });

  test("textarea의 CRLF는 LF로 바꿔 값을 바꾸지 않은 글이 달라지지 않게 한다", () => {
    expect(applyForm(board, METADATA, { description: "첫 줄\r\n둘째 줄" })).toEqual({ ok: true, value: METADATA });
  });

  test("한 줄 문자열의 줄바꿈은 공백으로 바꾼다", () => {
    const result = applyForm(board, METADATA, { title: "12월\n휴진" });
    expect(result.ok && result.value.title).toBe("12월 휴진");
  });

  test("잠긴 필드는 제출돼도 원래 값을 둔다", () => {
    const metadata = { title: "제목", keywords: "휴진, 공지", other: "x" };
    expect(
      applyForm(board, metadata, {
        keywords: "다른 값",
        "other.status": "draft",
        "other.createdAt": "2020-01-01T00:00",
      }),
    ).toEqual({ ok: true, value: metadata });
  });

  test("__proto__ 키도 own property로 다룬다", () => {
    const proto = collection({ "__proto__.x": { type: "string" } });
    const result = applyForm(proto, {}, { "__proto__.x": "값" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.hasOwn(result.value, "__proto__")).toBe(true);
    expect((Object.getOwnPropertyDescriptor(result.value, "__proto__")!.value as { x: string }).x).toBe("값");
  });
});

describe("blocksModeSwitch", () => {
  const validity = (flags: { valid?: boolean; valueMissing?: boolean; badInput?: boolean }) => ({
    valid: false,
    valueMissing: false,
    badInput: false,
    ...flags,
  });

  test("비운 필수 칸은 모드 전환을 막지 않는다", () => {
    expect(blocksModeSwitch(validity({ valid: true }))).toBe(false);
    expect(blocksModeSwitch(validity({ valueMissing: true }))).toBe(false);
  });

  test("형식이 틀린 칸은 넘길 값이 없어 모드 전환을 막는다", () => {
    expect(blocksModeSwitch(validity({ badInput: true }))).toBe(true);
    // 날짜를 반만 입력한 필수 칸은 값이 비었다는 판정도 함께 나온다.
    expect(blocksModeSwitch(validity({ valueMissing: true, badInput: true }))).toBe(true);
    expect(blocksModeSwitch(validity({}))).toBe(true);
  });
});
