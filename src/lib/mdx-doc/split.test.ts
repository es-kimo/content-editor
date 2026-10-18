import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { parseMdx, printMdx, type MdxDoc } from "./split";

const kinds = (doc: MdxDoc) => (doc.ok ? doc.head.filter((s) => s.kind !== "gap").map((s) => s.kind) : []);

describe.each(fixtureSources)("픽스처 왕복: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("모든 글이 구간으로 나뉘고 원본 그대로 조립된다", () => {
    const failed = fixtures!.filter((f) => {
      const doc = parseMdx(f.source, source.syntax);
      return !doc.ok || printMdx(doc) !== f.source;
    });
    expect(failed.map((f) => f.path)).toEqual([]);
  });

  test.skipIf(!fixtures)("모든 글에 metadata 조각이 정확히 1개 있다", () => {
    const counts = fixtures!.map(
      (f) => kinds(parseMdx(f.source, source.syntax)).filter((k) => k === "metadata").length,
    );
    expect(counts.filter((n) => n !== 1)).toEqual([]);
  });
});

describe("parseMdx", () => {
  test("import, metadata, 본문을 나누고 사이 공백은 gap으로 둔다", () => {
    const source = 'import a from "./1.png";\n\nexport const metadata = { title: "t" };\n\n# 제목\n';
    const doc = parseMdx(source);
    expect(doc).toEqual({
      ok: true,
      head: [
        { kind: "import", text: 'import a from "./1.png";' },
        { kind: "gap", text: "\n\n" },
        { kind: "metadata", text: 'export const metadata = { title: "t" };' },
        { kind: "gap", text: "\n\n" },
      ],
      body: "# 제목\n",
    });
  });

  test("빈 줄 없이 붙은 문장도 하나씩 나눈다", () => {
    const source = 'import a from "./a.png";\nimport b from "./b.png";\nexport const metadata = {};\n\n본문\n';
    expect(kinds(parseMdx(source))).toEqual(["import", "import", "metadata"]);
  });

  test("metadata가 아닌 export는 export로 둔다", () => {
    expect(kinds(parseMdx("export const foo = 1;\n\n본문\n"))).toEqual(["export"]);
    expect(kinds(parseMdx("export const metadata = {}, foo = 1;\n"))).toEqual(["export"]);
  });

  test("ESM이 없으면 head는 비고 전체가 본문이다", () => {
    expect(parseMdx("# 제목\n\n본문\n")).toEqual({ ok: true, head: [], body: "# 제목\n\n본문\n" });
  });

  test("본문이 없으면 body는 빈 문자열이다", () => {
    const doc = parseMdx("export const metadata = {};\n");
    expect(doc.ok && doc.body).toBe("");
    expect(printMdx(doc)).toBe("export const metadata = {};\n");
  });

  test("빈 파일", () => {
    expect(parseMdx("")).toEqual({ ok: true, head: [], body: "" });
  });

  test.each([
    ["파일 끝 줄바꿈 없음", "export const metadata = {};\n\n본문"],
    ["CRLF", "export const metadata = {};\r\n\r\n본문\r\n"],
    ["BOM", "﻿export const metadata = {};\n\n본문\n"],
    ["문장 사이 주석", "import a from './a.png'; // 표지\nexport const metadata = {};\n\n본문\n"],
  ])("왕복 보존: %s", (_, source) => {
    expect(printMdx(parseMdx(source))).toBe(source);
  });

  test("본문 뒤에 ESM이 있으면 나누지 않고 원문을 보관한다", () => {
    const source = "export const metadata = {};\n\n본문\n\nexport const late = 1;\n";
    const doc = parseMdx(source);
    expect(doc.ok).toBe(false);
    expect(!doc.ok && doc.reason).toBe("esm-after-content");
    expect(printMdx(doc)).toBe(source);
  });

  test("파싱할 수 없으면 원문을 보관한다", () => {
    const source = "export const metadata = {};\n\n수식 $a{b$\n";
    const doc = parseMdx(source);
    expect(!doc.ok && doc.reason).toBe("parse-error");
    expect(printMdx(doc)).toBe(source);
  });

  test("math 문법을 켜면 수식 안의 중괄호를 식으로 읽지 않는다", () => {
    // `{a \cdot b}`는 JS 식이 아니라서 math 없이 읽으면 실패한다.
    const source = "export const metadata = {};\n\n$$\n\\frac{a \\cdot b}{c}\n$$\n";
    expect(parseMdx(source).ok).toBe(false);
    expect(parseMdx(source, { math: true }).ok).toBe(true);
  });
});
