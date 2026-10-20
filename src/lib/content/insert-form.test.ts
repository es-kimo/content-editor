import { describe, expect, test, vi } from "vitest";

import { parseMdx, readInserts, type InsertItem } from "@/lib/mdx-doc";
import { yjshdConfig } from "@/test/config";

import {
  advancedComponents,
  applyBodyInsertForm,
  applyInsertForm,
  bodyInsert,
  bodyInserts,
  formDirty,
  formInitialValue,
  imageFormTag,
  insertEntries,
  insertFormLabels,
  insertFormMessage,
  insertFormNotice,
  insertItemName,
  insertLimitMessage,
  insertMenuItems,
  isTextInsert,
  isTocInsert,
  newBodyInsertTarget,
  newInsertTarget,
  removeBodyInsert,
  removeInsert,
  TOC_NEEDS_HEADING,
  tocRemoveMessage,
  type InsertFormInput,
  type InsertFormTarget,
} from "./insert-form";
import { leavingAreas } from "./leave-guard";
import { createSaveFlow } from "./save-flow";
import { sourceChanged } from "./unsaved";

const syntax = yjshdConfig().syntax;
const text = (value: string): InsertFormInput => ({ text: value, ids: [] });

const SOURCE = `import image1 from "./1.png";

export const metadata = {
  title: '휴진 안내',
};

# 휴진 안내

진료를 쉬어요<Footnote id="1">공휴일</Footnote>.

<Image src={image1} alt="병원 입구" />
`;

const itemOf = <K extends InsertItem["kind"]>(source: string, kind: K) => {
  const list = readInserts(source, syntax);
  if (!list.ok) throw new Error("읽지 못함");
  return list.items.find((item): item is Extract<InsertItem, { kind: K }> => item.kind === kind)!;
};

/**
 * 원문 편집 화면처럼 편집 영역 하나와 그 영역의 폼을 띄운다. 편집기는 원문이 바뀔 때마다 미저장 여부를 알린다.
 * `edit`은 편집기에 직접 입력하는 것, `open`·`input`·`apply`·`cancel`은 폼 조작이다.
 */
const setup = (opened = SOURCE) => {
  const flow = createSaveFlow({ navigate: vi.fn() });
  let current = opened;
  let form: { target: InsertFormTarget; input: InsertFormInput } | null = null;
  const edit = (next: string) => {
    current = next;
    flow.report("source", sourceChanged(opened, current));
  };
  return {
    flow,
    source: () => current,
    edit,
    open(target: InsertFormTarget) {
      if (!flow.openForm("source")) return false;
      form = { target, input: formInitialValue(target) };
      return true;
    },
    input(text: string, ids: number[] = []) {
      form!.input = { text, ids };
      flow.editForm(formDirty(form!.target, form!.input));
    },
    apply() {
      const result = applyInsertForm(current, form!.target, form!.input, syntax);
      if (!result.ok) return result;
      if (result.changed) edit(result.source);
      form = null;
      flow.closeForm();
      return result;
    },
    cancel() {
      form = null;
      flow.closeForm();
    },
  };
};

const editFootnote = (source = SOURCE): InsertFormTarget => ({ kind: "edit", item: itemOf(source, "footnote") });

