import { describe, expect, test } from "vitest";

import { fixtureSources, loadFixtures } from "@/test/fixtures";

import { checkMdx } from "./check";
import {
  addFootnote,
  addFootnoteRef,
  addImageAt,
  addToc,
  footnoteRefChoices,
  hasToc,
  hasTocHeading,
  moveImage,
  readInserts,
  removeImage,
  removeToc,
  replaceImage,
  setInsertText,
  type InsertItem,
  type InsertKind,
} from "./inserts";
import type { Syntax } from "./split";

const blogSyntax: Syntax = { gfm: true, math: true };
const TRICKY = `"큰따옴표" '작은따옴표' {중괄호} <b>태그</b> & *별* _밑줄_ [괄호](x) # \\ $1$ | ~`;

const SOURCE = [
  'import image1 from "./1.png";',
  "",
  'export const metadata = { title: "글" };',
  "",
  "# 제목",
  "",
  '<Image src={image1} alt="고양이" size={"full"} />',
  "",
  '첫 문장<Footnote id="3">3</Footnote> 둘째 문장<Footnote id="7">설명</Footnote>',
  "",
  "<TOC items={toc} />",
  "",
  '<FootnoteRef ids={["3", "7"]}>',
  "  책 이름",
  "</FootnoteRef>",
  "",
].join("\n");

function read(source: string, syntax: Syntax = blogSyntax) {
  const result = readInserts(source, syntax);
  if (!result.ok) throw new Error("읽을 수 없는 원문");
  return result;
}

function itemOf<K extends InsertKind>(source: string, kind: K, index = 0): Extract<InsertItem, { kind: K }> {
  const items = read(source).items.filter((item): item is Extract<InsertItem, { kind: K }> => item.kind === kind);
  return items[index]!;
}

function edited(result: ReturnType<typeof setInsertText>): string {
  if (!result.ok) throw new Error(`고치지 못함: ${result.reason}`);
  return result.source;
}

