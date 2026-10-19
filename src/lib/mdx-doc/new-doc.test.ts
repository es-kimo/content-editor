import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { checkMdx } from "./check";
import { parseMetadata } from "./metadata";
import { newMdx } from "./new-doc";
import { parseMarkdown, parseMdx, type Syntax } from "./split";

const METADATA = { title: "11월 휴진 안내", other: { status: "ready" } };

/** 본문 첫 `#` 제목을 렌더링했을 때의 글자. */
function headingText(source: string, syntax: Syntax = {}): string | null {
  const doc = parseMdx(source, syntax);
  if (!doc.ok) return null;
  const heading = parseMarkdown(doc.body, syntax).children.find((node) => node.type === "heading");
  if (!heading || heading.depth !== 1) return null;
  return text(heading);
}

const text = (node: object): string => {
  const { value, children } = node as { value?: unknown; children?: object[] };
  return children ? children.map(text).join("") : typeof value === "string" ? value : "";
};

describe("newMdx", () => {
  test("metadata 블록과 제목 줄로 된 원문을 만든다", () => {
    expect(newMdx(METADATA, "11월 휴진 안내")).toBe(
      `export const metadata = {\n  title: "11월 휴진 안내",\n  other: {\n    status: "ready",\n  },\n};\n\n# 11월 휴진 안내\n`,
    );
  });

  test("만든 원문의 metadata를 다시 읽으면 넘긴 값과 같다", () => {
    const doc = parseMdx(newMdx(METADATA, "11월 휴진 안내"));
    const segment = doc.ok ? doc.head.find((s) => s.kind === "metadata") : undefined;
    expect(parseMetadata(segment!.text)).toEqual({ editable: true, value: METADATA });
  });

  test.each([
    "1월 18일 (화) 외래진료시간 변경 안내",
    "<Image> 컴포넌트 {중괄호} 쓰기",
    "*별표* _밑줄_ `코드` [링크](x) ![그림](y)",
    "C# 강좌 #",
    "역슬래시 \\ 와 &amp; 와 ~~취소~~ | 표",
  ])("마크다운·JSX 문자가 있는 제목도 글자 그대로 보이고 컴파일된다: %s", async (title) => {
    const source = newMdx({ title }, title);
    expect(headingText(source, { gfm: true })).toBe(title);
    expect(await checkMdx(source, { gfm: true, math: true })).toEqual({ ok: true });
  });

  describe.each(fixtureSources)("$name 픽스처 제목", ({ name, syntax }) => {
    const fixtures = loadFixtures(name);
    test.skipIf(!fixtures)("모든 글 제목으로 만든 원문이 컴파일되고 제목이 그대로 보인다", async () => {
      const titles = fixtures!.flatMap(({ source }) => {
        const doc = parseMdx(source, syntax);
        const segment = doc.ok ? doc.head.find((s) => s.kind === "metadata") : undefined;
        const metadata = segment ? parseMetadata(segment.text) : null;
        const title = metadata?.editable ? metadata.value.title : undefined;
        return typeof title === "string" ? [title.replace(/\s+/g, " ").trim()] : [];
      });
      expect(titles.length).toBeGreaterThan(0);
      for (const title of titles) {
        const source = newMdx({ title }, title);
        expect(headingText(source, syntax), title).toBe(title);
        expect(await checkMdx(source, syntax), title).toEqual({ ok: true });
      }
    });
  });
});