describe("폼 적용과 취소", () => {
  test("폼을 열고 취소하면 원문도 미저장 표시도 바뀌지 않는다", () => {
    const area = setup();

    area.open(editFootnote());
    area.input("설 연휴");
    area.cancel();

    expect(area.source()).toBe(SOURCE);
    expect(area.flow.getState().changed.source).toBeFalsy();
    expect(area.flow.getState().form).toBeNull();
  });

  test("취소해도 폼을 열기 전에 고치던 미저장 원문은 그대로 남는다", () => {
    const area = setup();
    const typed = SOURCE.replace("진료를 쉬어요", "이번 주는 진료를 쉬어요");
    area.edit(typed);

    area.open(editFootnote(typed));
    area.input("설 연휴");
    area.cancel();

    expect(area.source()).toBe(typed);
    expect(area.flow.getState().changed.source).toBe(true);
  });

  test("값을 바꾸지 않고 적용하면 원문을 그대로 두어 새 미저장 변경이 생기지 않는다", () => {
    const area = setup();

    area.open(editFootnote());
    const result = area.apply();

    expect(result).toMatchObject({ ok: true, changed: false, source: SOURCE });
    expect(area.source()).toBe(SOURCE);
    expect(area.flow.getState().changed.source).toBeFalsy();
  });

  test("값을 바꿔 적용하면 그 항목만 바뀌고 폼을 연 영역의 미저장 변경이 된다", () => {
    const area = setup();

    area.open(editFootnote());
    area.input("설 연휴");
    area.apply();

    expect(area.source()).toBe(SOURCE.replace(">공휴일<", ">설 연휴<"));
    expect(area.flow.getState().changed).toEqual({ source: true });
    expect(area.flow.getState().form).toBeNull();
  });

  test("새 각주를 적용하면 연 위치에 넣고, 취소하면 넣지 않는다", () => {
    const at = SOURCE.indexOf(".\n\n<Image");
    const footnote = (): InsertFormTarget => ({
      kind: "footnote",
      place: { at: { from: at, to: at }, opened: SOURCE },
    });
    const area = setup();

    area.open(footnote());
    area.input("토요일 포함");
    area.cancel();
    expect(area.source()).toBe(SOURCE);

    area.open(footnote());
    area.input("토요일 포함");
    area.apply();
    expect(area.source()).toContain('<Footnote id="1">공휴일</Footnote><Footnote id="2">토요일 포함</Footnote>.');
  });
});