describe("readInserts", () => {
  test("지원하는 이미지·각주·출처·목차를 값과 원문 위치로 읽는다", () => {
    const { items, limited } = read(SOURCE);
    expect(limited).toEqual([]);
    expect(items).toMatchObject([
      { kind: "image", component: "Image", name: "image1", path: "./1.png", alt: "고양이" },
      { kind: "footnote", id: 3, text: "3" },
      { kind: "footnote", id: 7, text: "설명" },
      { kind: "toc" },
      { kind: "footnote-ref", ids: [3, 7], text: "책 이름" },
    ]);
    expect(items.map((item) => SOURCE.slice(item.from, item.to))).toEqual([
      '<Image src={image1} alt="고양이" size={"full"} />',
      '<Footnote id="3">3</Footnote>',
      '<Footnote id="7">설명</Footnote>',
      "<TOC items={toc} />",
      '<FootnoteRef ids={["3", "7"]}>\n  책 이름\n</FootnoteRef>',
    ]);
  });

  test("src가 이미지가 아닌 주소인 동영상·임베드는 이미지 항목으로 돌려주지 않는다", () => {
    const source = [
      'import image1 from "./1.png";',
      "",
      '<Video src="https://www.youtube.com/embed/abc" />',
      "",
      '<EmbedIframe src="https://example.com/embed" title="임베드" />',
      "",
      '<Image src={image1} alt="고양이" />',
      "",
    ].join("\n");
    const { items, limited } = read(source);
    expect(limited).toEqual([]);
    expect(items.map((item) => source.slice(item.from, item.to))).toEqual(['<Image src={image1} alt="고양이" />']);
  });

  test("동적 표현식·중첩 컴포넌트·서식이 있는 항목은 숨기지 않고 위치와 제한 이유를 돌려준다", () => {
    const source = [
      'import image1 from "./1.png";',
      "",
      "<Image src={image1} alt={caption} />",
      '<Image src="/a.png" alt="경로" />',
      '<Image src={images[0]} alt="식" />',
      '<Image {...props} src={image1} alt="펼침" />',
      "",
      '가<Footnote id="1">{note}</Footnote> 나<Footnote id="2"><b>굵게</b></Footnote> 다<Footnote id={n}>n</Footnote>',
      '라<Footnote id="a">a</Footnote> 마<Footnote id="5" />',
      "",
      '<FootnoteRef ids={["1"]}>',
      "  [링크](https://a.com)",
      "</FootnoteRef>",
      "",
      "<FootnoteRef ids={list}>목록</FootnoteRef>",
      "",
      '<TOC items={[{ title: "직접", url: "#a" }]} />',
      "",
    ].join("\n");
    const { items, limited } = read(source);
    expect(items).toEqual([]);
    expect(limited.map((item) => [item.kind, item.reason, source.slice(item.from, item.to)])).toEqual([
      ["image", "expression", "<Image src={image1} alt={caption} />"],
      ["image", "not-image-import", '<Image src="/a.png" alt="경로" />'],
      ["image", "expression", '<Image src={images[0]} alt="식" />'],
      ["image", "expression", '<Image {...props} src={image1} alt="펼침" />'],
      ["footnote", "expression", '<Footnote id="1">{note}</Footnote>'],
      ["footnote", "nested", '<Footnote id="2"><b>굵게</b></Footnote>'],
      ["footnote", "expression", "<Footnote id={n}>n</Footnote>"],
      ["footnote", "non-numeric-id", '<Footnote id="a">a</Footnote>'],
      ["footnote", "empty", '<Footnote id="5" />'],
      ["footnote-ref", "nested", '<FootnoteRef ids={["1"]}>\n  [링크](https://a.com)\n</FootnoteRef>'],
      ["footnote-ref", "expression", "<FootnoteRef ids={list}>목록</FootnoteRef>"],
      ["toc", "custom-toc", '<TOC items={[{ title: "직접", url: "#a" }]} />'],
    ]);
  });

  test("번호가 겹친 각주와 없는 번호·겹친 각주·이미 연결된 각주를 가리키는 출처는 제한한다", () => {
    const source = [
      '가<Footnote id="1">1</Footnote> 나<Footnote id="1">1</Footnote> 다<Footnote id="2">2</Footnote>',
      "",
      '<FootnoteRef ids={["9"]}>없는 번호</FootnoteRef>',
      "",
      '<FootnoteRef ids={["1"]}>겹친 각주</FootnoteRef>',
      "",
      '<FootnoteRef ids={["2"]}>첫 출처</FootnoteRef>',
      "",
      '<FootnoteRef ids={["2"]}>둘째 출처</FootnoteRef>',
      "",
    ].join("\n");
    const { items, limited } = read(source);
    expect(items).toEqual([{ kind: "footnote", id: 2, text: "2", from: expect.any(Number), to: expect.any(Number) }]);
    expect(limited.map((item) => [item.kind, item.reason])).toEqual([
      ["footnote", "duplicate-id"],
      ["footnote", "duplicate-id"],
      ["footnote-ref", "missing-footnote"],
      ["footnote-ref", "ambiguous-link"],
      ["footnote-ref", "ambiguous-link"],
      ["footnote-ref", "ambiguous-link"],
    ]);
  });

  test("gfm이 링크로 읽은 URL은 글자로 읽고, 여러 줄 출처는 줄바꿈을 넣어 읽는다", () => {
    const source = [
      '가<Footnote id="1">1</Footnote>',
      "",
      '<FootnoteRef ids={["1"]}>',
      "  문서 제목",
      "  https://example.com/a_b?c=1&d=2",
      "</FootnoteRef>",
      "",
    ].join("\n");
    expect(itemOf(source, "footnote-ref").text).toBe("문서 제목\nhttps://example.com/a_b?c=1&d=2");
  });

  test("코드 블록 안의 태그 모양 글자는 항목이 아니다", () => {
    const source = '```mdx\n<Footnote id="1">1</Footnote>\n<TOC items={toc} />\n```\n';
    expect(read(source)).toEqual({ ok: true, items: [], limited: [] });
  });

  test("읽을 수 없는 원문은 parse-error다", () => {
    expect(readInserts('<Footnote id="1">\n', blogSyntax)).toEqual({ ok: false, reason: "parse-error" });
  });
});

