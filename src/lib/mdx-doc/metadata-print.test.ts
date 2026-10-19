import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { parseMetadata } from "./metadata";
import { detectStyle, printMetadata, setMetadata } from "./metadata-print";
import { parseMdx, printMdx } from "./split";

const doc = (init: string) => parseMdx(`import a from "a";\n\nexport const metadata = ${init};\n\n# 본문\n`);

describe("setMetadata", () => {
  test("값이 같으면 원본 블록을 그대로 둔다", () => {
    const source = `export const metadata = {\n  title: 'a',   // 주석\n  tags: [ "x" ]\n};\n\n본문\n`;
    const parsed = parseMdx(source);
    const result = setMetadata(parsed, { title: "a", tags: ["x"] });
    expect(result).toBe(parsed);
    expect(printMdx(result)).toBe(source);
  });

  test("값이 바뀌면 metadata 블록만 다시 쓰고 나머지는 원본 그대로다", () => {
    const out = printMdx(setMetadata(doc(`{\n  title: "a",\n}`), { title: "b" }));
    expect(out).toBe(`import a from "a";\n\nexport const metadata = {\n  title: "b",\n};\n\n# 본문\n`);
  });

  test("metadata 구간이 둘이면 첫 구간만 다시 쓰고 두 번째 구간은 원본 그대로다", () => {
    const second = `export const metadata = {title:"b"};`;
    const parsed = parseMdx(`export const metadata = {title:"a"};\n\n${second}\n\n본문\n`);
    expect(parsed.ok && parsed.head.filter((segment) => segment.kind === "metadata")).toHaveLength(2);
    const out = printMdx(setMetadata(parsed, { title: "c" }));
    expect(out.startsWith(`export const metadata = {\n  title: "c"`)).toBe(true);
    expect(out.endsWith(`\n\n${second}\n\n본문\n`)).toBe(true);
  });

  test("원본 스타일(작은따옴표, 4칸 들여쓰기, 후행 쉼표 없음)을 유지한다", () => {
    const parsed = doc(`{\n    title: 'a',\n    tags: ['x']\n}`);
    const out = printMdx(setMetadata(parsed, { title: "it's", tags: ["x", "y"] }));
    expect(out).toContain(`export const metadata = {\n    title: 'it\\'s',\n    tags: ['x', 'y']\n};`);
  });

  test("따옴표 키 스타일과 중첩 객체를 유지한다", () => {
    const style = detectStyle(`export const metadata = {\n  "title": "a",\n};`);
    expect(style.bareKeys).toBe(false);
    expect(printMetadata({ title: "a", other: { status: "draft" } }, style)).toBe(
      `export const metadata = {\n  "title": "a",\n  "other": {\n    "status": "draft",\n  },\n};`,
    );
  });

  test("긴 배열은 여러 줄로, 긴 문자열은 키 다음 줄로 쓴다", () => {
    const long = "가".repeat(130);
    const out = printMetadata({ description: long, tags: Array.from({ length: 30 }, (_, i) => `태그${i}`) });
    expect(out).toContain(`description:\n    "${long}",`);
    expect(out).toContain(`tags: [\n    "태그0",`);
    const reparsed = parseMetadata(out);
    expect(reparsed.editable && reparsed.value.tags).toHaveLength(30);
  });

  test("편집할 수 없는 metadata나 원문 모드 문서는 건드리지 않는다", () => {
    const unsupported = doc(`{ a: foo }`);
    expect(setMetadata(unsupported, { a: "b" })).toBe(unsupported);
    const broken = parseMdx("<div");
    expect(setMetadata(broken, { a: "b" })).toBe(broken);
  });
});

describe.each(fixtureSources)("픽스처 metadata 다시 쓰기: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("title만 바꾸면 diff가 metadata 블록 안에만 생기고 다시 파싱하면 바뀐 값이 나온다", () => {
    for (const f of fixtures!) {
      const parsed = parseMdx(f.source, source.syntax);
      if (!parsed.ok) throw new Error(`${f.path}: 파싱 실패`);
      const block = parsed.head.find((s) => s.kind === "metadata")!.text;
      const current = parseMetadata(block);
      if (!current.editable) throw new Error(`${f.path}: ${current.reason}`);

      // 값이 같으면 글 전체가 바이트 단위로 같다.
      expect(printMdx(setMetadata(parsed, structuredClone(current.value))), f.path).toBe(f.source);

      const title = `${String(current.value.title)} — "수정" 'x' \\ 끝`;
      const edited = printMdx(setMetadata(parsed, { ...current.value, title }));
      const start = f.source.indexOf(block);
      expect(edited.startsWith(f.source.slice(0, start)), f.path).toBe(true);
      expect(edited.endsWith(f.source.slice(start + block.length)), f.path).toBe(true);

      const reparsed = parseMdx(edited, source.syntax);
      const text = reparsed.ok ? reparsed.head.find((s) => s.kind === "metadata")?.text : undefined;
      const result = parseMetadata(text ?? "");
      expect(result.editable && result.value, f.path).toEqual({ ...current.value, title });
    }
  });
});
