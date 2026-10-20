import { describe, expect, test } from "vitest";

import type { Collection } from "@/lib/editor-config";
import type { MetadataValue } from "@/lib/mdx-doc";
import { testConfig } from "@/test/config";

import { applyForm, buildForm, FIELD_PREFIX, readFormData, splitTitleField } from "./form";

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

const initialValues = (c: Collection, metadata: { [key: string]: MetadataValue }) =>
  Object.fromEntries(buildForm(c, metadata).map((f) => [f.key, f.initial]));

describe("buildForm", () => {
  test("config 순서대로 필드를 만들고 중첩 키의 지금 값을 채운다", () => {
    expect(buildForm(board, METADATA).map((f) => [f.key, f.initial, f.locked])).toEqual([
      ["title", "11월 휴진 안내", null],
      ["description", "첫 줄\n둘째 줄", null],
      ["keywords", "휴진\n공지", null],
      ["other.createdAt", "2020-11-20T00:00:00", null],
      ["other.status", "ready", null],
    ]);
  });

  test("config의 label·type·required·options를 필드에 옮기고, label이 없으면 키를 보인다", () => {
    expect(buildForm(board, METADATA).map((f) => [f.key, f.label, f.type, f.required, f.options])).toEqual([
      ["title", "제목", "string", true, []],
      ["description", "요약", "text", false, []],
      ["keywords", "keywords", "string[]", false, []],
      ["other.createdAt", "작성일", "datetime", false, []],
      ["other.status", "상태", "select", false, ["ready", "draft"]],
    ]);
  });

  test("값이 없는 필드는 빈 값으로 연다", () => {
    const fields = buildForm(board, { title: "제목" });
    expect(fields.map((f) => [f.key, f.initial, f.locked])).toEqual([
      ["title", "제목", null],
      ["description", "", null],
      ["keywords", "", null],
      ["other.createdAt", "", null],
      ["other.status", "", null],
    ]);
  });

  test("타입이 맞지 않는 값은 잠근다", () => {
    const fields = buildForm(board, { title: 1, keywords: "휴진, 공지", other: "x" });
    expect(fields.map((f) => [f.key, f.locked !== null])).toEqual([
      ["title", true],
      ["description", false],
      ["keywords", true],
      ["other.createdAt", true],
      ["other.status", true],
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
    const field = buildForm(board, { other: { status: "hidden" } }).find((f) => f.key === "other.status")!;
    expect(field.options).toEqual(["hidden", "ready", "draft"]);
    expect(field.initial).toBe("hidden");
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
      ["other.status", true],
    ]);
  });

  test("config에 제목 필드가 없으면 모든 필드가 나머지에 남는다", () => {
    const fields = buildForm(collection({ "other.status": { type: "select", options: ["ready"] } }), METADATA);
    const { title, settings } = splitTitleField(fields);
    expect(title).toBeNull();
    expect(settings.map((f) => f.key)).toEqual(["other.status"]);
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
      errors: [{ key: "title", message: "필수 항목이다" }],
    });
  });

  test("선택지에 없는 값은 받지 않는다. 원래 값이면 받는다", () => {
    expect(applyForm(board, METADATA, { "other.status": "hidden" })).toEqual({
      ok: false,
      errors: [{ key: "other.status", message: "선택지에 없는 값이다: hidden" }],
    });
    const hidden = { other: { status: "hidden" } };
    expect(applyForm(board, hidden, { "other.status": "hidden" })).toEqual({ ok: true, value: hidden });
  });

  test("날짜 형식이 아니거나 없는 날짜면 오류다", () => {
    for (const value of ["2020-11-20", "어제", "2020-02-30T00:00", "2020-11-20T24:00"]) {
      expect(applyForm(board, METADATA, { "other.createdAt": value })).toEqual({
        ok: false,
        errors: [{ key: "other.createdAt", message: `날짜 형식이 아니다: ${value}` }],
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