describe("setInsertText", () => {
  test.each(["image", "footnote", "footnote-ref"] as const)(
    "%s 값을 따옴표·중괄호·태그 모양 글자로 고치면 다시 읽어도 입력값이고 번호·연결과 대상 밖 원문은 그대로다",
    async (kind) => {
      const target = itemOf(SOURCE, kind, kind === "footnote" ? 1 : 0);
      const result = edited(setInsertText(SOURCE, target, TRICKY, blogSyntax));

      const after = itemOf(result, kind, kind === "footnote" ? 1 : 0);
      expect(after.kind === "image" ? after.alt : "text" in after ? after.text : null).toBe(TRICKY);
      expect(read(result).limited).toEqual([]);
      expect(read(result).items.map((item) => ("id" in item ? item.id : "ids" in item ? item.ids : null))).toEqual(
        read(SOURCE).items.map((item) => ("id" in item ? item.id : "ids" in item ? item.ids : null)),
      );
      expect(result.slice(0, target.from)).toBe(SOURCE.slice(0, target.from));
      expect(result.slice(after.to)).toBe(SOURCE.slice(target.to));
      expect(await checkMdx(result, blogSyntax)).toEqual({ ok: true });
    },
  );

  test("고친 출처 내용은 원래 들여쓰기 안에서 내용만 바뀐다", () => {
    const result = edited(setInsertText(SOURCE, itemOf(SOURCE, "footnote-ref"), "새 출처 {x}", blogSyntax));
    expect(result).toBe(SOURCE.replace("  책 이름", "  새 출처 \\{x\\}"));
  });

  test("여러 줄 출처 내용은 줄마다 들여쓰고 줄 맨 앞의 목록 기호는 글자로 남긴다", () => {
    const text = "첫 줄\n- 목록 아님\n1. 번호 아님";
    const result = edited(setInsertText(SOURCE, itemOf(SOURCE, "footnote-ref"), text, blogSyntax));
    expect(itemOf(result, "footnote-ref").text).toBe(text);
    expect(result).toContain("  첫 줄\n  \\- 목록 아님\n  1\\. 번호 아님\n</FootnoteRef>");
  });

  test("URL은 이스케이프하지 않아 링크 주소가 그대로 남는다", () => {
    const text = "문서 https://example.com/a_b?c=1&d=2 끝";
    const result = edited(setInsertText(SOURCE, itemOf(SOURCE, "footnote-ref"), text, blogSyntax));
    expect(result).toContain("  문서 https://example.com/a_b?c=1&d=2 끝\n");
    expect(itemOf(result, "footnote-ref").text).toBe(text);
  });

  test("alt가 없는 이미지는 src 바로 뒤에 alt를 더한다", () => {
    const source = 'import image1 from "./1.png";\n\n<Image src={image1} />\n';
    const image = itemOf(source, "image");
    expect(image.alt).toBe("");
    expect(edited(setInsertText(source, image, '"고양이"', blogSyntax))).toBe(
      'import image1 from "./1.png";\n\n<Image src={image1} alt="&quot;고양이&quot;" />\n',
    );
  });

  test("값이 같으면 원문을 그대로 돌려준다", () => {
    for (const item of read(SOURCE).items) {
      if (item.kind === "toc") continue;
      const value = item.kind === "image" ? item.alt : item.text;
      expect(edited(setInsertText(SOURCE, item, value, blogSyntax))).toBe(SOURCE);
    }
  });

  test("읽은 뒤 원문이 바뀌어 같은 위치에 같은 항목이 없으면 고치지 않는다", () => {
    const target = itemOf(SOURCE, "footnote", 1);
    const shifted = SOURCE.replace("# 제목", "# 바뀐 제목");
    expect(setInsertText(shifted, target, "새 내용", blogSyntax)).toEqual({ ok: false, reason: "target-changed" });
    const rewritten = SOURCE.replace(">설명<", ">다른<");
    expect(setInsertText(rewritten, target, "새 내용", blogSyntax)).toEqual({ ok: false, reason: "target-changed" });
  });

  test("그 사이 지원하지 않는 형태가 된 항목과 읽을 수 없는 원문은 고치지 않는다", () => {
    const target = itemOf(SOURCE, "footnote", 1);
    const duplicated = SOURCE.replace('<Footnote id="3">3</Footnote>', '<Footnote id="7">3</Footnote>');
    expect(setInsertText(duplicated, target, "새 내용", blogSyntax)).toEqual({ ok: false, reason: "duplicate-id" });
    const broken = SOURCE + "\n<Callout>\n";
    expect(setInsertText(broken, target, "새 내용", blogSyntax)).toEqual({ ok: false, reason: "parse-error" });
  });

  test("앞 문장에 닫히지 않은 $나 `가 있어도 입력한 $와 `는 수식·코드를 닫지 않고 글자로 남는다", () => {
    const source = '약 $4.58억 규모 `코드<Footnote id="1">1</Footnote>\n';
    const result = edited(setInsertText(source, itemOf(source, "footnote"), "$1$ `x`", blogSyntax));
    expect(itemOf(result, "footnote").text).toBe("$1$ `x`");
    expect(result.slice(0, source.indexOf("<Footnote"))).toBe(source.slice(0, source.indexOf("<Footnote")));
  });

  test("빈 줄이 있어 문단이 나뉘거나 빈 내용이면 그대로 다시 읽히지 않으므로 invalid-text다", () => {
    const target = itemOf(SOURCE, "footnote", 1);
    expect(setInsertText(SOURCE, target, "가\n\n나", blogSyntax)).toEqual({ ok: false, reason: "invalid-text" });
    expect(setInsertText(SOURCE, target, "", blogSyntax)).toEqual({ ok: false, reason: "invalid-text" });
  });
});

describe("addFootnote", () => {
  test("3·7번 각주가 있으면 8번 각주를 넣고 내용을 글자로 남긴다", async () => {
    const at = SOURCE.indexOf(" 둘째 문장");
    const result = edited(addFootnote(SOURCE, { from: at, to: at }, TRICKY, blogSyntax));
    expect(itemOf(result, "footnote", 1)).toMatchObject({ id: 8, text: TRICKY });
    expect(result.slice(0, at)).toBe(SOURCE.slice(0, at));
    expect(result.endsWith(SOURCE.slice(at))).toBe(true);
    expect(await checkMdx(result, blogSyntax)).toEqual({ ok: true });
  });

  test("내용을 비우면 번호를 내용으로 쓰고 커서는 넣은 각주 뒤다", () => {
    const at = SOURCE.indexOf(" 둘째 문장");
    const result = addFootnote(SOURCE, { from: at, to: at }, "", blogSyntax);
    expect(result.ok && result.source.slice(0, result.cursor).endsWith('<Footnote id="8">8</Footnote>')).toBe(true);
  });

  test("import·metadata 구간에는 넣지 않는다", () => {
    expect(addFootnote(SOURCE, { from: 3, to: 3 }, "내용", blogSyntax)).toEqual({
      ok: false,
      reason: "outside-body",
    });
  });

  test("각주로 읽히지 않는 위치(코드 블록 안)에는 넣지 않는다", () => {
    const source = "```js\nconst a = 1;\n```\n";
    const at = source.indexOf("const");
    expect(addFootnote(source, { from: at, to: at }, "내용", blogSyntax)).toEqual({
      ok: false,
      reason: "invalid-position",
    });
  });
});

