import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { parseMetadata } from "./metadata";
import { parseMdx } from "./split";

const parse = (init: string) => parseMetadata(`export const metadata = ${init};`);

describe("parseMetadata", () => {
  test("객체, 배열, 문자열, 숫자, 불리언, null을 읽는다", () => {
    expect(
      parse(`{ title: 'a', "b-c": "d", n: 1.5, neg: -2, ok: true, no: false, z: null, tags: ["x", ['y']] }`),
    ).toEqual({
      editable: true,
      value: { title: "a", "b-c": "d", n: 1.5, neg: -2, ok: true, no: false, z: null, tags: ["x", ["y"]] },
    });
  });

  test("식 없는 템플릿 리터럴은 문자열로 읽고 이스케이프를 푼다", () => {
    expect(parse("{ a: `줄\\n바꿈` }")).toEqual({ editable: true, value: { a: "줄\n바꿈" } });
  });

  test("후행 쉼표와 주석을 허용한다", () => {
    expect(parse("{\n  // 설명\n  a: 1,\n}")).toEqual({ editable: true, value: { a: 1 } });
  });

  test("__proto__ 키도 일반 키로 읽는다", () => {
    const result = parse(`{ "__proto__": { x: 1 } }`);
    expect(result.editable && Object.keys(result.value)).toEqual(["__proto__"]);
  });

  test.each([
    ["식이 있는 템플릿 리터럴", "{ a: `x$" + "{1}` }", "템플릿"],
    ["변수 참조", "{ a: foo }", "Identifier"],
    ["생성자 호출", "{ a: new Date() }", "NewExpression"],
    ["전개 구문", "{ ...base }", "전개"],
    ["계산된 키", "{ [k]: 1 }", "계산된 키"],
    ["이항 연산", `{ a: "a" + "b" }`, "BinaryExpression"],
    ["객체가 아닌 값", "[1]", "객체가 아니다"],
  ])("지원하지 않는 식이면 편집 불가로 돌려준다: %s", (_name, init, reason) => {
    const result = parse(init);
    expect(result.editable).toBe(false);
    expect(!result.editable && result.reason).toContain(reason);
  });

  test("구문 오류는 편집 불가로 돌려준다", () => {
    expect(parseMetadata("export const metadata = {").editable).toBe(false);
  });

  test("metadata 선언이 아니면 편집 불가로 돌려준다", () => {
    expect(parseMetadata("export const foo = 1;").editable).toBe(false);
  });
});

describe.each(fixtureSources)("픽스처 metadata: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("파싱 집계와 실패 원인 분류", () => {
    const failures: Record<string, string[]> = {};
    let parsed = 0;
    for (const f of fixtures!) {
      const doc = parseMdx(f.source, source.syntax);
      const text = doc.ok ? doc.head.find((s) => s.kind === "metadata")?.text : undefined;
      const result = text ? parseMetadata(text) : { editable: false as const, reason: "metadata 없음" };
      if (result.editable) parsed++;
      else (failures[result.reason] ??= []).push(f.path);
    }
    console.log(`[${source.name}] metadata 파싱 ${parsed}/${fixtures!.length}`, failures);
    expect(failures).toEqual({});
    expect(parsed).toBe(fixtures!.length);
  });
});
