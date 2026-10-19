import { history, undo } from "@codemirror/commands";
import { EditorState, Text } from "@codemirror/state";
import { IterMode, type SyntaxNode, type Tree } from "@lezer/common";
import { describe, expect, test } from "vitest";

import { parseMdx, type Syntax } from "@/lib/mdx-doc";
import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { compileDiagnostics, insertComponent, mdxLanguage } from "./mdx-source";

const SOURCE = `import { toc } from "./toc";

export const metadata = {
  title: "GitHub Pages의 HTTPS",

  other: { status: "draft" },
};

# GitHub Pages의 HTTPS

<TOC items={toc} />

비용은 {price * 2}원이다.
`;

const parse = (source: string, syntax: Syntax = {}) => mdxLanguage(syntax).language.parser.parse(source);

/**
 * 이름이 name인 노드가 덮는 구간. JS 노드는 중첩 파서로 붙인 트리 안에서 찾는다.
 * 중첩 트리가 붙은 MDX 노드는 그 트리에 가려지므로 붙이기 전 트리에서 찾는다.
 */
const ranges = (tree: Tree, name: string) => {
  const found: [number, number][] = [];
  tree.iterate({
    mode: name.startsWith("Mdx") ? IterMode.IgnoreMounts : undefined,
    enter: (node) => void (node.name === name && found.push([node.from, node.to])),
  });
  return found;
};

/** pos 위치의 가장 안쪽 노드부터 바깥까지 이름. 본문 `{식}`의 JS 트리는 overlay로 붙어 있어 이렇게만 보인다. */
const ancestors = (tree: Tree, pos: number) => {
  const names: string[] = [];
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) names.push(node.name);
  return names;
};

const textOf = (source: string, [from, to]: [number, number]) => source.slice(from, to);

describe("mdxLanguage", () => {
  test("import와 metadata export를 빈 줄이 있는 객체까지 각각 ESM 블록으로 읽는다", () => {
    const esm = ranges(parse(SOURCE), "MdxEsm").map((r) => textOf(SOURCE, r));
    expect(esm).toEqual([
      `import { toc } from "./toc";`,
      SOURCE.slice(SOURCE.indexOf("export"), SOURCE.indexOf("};") + 2),
    ]);
  });

  test("ESM 블록과 본문의 {식}은 JS 문법 트리로 강조한다", () => {
    const tree = parse(SOURCE);
    expect(ranges(tree, "ImportDeclaration")).toHaveLength(1);
    expect(ranges(tree, "ExportDeclaration")).toHaveLength(1);
    expect(ranges(tree, "MdxExpression").map((r) => textOf(SOURCE, r))).toContain("{price * 2}");
    expect(ancestors(tree, SOURCE.indexOf("price"))).toContain("BinaryExpression");
  });

  test("본문의 {객체}는 블록 문이 아니라 객체로 강조한다", () => {
    const source = "<Chart data={{ a: 1 }} />\n\n값은 {{ a: 1 }.a}이다.\n";
    expect(ancestors(parse(source), source.lastIndexOf("a: 1"))).toContain("ObjectExpression");
  });

  test("본문 중간이나 코드 블록 안의 import 줄은 ESM으로 읽지 않는다", () => {
    const source = "# 제목\n\n- 목록\n  import a from 'a';\n\n```js\nimport b from 'b';\n```\n";
    expect(ranges(parse(source), "MdxEsm")).toEqual([]);
  });

  test("gfm을 켠 레포만 표를 강조한다", () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(ranges(parse(table, { gfm: true }), "Table")).toHaveLength(1);
    expect(ranges(parse(table), "Table")).toHaveLength(0);
  });
});

describe("compileDiagnostics", () => {
  test("컴파일되는 원문에는 오류가 없다", async () => {
    expect(await compileDiagnostics(Text.of(SOURCE.split("\n")), {})).toEqual([]);
  });

  test("컴파일 오류는 그 줄 전체에 표시한다", async () => {
    const broken = SOURCE.replace("<TOC items={toc} />", "<TOC items={toc +} />");
    const doc = Text.of(broken.split("\n"));

    const [diagnostic, ...rest] = await compileDiagnostics(doc, {});

    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({ severity: "error" });
    expect(broken.slice(diagnostic!.from, diagnostic!.to)).toBe("<TOC items={toc +} />");
  });
});

describe("insertComponent", () => {
  const FOOTNOTED = `${SOURCE}\n인증서는 자동으로 갱신된다<Footnote id="1">1</Footnote>.\n`;

  const select = (doc: string, from: number, to = from) =>
    EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [history()] });

  test("선택 영역을 템플릿으로 바꾸고 각주 번호는 편집 중인 원문에서 이어 매긴다", () => {
    const at = FOOTNOTED.indexOf("비용");
    const state = select(FOOTNOTED, at, at + "비용".length);

    const next = state.update(insertComponent(state, "Footnote", {})).state;

    expect(next.doc.toString()).toBe(FOOTNOTED.replace("비용", '<Footnote id="2">2</Footnote>'));
    expect(next.selection.main.head).toBe(at + '<Footnote id="2">2</Footnote>'.length);
  });

  test("block 템플릿은 문단 사이에 빈 줄로 띄워 넣는다", () => {
    const state = select(SOURCE, SOURCE.indexOf("<TOC"));

    const next = state.update(insertComponent(state, "Mermaid", {})).state;

    expect(next.doc.toString()).toContain(`# GitHub Pages의 HTTPS\n\n<Mermaid chart={\``);
    expect(next.doc.toString()).toContain("`} />\n\n<TOC items={toc} />");
  });

  test("넣은 템플릿은 실행 취소 한 번에 넣기 전 원문으로 돌아간다", () => {
    const at = SOURCE.indexOf("원이다.") + "원이다.".length;
    let state = select(SOURCE, at);
    state = state.update(insertComponent(state, "TOC", {})).state;
    expect(state.doc.toString()).not.toBe(SOURCE);

    const undone = undo({ state, dispatch: (tr) => (state = tr.state) });

    expect(undone).toBe(true);
    expect(state.doc.toString()).toBe(SOURCE);
    expect(state.selection.main.head).toBe(at);
  });
});

describe.each(fixtureSources.map((source) => [source.name, source.syntax, loadFixtures(source.name)] as const))(
  "%s 픽스처 전체",
  (_, syntax, fixtures) => {
    test.skipIf(!fixtures)("본문 앞 ESM 구간의 모든 문장을 ESM 블록으로 강조한다", () => {
      const failures: string[] = [];
      for (const fixture of fixtures ?? []) {
        const doc = parseMdx(fixture.source, syntax);
        if (!doc.ok) continue;
        const esm = ranges(parse(fixture.source, syntax), "MdxEsm");
        let offset = 0;
        for (const segment of doc.head) {
          const [from, to] = [offset, offset + segment.text.length];
          offset = to;
          if (segment.kind === "gap") continue;
          if (!esm.some(([start, end]) => start <= from && to <= end)) {
            failures.push(`${fixture.path}: ${segment.text.slice(0, 40)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  },
);