describe("addFootnoteRef", () => {
  const source = '가<Footnote id="1">1</Footnote> 나<Footnote id="2">2</Footnote>\n';

  test("고른 각주 번호로 출처를 넣으면 다시 읽어도 번호와 내용이 그대로다", async () => {
    const result = edited(addFootnoteRef(source, { from: source.length, to: source.length }, [1, 2], TRICKY));
    expect(itemOf(result, "footnote-ref")).toMatchObject({ ids: [1, 2], text: TRICKY });
    expect(result.startsWith(source)).toBe(true);
    expect(await checkMdx(result, blogSyntax)).toEqual({ ok: true });
  });

  test("없는 번호나 빈 선택은 missing-footnote다", () => {
    const end = { from: source.length, to: source.length };
    expect(addFootnoteRef(source, end, [3], "출처")).toEqual({ ok: false, reason: "missing-footnote" });
    expect(addFootnoteRef(source, end, [], "출처")).toEqual({ ok: false, reason: "missing-footnote" });
  });

  test("번호가 겹친 각주나 이미 출처가 있는 각주를 고르면 자동으로 고치지 않고 ambiguous-link다", () => {
    const duplicated = source + '\n다<Footnote id="1">1</Footnote>\n';
    const end = { from: duplicated.length, to: duplicated.length };
    expect(addFootnoteRef(duplicated, end, [1], "출처")).toEqual({ ok: false, reason: "ambiguous-link" });

    const linked = source + '\n<FootnoteRef ids={["2"]}>출처</FootnoteRef>\n';
    const after = { from: linked.length, to: linked.length };
    expect(addFootnoteRef(linked, after, [2], "출처")).toEqual({ ok: false, reason: "ambiguous-link" });
    expect(addFootnoteRef(linked, after, [1, 1], "출처")).toEqual({ ok: false, reason: "ambiguous-link" });
  });
});

describe("footnoteRefChoices", () => {
  test("폼으로 고칠 수 없는 출처가 가리키는 각주도 이미 연결된 것으로 보고 빼고, 연결하면 ambiguous-link다", () => {
    const source =
      '가<Footnote id="1">1</Footnote> 나<Footnote id="2">2</Footnote>\n\n<FootnoteRef ids={["1"]}>[링크](https://a.b)</FootnoteRef>\n';
    expect(read(source).limited).toMatchObject([{ kind: "footnote-ref", reason: "nested" }]);

    expect(footnoteRefChoices(source)).toEqual([{ id: 2, text: "2" }]);
    const end = { from: source.length, to: source.length };
    expect(addFootnoteRef(source, end, [1], "출처")).toEqual({ ok: false, reason: "ambiguous-link" });
  });

  test("내용에 서식이 있어 폼으로 고칠 수 없는 각주도 보이는 글자로 고를 수 있고 연결된다", () => {
    const source = '가<Footnote id="1">**굵은** `코드` 설명</Footnote>\n';
    expect(read(source).limited).toMatchObject([{ kind: "footnote", reason: "nested" }]);

    expect(footnoteRefChoices(source)).toEqual([{ id: 1, text: "굵은 코드 설명" }]);
    const result = edited(addFootnoteRef(source, { from: source.length, to: source.length }, [1], "출처"));
    expect(itemOf(result, "footnote-ref")).toMatchObject({ ids: [1], text: "출처" });
  });

  test("번호가 겹치거나 숫자가 아닌 각주는 고를 수 없고, 읽을 수 없는 원문은 빈 목록이다", () => {
    const source = '가<Footnote id="1">1</Footnote> 나<Footnote id="1">1</Footnote> 다<Footnote id="a">a</Footnote>\n';
    expect(footnoteRefChoices(source)).toEqual([]);
    expect(footnoteRefChoices('<Footnote id="1">1</Footnote>\n\n<Note>\n')).toEqual([]);
  });
});

