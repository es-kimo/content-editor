import { history, undo } from "@codemirror/commands";
import { EditorState, Text } from "@codemirror/state";
import { IterMode, type SyntaxNode, type Tree } from "@lezer/common";
import { describe, expect, test } from "vitest";

import { applyInsertForm, newInsertTarget, removeInsert, type InsertFormApply } from "@/lib/content/insert-form";
import { parseMdx, readInserts, type InsertItem, type Syntax } from "@/lib/mdx-doc";
import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { compileDiagnostics, insertComponent, mdxLanguage, replaceSource } from "./mdx-source";

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

  test("block 템플릿은 문단 사이에 빈 줄로 띄워 넣고 커서를 템플릿 바로 뒤에 둔다", () => {
    const state = select(SOURCE, SOURCE.indexOf("<TOC"));

    const next = state.update(insertComponent(state, "Mermaid", {})).state;

    const doc = next.doc.toString();
    expect(doc).toContain(`# GitHub Pages의 HTTPS\n\n<Mermaid chart={\``);
    expect(doc).toContain("`} />\n\n<TOC items={toc} />");
    expect(doc.slice(0, next.selection.main.head)).toMatch(/`} \/>$/);
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

describe("replaceSource", () => {
  const FOOTNOTED = `${SOURCE}\n인증서는 자동으로 갱신된다<Footnote id="1">공휴일</Footnote>.\n`;

  test("폼을 적용한 원문으로 바꾸면 달라진 구간만 바뀌고 커서는 적용한 항목 뒤다", () => {
    let state = EditorState.create({ doc: FOOTNOTED, extensions: [history()] });
    const next = FOOTNOTED.replace(">공휴일<", ">설 연휴<");
    const cursor = next.indexOf("</Footnote>") + "</Footnote>".length;

    const spec = replaceSource(state, next, cursor);
    state = state.update(spec).state;

    expect(spec.changes).toEqual({
      from: FOOTNOTED.indexOf("공휴일"),
      to: FOOTNOTED.indexOf("</Footnote>"),
      insert: "설 연휴",
    });
    expect(state.doc.toString()).toBe(next);
    expect(state.selection.main.head).toBe(cursor);
  });

  test("적용한 변경은 실행 취소 한 번에 적용 전 원문으로 돌아간다", () => {
    let state = EditorState.create({ doc: FOOTNOTED, extensions: [history()] });
    const next = FOOTNOTED.replace("공휴일", "공휴일 공휴일");
    state = state.update(replaceSource(state, next, 0)).state;

    undo({ state, dispatch: (tr) => (state = tr.state) });

    expect(state.doc.toString()).toBe(FOOTNOTED);
  });
});

describe("넣기·수정 폼을 원문 편집기에 적용", () => {
  const POST = `export const metadata = { title: "휴진 안내" };

# 휴진 안내

## 날짜

진료를 쉬어요<Footnote id="1">공휴일</Footnote>.

<Mermaid chart={\`flowchart TD\`} />
`;
  const syntax: Syntax = {};

  /** 편집기 상태에 폼 결과를 적용한다. 원문이 그대로면 편집기에 쓰지 않는다. */
  const applyTo = (state: EditorState, result: InsertFormApply) => {
    if (!result.ok) throw new Error(result.reason);
    return result.changed ? state.update(replaceSource(state, result.source, result.cursor)).state : state;
  };
  const cursorAt = (doc: string, at: number) =>
    EditorState.create({ doc, selection: { anchor: at }, extensions: [history()] });
  const placeAt = (state: EditorState) => {
    const { from, to } = state.selection.main;
    return { at: { from, to }, opened: state.doc.toString() };
  };
  const firstOf = <K extends InsertItem["kind"]>(source: string, kind: K) => {
    const list = readInserts(source, syntax);
    return list.ok
      ? list.items.find((item): item is Extract<InsertItem, { kind: K }> => item.kind === kind)
      : undefined;
  };

  test("커서 자리에 새 각주와 그 각주의 출처를 넣으면 넣은 곳 밖의 원문은 그대로이고 실행 취소 한 번에 하나씩 돌아간다", () => {
    let state = cursorAt(POST, POST.indexOf("."));
    const footnote = newInsertTarget("footnote", POST, placeAt(state), syntax);
    state = applyTo(state, applyInsertForm(POST, footnote, { text: "토요일 포함", ids: [] }, syntax));
    const withFootnote = state.doc.toString();
    expect(withFootnote).toBe(POST.replace("</Footnote>.", '</Footnote><Footnote id="2">토요일 포함</Footnote>.'));

    state = state.update({ selection: { anchor: withFootnote.length } }).state;
    const ref = newInsertTarget("footnote-ref", withFootnote, placeAt(state), syntax);
    expect(ref.choices.map((choice) => choice.id)).toEqual([1, 2]);
    state = applyTo(state, applyInsertForm(withFootnote, ref, { text: "달력", ids: [2] }, syntax));

    expect(state.doc.toString()).toBe(`${withFootnote}\n<FootnoteRef ids={["2"]}>\n  달력\n</FootnoteRef>\n`);
    undo({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe(withFootnote);
  });

  test("각주·출처 내용을 고치면 그 내용만 바뀌고 번호와 연결은 그대로다", () => {
    const linked = `${POST}\n<FootnoteRef ids={["1"]}>\n  달력\n</FootnoteRef>\n`;
    let state = cursorAt(linked, 0);

    state = applyTo(
      state,
      applyInsertForm(
        linked,
        { kind: "edit", item: firstOf(linked, "footnote")! },
        { text: "설 연휴", ids: [] },
        syntax,
      ),
    );
    const current = state.doc.toString();
    state = applyTo(
      state,
      applyInsertForm(
        current,
        { kind: "edit", item: firstOf(current, "footnote-ref")! },
        { text: "2025년 달력", ids: [] },
        syntax,
      ),
    );

    expect(state.doc.toString()).toBe(linked.replace(">공휴일<", ">설 연휴<").replace("  달력\n", "  2025년 달력\n"));
    expect(firstOf(state.doc.toString(), "footnote-ref")).toMatchObject({ ids: [1], text: "2025년 달력" });
  });

  test("같은 값으로 적용하면 편집기 상태를 바꾸지 않는다", () => {
    const state = cursorAt(POST, 0);
    const item = firstOf(POST, "footnote")!;

    const result = applyInsertForm(POST, { kind: "edit", item }, { text: "공휴일", ids: [] }, syntax);

    expect(applyTo(state, result)).toBe(state);
  });

  test("자동 목차를 넣고 지우면 처음 원문으로 돌아가고, 직접 만든 목차가 있으면 넣지 않는다", () => {
    let state = cursorAt(POST, POST.indexOf("## 날짜"));
    const toc = newInsertTarget("toc", POST, placeAt(state), syntax);
    state = applyTo(state, applyInsertForm(POST, toc, { text: "", ids: [] }, syntax));
    const withToc = state.doc.toString();
    expect(withToc).toBe(POST.replace("## 날짜", "<TOC items={toc} />\n\n## 날짜"));

    state = applyTo(state, removeInsert(withToc, firstOf(withToc, "toc")!, syntax));
    expect(state.doc.toString()).toBe(POST);

    const custom = `${POST}\n<TOC items={[{ title: "날짜", url: "#날짜" }]} />\n`;
    const end = { from: custom.length, to: custom.length };
    const blocked = newInsertTarget("toc", custom, { at: end, opened: custom }, syntax);
    expect(applyInsertForm(custom, blocked, { text: "", ids: [] }, syntax)).toEqual({
      ok: false,
      reason: "toc-exists",
    });
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