describe("각주 출처 폼", () => {
  const end = { from: SOURCE.length, to: SOURCE.length };
  const newRef = (source = SOURCE) => newInsertTarget("footnote-ref", source, { at: end, opened: source }, syntax);

  test("현재 글의 각주를 골라 출처를 넣으면 다시 읽어도 고른 번호와 내용이 그대로다", () => {
    const area = setup();
    const target = newRef();
    expect(target).toMatchObject({ choices: [{ id: 1, text: "공휴일" }] });

    area.open(target);
    area.input("달력 <2024>", [1]);
    expect(area.apply()).toMatchObject({ ok: true, changed: true });

    expect(area.source()).toBe(`${SOURCE}\n<FootnoteRef ids={["1"]}>\n  달력 \\<2024\\>\n</FootnoteRef>\n`);
    expect(itemOf(area.source(), "footnote-ref")).toMatchObject({ ids: [1], text: "달력 <2024>" });
    expect(area.flow.getState().changed.source).toBe(true);
  });

  test("각주를 고르지 않거나 내용이 비면 적용하지 않고 무엇을 할지 안내한다", () => {
    const target = newRef();

    const unselected = applyInsertForm(SOURCE, target, text("달력"), syntax);
    const blank = applyInsertForm(SOURCE, target, { text: " ", ids: [1] }, syntax);

    expect(unselected).toEqual({ ok: false, reason: "missing-footnote" });
    expect(insertFormMessage(target, "missing-footnote")).toBe("연결할 각주를 하나 이상 선택해 주세요.");
    expect(blank).toEqual({ ok: false, reason: "empty" });
    expect(insertFormMessage(target, "empty")).toBe("내용을 입력해 주세요.");
  });

  test("이미 출처가 있는 각주는 고를 수 없고, 골라도 연결을 바꾸지 않는다", () => {
    const linked = `${SOURCE}\n두 번째<Footnote id="2">대체 공휴일</Footnote>\n\n<FootnoteRef ids={["1"]}>\n  달력\n</FootnoteRef>\n`;
    const at = linked.length;
    const target = newInsertTarget("footnote-ref", linked, { at: { from: at, to: at }, opened: linked }, syntax);

    expect(target).toMatchObject({ choices: [{ id: 2, text: "대체 공휴일" }] });
    const result = applyInsertForm(linked, target, { text: "책", ids: [1] }, syntax);
    expect(result).toEqual({ ok: false, reason: "ambiguous-link" });
    expect(insertFormMessage(target, "ambiguous-link")).toBe(
      "선택한 각주에 이미 출처가 있어요. 다른 각주를 선택해 주세요.",
    );
  });

  test("연결할 각주가 없으면 폼을 열 때부터 각주를 먼저 넣으라고 안내하고 적용을 막는다", () => {
    const plain = SOURCE.replace(/<Footnote id="1">공휴일<\/Footnote>/, "");

    expect(insertFormNotice(newRef(plain))).toEqual({
      text: "출처를 연결할 각주가 없어요. 먼저 각주를 넣어 주세요.",
      blocking: true,
    });
    expect(insertFormNotice(newRef())).toBeNull();
  });

  test("각주를 고르기만 해도 작성 중 입력이라 떠날 때 묻는다", () => {
    expect(formDirty(newRef(), { text: "", ids: [1] })).toBe(true);
    expect(formDirty(newRef(), text(""))).toBe(false);
  });

  test("기존 각주·출처 내용을 비워 적용하면 원문을 그대로 두고 내용을 입력하라고 안내한다", () => {
    expect(applyInsertForm(SOURCE, editFootnote(), text(""), syntax)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("목차 폼", () => {
  const HEADED = SOURCE.replace("진료를 쉬어요", "## 휴진 날짜\n\n진료를 쉬어요");
  const at = HEADED.indexOf("## 휴진");
  const newToc = (source = HEADED, from = at) =>
    newInsertTarget("toc", source, { at: { from, to: from }, opened: source }, syntax);

  test("목차가 없으면 선택 위치에 자동 목차를 넣고 다시 읽으면 지울 수 있는 목차다", () => {
    const area = setup(HEADED);
    const target = newToc();
    expect(insertFormNotice(target)).toBeNull();

    area.open(target);
    area.apply();

    expect(area.source()).toBe(HEADED.replace("## 휴진", "<TOC items={toc} />\n\n## 휴진"));
    const list = readInserts(area.source(), syntax);
    expect(list.ok && insertEntries(list).filter(isTocInsert)).toHaveLength(1);
  });

  test("소제목이 없는 글은 제목을 추가하라고 안내하지만 목차는 넣을 수 있다", () => {
    const target = newToc(SOURCE, SOURCE.indexOf("진료를"));

    expect(insertFormNotice(target)).toEqual({ text: TOC_NEEDS_HEADING, blocking: false });
    expect(TOC_NEEDS_HEADING).toBe("글에 제목을 추가하면 목차가 채워져요.");
    expect(applyInsertForm(SOURCE, target, text(""), syntax)).toMatchObject({ ok: true, changed: true });
  });

  test("자동이든 직접 만든 것이든 목차가 이미 있으면 기존 항목으로 안내하고 새로 넣지 않는다", () => {
    const custom = `${HEADED}\n<TOC items={[{ title: "직접", url: "#a" }]} />\n`;
    const auto = `${HEADED}\n<TOC items={toc} />\n`;

    for (const source of [custom, auto]) {
      const target = newToc(source);
      expect(insertFormNotice(target)).toEqual({
        text: "이미 목차가 있어요. 삽입 항목에서 기존 목차를 확인해 주세요.",
        blocking: true,
      });
      expect(applyInsertForm(source, target, text(""), syntax)).toEqual({ ok: false, reason: "toc-exists" });
    }
  });

  test("자동 목차를 지우면 목차만 빠지고, 읽은 뒤 원문이 바뀌었으면 지우지 않는다", () => {
    const withToc = `${HEADED}\n<TOC items={toc} />\n`;
    const toc = itemOf(withToc, "toc");

    expect(removeInsert(withToc, toc, syntax)).toMatchObject({ ok: true, source: HEADED, changed: true });
    expect(removeInsert(`앞\n\n${withToc}`, toc, syntax)).toEqual({ ok: false, reason: "target-changed" });
    expect(tocRemoveMessage("target-changed", "source")).toBe(
      "목차가 바뀌었거나 없어졌어요. 삽입 항목을 다시 확인해 주세요.",
    );
  });
});

describe("일반 편집 새 항목", () => {
  const doc = parseMdx(SOURCE, syntax);
  if (!doc.ok) throw new Error("나눌 수 없음");
  const { body } = doc;

  test("각주는 다음 번호와 입력 글자를 문장 안에 넣을 컴포넌트로 준다", () => {
    const target = newBodyInsertTarget("footnote", doc, body, syntax);

    expect(bodyInsert(doc, body, target as never, text("토요일 <포함>"), syntax)).toEqual({
      ok: true,
      insert: { kind: "inline", name: "Footnote", id: 2, text: "토요일 <포함>" },
    });
  });

  test("출처와 목차는 원문 편집과 같은 규칙으로 만든 원문을 문단 사이에 넣을 것으로 준다", () => {
    const ref = newBodyInsertTarget("footnote-ref", doc, body, syntax);
    const toc = newBodyInsertTarget("toc", doc, body, syntax);

    expect(bodyInsert(doc, body, ref as never, { text: "달력", ids: [1] }, syntax)).toEqual({
      ok: true,
      insert: { kind: "block", markdown: '<FootnoteRef ids={["1"]}>\n  달력\n</FootnoteRef>' },
    });
    expect(bodyInsert(doc, body, ref as never, text("달력"), syntax)).toEqual({
      ok: false,
      reason: "missing-footnote",
    });
    expect(bodyInsert(doc, body, toc as never, text(""), syntax)).toEqual({
      ok: true,
      insert: { kind: "block", markdown: "<TOC items={toc} />" },
    });
  });

  test("본문에 목차가 있으면 넣지 않고, 지우면 그 목차만 뺀 본문을 돌려준다", () => {
    const withToc = `${body}\n<TOC items={toc} />\n`;
    const toc = newBodyInsertTarget("toc", doc, withToc, syntax);
    const list = bodyInserts(doc, withToc, syntax);
    const item = list.ok ? insertEntries(list).find(isTocInsert) : undefined;
    if (!item) throw new Error("목차를 읽지 못함");

    expect(bodyInsert(doc, withToc, toc as never, text(""), syntax)).toEqual({ ok: false, reason: "toc-exists" });
    expect(removeBodyInsert(doc, withToc, item, syntax)).toEqual({ ok: true, body, changed: true });
  });
});

describe("이미지 폼", () => {
  const at = SOURCE.indexOf("<Image");
  const newImage = (opened = SOURCE): InsertFormTarget => ({
    kind: "image",
    image: { file: "2.webp", name: "image2" },
    place: { at: { from: at, to: at }, opened },
  });

  test("원문 편집에서 새 이미지를 적용하면 선택 위치에 대체 텍스트가 있는 태그와 그 import만 더하고, 취소하면 그대로다", () => {
    const area = setup();

    area.open(newImage());
    area.input("진료 시간표");
    area.cancel();
    expect(area.source()).toBe(SOURCE);

    area.open(newImage());
    area.input("진료 시간표");
    area.apply();
    expect(area.source()).toBe(
      SOURCE.replace('"./1.png";\n', '"./1.png";\nimport image2 from "./2.webp";\n').replace(
        "<Image src={image1}",
        '<Image src={image2} alt="진료 시간표" />\n\n<Image src={image1}',
      ),
    );
    expect(area.flow.getState().changed.source).toBe(true);
  });

  test("새 이미지 폼은 입력 전에도 준비한 첨부를 들고 있어 떠날 때 묻는다", () => {
    const area = setup();

    area.open(newImage());

    expect(formDirty(newImage(), text(""))).toBe(true);
    area.input("");
    expect(leavingAreas(area.flow.getState())).toEqual(["source"]);
  });

  test("새 이미지 폼을 연 뒤 원문이 바뀌면 다른 곳에 넣지 않는다", () => {
    const typed = SOURCE.replace("# 휴진 안내", "# 휴진 안내 (수정)");

    expect(applyInsertForm(typed, newImage(), text("사진"), syntax)).toEqual({ ok: false, reason: "target-changed" });
  });

  test("일반 편집의 새 이미지는 대체 텍스트를 넣은 태그로 커서 자리에 넣는다", () => {
    const target: InsertFormTarget = { kind: "image", image: { file: "2.png", name: "image2" }, place: null };

    expect(imageFormTag(target, '"입구" & 계단')).toBe('<Image src={image2} alt="&quot;입구&quot; &amp; 계단" />');
  });

  test("일반 편집은 import를 붙인 원문에서 본문 이미지를 읽고, 대체 텍스트만 고친 본문을 돌려준다", () => {
    const doc = parseMdx(SOURCE, syntax);
    if (!doc.ok) throw new Error("나눌 수 없음");
    const list = bodyInserts(doc, doc.body, syntax);
    if (!list.ok) throw new Error("읽지 못함");
    const images = insertEntries(list).filter((entry) => entry.kind === "image");
    const [image] = images;
    if (!image || !isTextInsert(image)) throw new Error("이미지를 고칠 수 없음");

    expect(images).toHaveLength(1);
    expect(applyBodyInsertForm(doc, doc.body, { kind: "edit", item: image }, text("병원 입구"), syntax)).toEqual({
      ok: true,
      body: doc.body,
      changed: false,
    });
    expect(applyBodyInsertForm(doc, doc.body, { kind: "edit", item: image }, text("새 입구"), syntax)).toEqual({
      ok: true,
      body: doc.body.replace('alt="병원 입구"', 'alt="새 입구"'),
      changed: true,
    });
  });

  test("폼으로 고칠 수 없는 이미지는 구체적인 이유와 원문으로 가는 방법을 알린다", () => {
    const list = readInserts(`${SOURCE}\n<Image src={image1} alt={caption} />\n`, syntax);
    if (!list.ok) throw new Error("읽지 못함");
    const [limited] = list.limited;

    expect(limited).toMatchObject({ kind: "image", reason: "expression" });
    expect(insertLimitMessage(limited!.reason, "body")).toBe(
      "폼으로 고칠 수 없어요. 값이 코드로 되어 있어요. 원문 편집에서 직접 고쳐 주세요.",
    );
    expect(insertLimitMessage("not-image-import", "source")).toBe(
      "폼으로 고칠 수 없어요. 글 폴더의 이미지를 가져와 쓰는 형태가 아니에요. 원문에서 직접 고쳐 주세요.",
    );
  });
});

describe("바뀐 대상", () => {
  test("폼을 연 뒤 고칠 항목이 바뀌거나 사라지면 적용하지 않고 폼과 원문을 그대로 둔다", () => {
    const area = setup();
    area.open(editFootnote());
    area.input("설 연휴");
    const moved = SOURCE.replace("진료를 쉬어요", "이번 주는 진료를 쉬어요");
    area.edit(moved);

    expect(area.apply()).toEqual({ ok: false, reason: "target-changed" });
    area.edit(moved.replace(/<Footnote id="1">공휴일<\/Footnote>/, ""));
    expect(area.apply()).toEqual({ ok: false, reason: "target-changed" });

    expect(area.source()).not.toContain("설 연휴");
    expect(area.flow.getState().form).toEqual({ area: "source", dirty: true, blocked: null });
  });

  test("새 항목을 넣을 폼을 연 뒤 원문이 바뀌면 다른 곳에 넣지 않는다", () => {
    const at = SOURCE.indexOf(".\n\n<Image");
    const typed = SOURCE.replace("# 휴진 안내", "# 휴진 안내 (수정)");

    expect(
      applyInsertForm(
        typed,
        { kind: "footnote", place: { at: { from: at, to: at }, opened: SOURCE } },
        text("내용"),
        syntax,
      ),
    ).toEqual({ ok: false, reason: "target-changed" });
  });
});

describe("폼과 저장·이탈", () => {
  test("작성 중 입력이 있는 폼은 그 영역의 입력으로 이탈 확인에 들고, 처음 값으로 되돌리면 빠진다", () => {
    const area = setup();
    area.open(editFootnote());
    expect(leavingAreas(area.flow.getState())).toEqual([]);

    area.input("설 연휴");
    expect(leavingAreas(area.flow.getState())).toEqual(["source"]);

    area.input("공휴일");
    expect(leavingAreas(area.flow.getState())).toEqual([]);
  });

  test("적용하면 작성 중 입력이 그 영역의 미저장 변경으로 넘어가 이탈 확인에 계속 든다", () => {
    const area = setup();
    area.open(editFootnote());
    area.input("설 연휴");

    area.apply();

    expect(area.flow.getState().form).toBeNull();
    expect(leavingAreas(area.flow.getState())).toEqual(["source"]);
  });

  test("폼은 하나만 열고, 다른 폼을 열려고 하면 열려 있는 폼을 그대로 둔다", () => {
    const area = setup();
    area.open(editFootnote());
    area.input("설 연휴");

    expect(area.open({ kind: "edit", item: itemOf(SOURCE, "image") })).toBe(false);
    expect(area.flow.getState().form?.dirty).toBe(true);
  });
});

describe("삽입 항목 목록", () => {
  const LISTED = `${SOURCE}\n<Footnote id={n}>식</Footnote>\n\n<FootnoteRef ids={["1"]}>\n  달력\n</FootnoteRef>\n\n<TOC items={toc} />\n`;

  test("항목은 컴포넌트 이름이 아니라 용도와 번호로 부르고, 폼으로 못 고치는 항목도 원문 순서대로 둔다", () => {
    const list = readInserts(LISTED, syntax);
    if (!list.ok) throw new Error("읽지 못함");

    const entries = insertEntries(list);

    expect(entries.map(insertItemName)).toEqual(["각주 1", "이미지", "각주", "각주 1 출처", "목차"]);
    expect(entries.map(isTextInsert)).toEqual([true, true, false, true, false]);
  });

  test("넣기 메뉴는 글 분류가 허용한 항목만 용도 이름으로 둔다", () => {
    expect(insertMenuItems(["Footnote", "Mermaid"]).map((item) => item.label)).toEqual(["각주"]);
    expect(insertMenuItems(["Footnote", "Image"]).map((item) => item.label)).toEqual(["이미지", "각주"]);
    expect(insertMenuItems(["TOC", "FootnoteRef", "Footnote"]).map((item) => item.label)).toEqual([
      "각주",
      "각주 출처",
      "목차",
    ]);
    expect(insertMenuItems(["Mermaid"])).toEqual([]);
  });

  test("고급 삽입에는 넣기 메뉴가 폼으로 넣는 컴포넌트를 빼고 설정 순서대로 둔다", () => {
    expect(advancedComponents(["Footnote", "FootnoteRef", "Mermaid", "TOC", "Image", "Video"])).toEqual([
      "Mermaid",
      "Video",
    ]);
    expect(advancedComponents(["Footnote"])).toEqual([]);
  });

  test("수정 폼은 항목 이름과 고칠 값의 이름을 보인다", () => {
    expect(insertFormLabels(editFootnote())).toEqual({ title: "각주 1 수정", field: "각주 내용" });
    expect(insertFormLabels({ kind: "edit", item: itemOf(SOURCE, "image") })).toEqual({
      title: "이미지 수정",
      field: "대체 텍스트",
    });
    expect(insertFormLabels({ kind: "footnote", place: null }).title).toBe("각주 넣기");
    expect(insertFormLabels({ kind: "footnote-ref", place: null, choices: [] })).toEqual({
      title: "각주 출처 넣기",
      field: "출처 내용",
    });
    expect(insertFormLabels({ kind: "toc", place: null, exists: false, heading: true })).toEqual({
      title: "목차 넣기",
      field: null,
    });
    expect(insertFormLabels({ kind: "image", image: { file: "2.png", name: "image2" }, place: null })).toEqual({
      title: "이미지 넣기",
      field: "대체 텍스트",
    });
  });
});