describe("addToc와 removeToc", () => {
  test("목차가 없으면 선택 위치에 자동 목차를 넣는다", () => {
    const source = "# 제목\n\n문단\n";
    const result = edited(addToc(source, { from: 6, to: 6 }));
    expect(result).toBe("# 제목\n\n<TOC items={toc} />\n\n문단\n");
    expect(read(result).items).toMatchObject([{ kind: "toc" }]);
  });

  test("자동 목차나 사용자 정의 목차가 이미 있으면 넣지 않고, hasToc도 같은 글에서 목차가 있다고 한다", () => {
    const end = { from: SOURCE.length, to: SOURCE.length };
    expect(addToc(SOURCE, end, blogSyntax)).toEqual({ ok: false, reason: "toc-exists" });
    expect(hasToc(SOURCE, blogSyntax)).toBe(true);
    const custom = '<TOC items={[{ title: "직접", url: "#a" }]} />\n';
    expect(addToc(custom, { from: 0, to: 0 })).toEqual({ ok: false, reason: "toc-exists" });
    expect(hasToc(custom)).toBe(true);
  });

  test("목차가 없거나 코드 블록 안에만 있거나 읽을 수 없으면 hasToc은 false다", () => {
    expect(hasToc("# 제목\n\n문단\n")).toBe(false);
    expect(hasToc("```mdx\n<TOC items={toc} />\n```\n")).toBe(false);
    expect(hasToc("<TOC items={toc +} />\n")).toBe(false);
  });

  test("자동 목차를 지우면 앞뒤 문단이 빈 줄 하나로 이어지고 나머지는 그대로다", () => {
    const result = edited(removeToc(SOURCE, itemOf(SOURCE, "toc"), blogSyntax));
    expect(result).toBe(SOURCE.replace("<TOC items={toc} />\n\n", ""));
    expect(edited(removeToc("<TOC items={toc} />\n\n가\n", itemOf("<TOC items={toc} />\n\n가\n", "toc")))).toBe("가\n");
    expect(edited(removeToc("가\n\n<TOC items={toc} />\n", itemOf("가\n\n<TOC items={toc} />\n", "toc")))).toBe("가\n");
  });

  test("사용자 정의 목차는 지우지 않는다", () => {
    const source = '<TOC items={[{ title: "직접", url: "#a" }]} />\n';
    const [custom] = read(source).limited;
    expect(removeToc(source, { kind: "toc", from: custom!.from, to: custom!.to })).toEqual({
      ok: false,
      reason: "custom-toc",
    });
  });
});

describe("hasTocHeading", () => {
  test("## 이하 소제목이 있으면 목차를 채울 수 있다", () => {
    expect(hasTocHeading("# 제목\n\n## 소제목\n")).toBe(true);
    expect(hasTocHeading("# 제목\n\n<Note>\n\n### 안쪽 소제목\n\n</Note>\n")).toBe(true);
  });

  test("글 제목(#)뿐이거나 코드 블록 안의 ## 줄만 있거나 읽을 수 없으면 채울 제목이 없다", () => {
    expect(hasTocHeading("# 제목\n\n문단\n")).toBe(false);
    expect(hasTocHeading("```md\n## 코드\n```\n")).toBe(false);
    expect(hasTocHeading("<TOC items={toc +} />\n\n## 소제목\n")).toBe(false);
  });
});

describe("addImageAt", () => {
  test("이미지 import와 대체 텍스트가 있는 태그만 더하고 나머지 원문은 그대로다", async () => {
    const at = SOURCE.indexOf("<TOC");
    const result = addImageAt(SOURCE, { from: at, to: at }, { extension: "png", component: "Image", alt: TRICKY });
    if (!result.ok) throw new Error(result.reason);
    expect(result.file).toBe("2.png");
    const tag = `<Image src={image2} alt="${TRICKY.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" />`;
    expect(result.source).toBe(
      SOURCE.replace('"./1.png";\n', '"./1.png";\nimport image2 from "./2.png";\n').replace("<TOC", `${tag}\n\n<TOC`),
    );
    expect(itemOf(result.source, "image", 1)).toMatchObject({ name: "image2", path: "./2.png", alt: TRICKY });
    expect(await checkMdx(result.source, blogSyntax)).toEqual({ ok: true });
  });

  test("미리 고른 파일 이름을 주면 그 이름의 import와 태그를 더한다", () => {
    const at = SOURCE.indexOf("<TOC");
    const result = addImageAt(SOURCE, { from: at, to: at }, { file: "5.webp", component: "Image", alt: "강아지" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.file).toBe("5.webp");
    expect(result.source).toBe(
      SOURCE.replace('"./1.png";\n', '"./1.png";\nimport image5 from "./5.webp";\n').replace(
        "<TOC",
        '<Image src={image5} alt="강아지" />\n\n<TOC',
      ),
    );
  });

  test("미리 고른 파일 이름의 번호를 원문이 이미 쓰면 넣지 않는다", () => {
    const at = SOURCE.indexOf("<TOC");
    expect(addImageAt(SOURCE, { from: at, to: at }, { file: "1.jpg", component: "Image" })).toEqual({
      ok: false,
      reason: "name-taken",
    });
  });

  test("import·metadata 구간에는 넣지 않는다", () => {
    expect(addImageAt(SOURCE, { from: 0, to: 0 }, { extension: "png", component: "Image" })).toEqual({
      ok: false,
      reason: "outside-body",
    });
  });
});

const SHARED = [
  'import image1 from "./1.png";',
  'import image2 from "./2.png";',
  "",
  'export const metadata = { title: "글" };',
  "",
  "첫 문단",
  "",
  '<Image src={image1} alt="첫째" />',
  "",
  "가운데 문단",
  "",
  '<Image src={image1} alt="둘째" size={"full"} />',
  "",
  '<Image src={image2} alt="셋째" />',
  "",
  "끝 문단",
  "",
].join("\n");

function image(source: string, alt: string): Extract<InsertItem, { kind: "image" }> {
  return read(source).items.find(
    (item): item is Extract<InsertItem, { kind: "image" }> => item.kind === "image" && item.alt === alt,
  )!;
}

describe("replaceImage", () => {
  test("같은 import를 두 곳에서 쓰면 고른 곳의 src만 새 import로 바꾸고 대체 텍스트와 나머지 원문은 그대로다", async () => {
    const result = replaceImage(SHARED, image(SHARED, "둘째"), { extension: "webp" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.file).toBe("3.webp");
    expect(result.source).toBe(
      SHARED.replace('"./2.png";\n', '"./2.png";\nimport image3 from "./3.webp";\n').replace(
        '<Image src={image1} alt="둘째"',
        '<Image src={image3} alt="둘째"',
      ),
    );
    expect(image(result.source, "둘째")).toMatchObject({ component: "Image", name: "image3", path: "./3.webp" });
    expect(image(result.source, "첫째")).toMatchObject({ name: "image1", path: "./1.png" });
    expect(await checkMdx(result.source, blogSyntax)).toEqual({ ok: true });
  });

  test("미리 고른 파일 이름을 주면 그 이름으로 바꾸고, 그 번호를 원문이 이미 쓰면 바꾸지 않는다", () => {
    const result = replaceImage(SHARED, image(SHARED, "첫째"), { file: "7.jpg" });
    expect(result.ok && image(result.source, "첫째")).toMatchObject({ name: "image7", path: "./7.jpg" });
    expect(replaceImage(SHARED, image(SHARED, "첫째"), { file: "2.jpg" })).toEqual({ ok: false, reason: "name-taken" });
  });

  test("그 이미지만 쓰던 import는 교체하면서 지운다", () => {
    const result = replaceImage(SHARED, image(SHARED, "셋째"), { extension: "png" });
    expect(result.ok && result.source).toBe(
      SHARED.replace('import image2 from "./2.png";', 'import image3 from "./3.png";').replace(
        "src={image2}",
        "src={image3}",
      ),
    );
  });

  test("읽은 뒤 원문이 바뀌었거나 src가 식인 이미지는 바꾸지 않는다", () => {
    const target = image(SHARED, "둘째");
    expect(replaceImage(`앞\n\n${SHARED}`, target, { extension: "png" })).toMatchObject({
      ok: false,
      reason: "target-changed",
    });
    const dynamic = 'import image1 from "./1.png";\n\n<Image src={image1} alt={"설명"} />\n';
    const limited = read(dynamic).limited[0]!;
    const item = {
      ...limited,
      kind: "image",
      component: "Image",
      name: "image1",
      path: "./1.png",
      alt: "설명",
    } as const;
    expect(replaceImage(dynamic, item, { extension: "png" })).toEqual({ ok: false, reason: "expression" });
  });
});

describe("removeImage", () => {
  test("같은 import를 두 곳에서 쓰면 고른 태그만 지우고 import는 남긴다", () => {
    const result = removeImage(SHARED, image(SHARED, "첫째"));
    expect(result.ok && result.source).toBe(SHARED.replace('<Image src={image1} alt="첫째" />\n\n', ""));
    expect(result.ok && image(result.source, "둘째")).toMatchObject({ name: "image1", path: "./1.png" });
  });

  test("더 쓰는 곳이 없는 import는 태그와 함께 지운다", async () => {
    const result = removeImage(SHARED, image(SHARED, "셋째"));
    expect(result.ok && result.source).toBe(
      SHARED.replace('import image2 from "./2.png";\n', "").replace('<Image src={image2} alt="셋째" />\n\n', ""),
    );
    expect(result.ok && (await checkMdx(result.source, blogSyntax))).toEqual({ ok: true });
  });

  test("문단 안의 이미지는 태그만 지우고 문단 글자는 그대로다", () => {
    const source = 'import image1 from "./1.png";\n\n앞 글자 <Image src={image1} alt="안" /> 뒤 글자\n';
    const result = removeImage(source, image(source, "안"));
    expect(result.ok && result.source).toBe("앞 글자  뒤 글자\n");
  });
});

describe("moveImage", () => {
  test("앞으로 옮기면 바로 앞 블록과 자리만 바뀌고, 뒤로 옮기면 원래 원문으로 돌아온다", () => {
    const before = moveImage(SHARED, image(SHARED, "첫째"), "before");
    if (!before.ok) throw new Error(before.reason);
    expect(before.source).toBe(
      SHARED.replace('첫 문단\n\n<Image src={image1} alt="첫째" />', '<Image src={image1} alt="첫째" />\n\n첫 문단'),
    );
    const after = moveImage(before.source, image(before.source, "첫째"), "after");
    expect(after.ok && after.source).toBe(SHARED);
  });

  test("뒤로 옮기면 바로 뒤 블록과 자리를 바꾸고 두 블록 사이의 원문은 그대로다", () => {
    const source = SHARED.replace('<Image src={image2} alt="셋째" />\n\n', '<Image src={image2} alt="셋째" />\n\n\n');
    const result = moveImage(source, image(source, "셋째"), "after");
    expect(result.ok && result.source).toBe(
      source.replace(
        '<Image src={image2} alt="셋째" />\n\n\n끝 문단',
        '끝 문단\n\n\n<Image src={image2} alt="셋째" />',
      ),
    );
    expect(result.ok && image(result.source, "셋째").from).toBe(
      result.ok && result.cursor - '<Image src={image2} alt="셋째" />'.length,
    );
  });

  test("옮기면 나뉘어 있던 목록이 하나로 합쳐지는 것처럼 글 구조가 바뀌면 옮기지 않는다", () => {
    const source = 'import image1 from "./1.png";\n\n1. 하나\n\n<Image src={image1} alt="사이" />\n\n2. 둘\n';
    expect(moveImage(source, image(source, "사이"), "before")).toEqual({ ok: false, reason: "invalid-position" });
    expect(moveImage(source, image(source, "사이"), "after")).toEqual({ ok: false, reason: "invalid-position" });
  });

  test("본문 첫 블록은 앞으로, 마지막 블록은 뒤로 옮기지 않는다", () => {
    const source =
      'import image1 from "./1.png";\n\n<Image src={image1} alt="처음" />\n\n문단\n\n<Image src={image1} alt="끝" />\n';
    expect(moveImage(source, image(source, "처음"), "before")).toEqual({ ok: false, reason: "first-block" });
    expect(moveImage(source, image(source, "끝"), "after")).toEqual({ ok: false, reason: "last-block" });
  });

  test("문단 안·컴포넌트 안·목록 안 이미지와 식 속성 이미지는 이유를 돌려주고 옮기지 않는다", () => {
    const source = [
      'import image1 from "./1.png";',
      "",
      '앞 글자 <Image src={image1} alt="문단" /> 뒤 글자',
      "",
      "<Box>",
      '  <Image src={image1} alt="컴포넌트" />',
      "</Box>",
      "",
      '- <Image src={image1} alt="목록" />',
      "",
      '<Image src={image1} alt={"식"} />',
      "",
      "끝",
      "",
    ].join("\n");
    expect(moveImage(source, image(source, "문단"), "after")).toEqual({ ok: false, reason: "in-paragraph" });
    expect(moveImage(source, image(source, "컴포넌트"), "after")).toEqual({ ok: false, reason: "in-component" });
    expect(moveImage(source, image(source, "목록"), "before")).toEqual({ ok: false, reason: "in-container" });
    const limited = read(source).limited.find((item) => item.kind === "image")!;
    const item = { ...limited, kind: "image", component: "Image", name: "image1", path: "./1.png", alt: "식" } as const;
    expect(moveImage(source, item, "before")).toEqual({ ok: false, reason: "expression" });
  });
});

describe.each(fixtureSources)("픽스처 삽입 항목: $name", (source) => {
  const fixtures = loadFixtures(source.name);

  test.skipIf(!fixtures)("모든 글을 읽을 수 있고 값 변경 없는 적용은 읽기만 한 원문과 같다", () => {
    const changed: string[] = [];
    let total = 0;
    for (const f of fixtures!) {
      const list = readInserts(f.source, source.syntax);
      if (!list.ok) {
        changed.push(`${f.path}: parse-error`);
        continue;
      }
      total += list.items.length + list.limited.length;
      for (const item of list.items) {
        if (item.kind === "toc") continue;
        const result = setInsertText(f.source, item, item.kind === "image" ? item.alt : item.text, source.syntax);
        if (!result.ok || result.source !== f.source) changed.push(`${f.path}: ${item.kind} ${item.from}`);
      }
    }
    expect(changed).toEqual([]);
    expect(total).toBeGreaterThan(0);
  });

  test.skipIf(!fixtures)(
    "지원 항목을 따옴표·중괄호·태그 모양 글자로 고쳐도 다시 읽으면 입력값이고 대상 밖 원문은 그대로다",
    { timeout: 60_000 },
    () => {
      const failed: string[] = [];
      for (const f of fixtures!) {
        const list = readInserts(f.source, source.syntax);
        if (!list.ok) continue;
        for (const item of list.items) {
          if (item.kind === "toc") continue;
          const value = `${item.kind === "image" ? item.alt : item.text} ${TRICKY}`;
          const result = setInsertText(f.source, item, value, source.syntax);
          const after = result.ok ? readInserts(result.source, source.syntax) : null;
          const reread = after?.ok ? after.items.find((i) => i.from === item.from && i.kind === item.kind) : undefined;
          const ok =
            result.ok &&
            reread !== undefined &&
            (reread.kind === "image" ? reread.alt : "text" in reread ? reread.text : null) === value &&
            result.source.slice(0, item.from) === f.source.slice(0, item.from) &&
            result.source.slice(reread.to) === f.source.slice(item.to);
          if (!ok) failed.push(`${f.path}: ${item.kind} ${item.from}`);
        }
      }
      expect(failed).toEqual([]);
    },
  );

  test.skipIf(!fixtures)("출처에 고를 수 있다고 한 각주는 모두 글 끝에 새 출처로 연결된다", { timeout: 60_000 }, () => {
    const failed: string[] = [];
    for (const f of fixtures!) {
      const end = { from: f.source.length, to: f.source.length };
      for (const { id } of footnoteRefChoices(f.source, source.syntax)) {
        const result = addFootnoteRef(f.source, end, [id], "출처", source.syntax);
        if (!result.ok) failed.push(`${f.path}: ${id} ${result.reason}`);
      }
    }
    expect(failed).toEqual([]);
  });

  test.skipIf(!fixtures)(
    "옮길 수 있는 지원 이미지는 한 방향으로 옮긴 뒤 반대로 옮기면 원래 원문이다",
    { timeout: 60_000 },
    () => {
      const failed: string[] = [];
      let moved = 0;
      for (const f of fixtures!) {
        const list = readInserts(f.source, source.syntax);
        if (!list.ok) continue;
        for (const item of list.items) {
          if (item.kind !== "image") continue;
          for (const [there, back] of [
            ["before", "after"],
            ["after", "before"],
          ] as const) {
            const result = moveImage(f.source, item, there, source.syntax);
            if (!result.ok) continue;
            moved += 1;
            const from = result.cursor - (item.to - item.from);
            const after = readInserts(result.source, source.syntax);
            const target = after.ok ? after.items.find((i) => i.kind === "image" && i.from === from) : undefined;
            const returned = target?.kind === "image" ? moveImage(result.source, target, back, source.syntax) : null;
            if (!returned?.ok || returned.source !== f.source) failed.push(`${f.path}: ${there} ${item.from}`);
          }
        }
      }
      expect(failed).toEqual([]);
      expect(moved).toBeGreaterThan(0);
    },
  );

  test.skipIf(!fixtures)(
    "지원 이미지를 하나씩 교체·제거한 원문은 모두 컴파일되고 다시 읽힌다",
    { timeout: 300_000 },
    async () => {
      const failed: string[] = [];
      let edited = 0;
      for (const f of fixtures!) {
        const list = readInserts(f.source, source.syntax);
        if (!list.ok) continue;
        for (const item of list.items) {
          if (item.kind !== "image") continue;
          const results = {
            replace: replaceImage(f.source, item, { extension: "webp" }, source.syntax),
            remove: removeImage(f.source, item, source.syntax),
          };
          for (const [name, result] of Object.entries(results)) {
            edited += 1;
            const ok =
              result.ok &&
              readInserts(result.source, source.syntax).ok &&
              (await checkMdx(result.source, source.syntax)).ok;
            if (!ok) failed.push(`${f.path}: ${name} ${item.from}`);
          }
        }
      }
      expect(failed).toEqual([]);
      expect(edited).toBeGreaterThan(0);
    },
  );

  test.skipIf(!fixtures)("자동 목차가 있는 글은 모두 목차를 채울 소제목이 있다", () => {
    const tocPosts = fixtures!.filter((f) => {
      const list = readInserts(f.source, source.syntax);
      return list.ok && list.items.some((item) => item.kind === "toc");
    });
    expect(tocPosts.filter((f) => !hasTocHeading(f.source, source.syntax)).map((f) => f.path)).toEqual([]);
  });
});

describe("픽스처 EOSE 각주", () => {
  const blog = fixtureSources.find((source) => source.name === "blog")!;
  const eose = loadFixtures(blog.name)?.find((fixture) => fixture.path.startsWith("Research/EOSE/"));

  test.skipIf(!eose)("번호가 겹친 각주는 제한하고, 새 각주는 70번이며 넣어도 다른 곳은 그대로다", () => {
    const list = read(eose!.source, blog.syntax);
    expect(list.limited.some((item) => item.reason === "duplicate-id")).toBe(true);
    expect(list.items.some((item) => item.kind === "footnote-ref")).toBe(true);
    const end = eose!.source.length;
    const result = addFootnote(eose!.source, { from: end, to: end }, undefined, blog.syntax);
    expect(result.ok && result.source).toBe(eose!.source + '<Footnote id="70">70</Footnote>');
  });
});

describe("픽스처 GitHub Pages HTTPS 각주", () => {
  const blog = fixtureSources.find((source) => source.name === "blog")!;
  const post = loadFixtures(blog.name)?.find((fixture) =>
    fixture.path.startsWith("Computer-Science/github-pages-enforce-https/"),
  );

  test.skipIf(!post)("링크가 든 출처가 각주 1~4를 모두 가리키므로 고를 각주가 없다", () => {
    const refs = read(post!.source, blog.syntax).limited.filter((item) => item.kind === "footnote-ref");
    expect(refs.length).toBeGreaterThan(0);
    expect(footnoteRefChoices(post!.source, blog.syntax)).toEqual([]);
  });
});
