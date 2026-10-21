import { describe, expect, test, vi } from "vitest";

import { parseMdx, readInserts, type InsertItem } from "@/lib/mdx-doc";
import { yjshdConfig } from "@/test/config";
import { fixtureSources, loadFixtures } from "@/test/fixtures";
import { PNG } from "@/test/upload-images";

import {
  advancedComponents,
  applyBodyInsertForm,
  applyInsertForm,
  bodyImageMoves,
  bodyImageReplace,
  bodyInsert,
  bodyInserts,
  formDirty,
  formInitialValue,
  imageActionMessage,
  imageFormTag,
  imageMoveNotice,
  imageMoves,
  insertEntries,
  insertFormDescription,
  insertFormLabels,
  insertFormMessage,
  insertFormNotice,
  insertItemName,
  insertLimitMessage,
  insertMenuItems,
  isImageInsert,
  isTextInsert,
  isTocInsert,
  moveBodyInsert,
  moveInsert,
  newBodyInsertTarget,
  newInsertTarget,
  removeBodyInsert,
  removeInsert,
  TOC_NEEDS_HEADING,
  tocRemoveMessage,
  type ImageInsertItem,
  type InsertFormInput,
  type InsertFormTarget,
} from "./insert-form";
import { leavingAreas } from "./leave-guard";
import { createSaveFlow } from "./save-flow";
import { sourceChanged } from "./unsaved";
import { sourceUploads } from "./upload";
import { createUploadSession, type AddedUpload } from "./upload-session";

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

  test("폼으로 고칠 수 없는 출처가 가리키는 각주는 고를 수 없어 연결할 각주가 없다고 안내한다", () => {
    const linked = `${SOURCE}\n<FootnoteRef ids={["1"]}>[달력](https://example.com)</FootnoteRef>\n`;

    const target = newRef(linked);

    expect(target.choices).toEqual([]);
    expect(insertFormNotice(target)).toMatchObject({ blocking: true });
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

    expect(bodyInsert(doc, body, target, text("토요일 <포함>"), syntax)).toEqual({
      ok: true,
      insert: { kind: "inline", name: "Footnote", id: 2, text: "토요일 <포함>" },
    });
  });

  test("출처와 목차는 원문 편집과 같은 규칙으로 만든 원문을 문단 사이에 넣을 것으로 준다", () => {
    const ref = newBodyInsertTarget("footnote-ref", doc, body, syntax);
    const toc = newBodyInsertTarget("toc", doc, body, syntax);

    expect(bodyInsert(doc, body, ref, { text: "달력", ids: [1] }, syntax)).toEqual({
      ok: true,
      insert: { kind: "block", markdown: '<FootnoteRef ids={["1"]}>\n  달력\n</FootnoteRef>' },
    });
    expect(bodyInsert(doc, body, ref, text("달력"), syntax)).toEqual({
      ok: false,
      reason: "missing-footnote",
    });
    expect(bodyInsert(doc, body, toc, text(""), syntax)).toEqual({
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

    expect(bodyInsert(doc, withToc, toc, text(""), syntax)).toEqual({ ok: false, reason: "toc-exists" });
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

const GALLERY = `import image1 from "./1.png";
import image2 from "./2.png";

export const metadata = {
  title: '진료 안내',
};

<Image src={image1} alt="병원 입구" />

진료 시간이에요.

<Image src={image2} alt="시간표" />

<Image src={image1} alt="입구 다시" />

문단 안 <Image src={image2} alt="문단 안" /> 이미지예요.
`;

const galleryDoc = parseMdx(GALLERY, syntax);
const GALLERY_BODY = galleryDoc.ok ? galleryDoc.body : "";

/** 읽은 삽입 항목(일반 편집은 `bodyInserts`)에서 대체 텍스트가 `alt`인 이미지. */
const imageIn = (list: ReturnType<typeof readInserts>, alt: string): ImageInsertItem => {
  if (!list.ok) throw new Error("읽지 못함");
  const found = list.items.find((item): item is ImageInsertItem => isImageInsert(item) && item.alt === alt);
  if (!found) throw new Error(`이미지 없음: ${alt}`);
  return found;
};
const sourceImage = (source: string, alt: string) => imageIn(readInserts(source, syntax), alt);

/** 편집 화면처럼 첨부를 바로 준비하는 세션. 교체할 새 파일도 이 세션으로 받는다. */
const uploadSession = (source: string, area: "body" | "source") =>
  createUploadSession({
    doc: parseMdx(source, syntax),
    files: [],
    prepare: async () => ({ extension: "png", content: PNG, width: 1, height: 1 }),
    used: area === "source" ? sourceUploads : undefined,
  });

/** 세션에 파일 하나를 더하고 더한 이미지를 돌려준다. 편집 화면은 이 이미지로 폼을 연다. */
const attach = async (session: ReturnType<typeof uploadSession>): Promise<AddedUpload> => {
  let added: AddedUpload | undefined;
  await session.add([{ name: "새.png" }], ({ images }) => (added = images[0]));
  return added!;
};

describe("이미지 교체 폼", () => {
  test("원문 편집에서 교체하면 고른 이미지 한 곳만 새 파일을 가리키고, 같은 파일을 쓰는 다른 곳과 그 import는 그대로다", () => {
    const target: InsertFormTarget = {
      kind: "replace",
      item: sourceImage(GALLERY, "병원 입구"),
      opened: GALLERY,
      image: { file: "3.png", name: "image3" },
    };

    expect(formInitialValue(target)).toEqual(text("병원 입구"));
    expect(applyInsertForm(GALLERY, target, text("병원 입구"), syntax)).toMatchObject({
      ok: true,
      changed: true,
      source: GALLERY.replace('"./2.png";\n', '"./2.png";\nimport image3 from "./3.png";\n').replace(
        '<Image src={image1} alt="병원 입구"',
        '<Image src={image3} alt="병원 입구"',
      ),
    });
  });

  test("대체 텍스트도 바꾸면 함께 고치고, 그 이미지만 쓰던 import는 빠진다", () => {
    const target: InsertFormTarget = {
      kind: "replace",
      item: sourceImage(SOURCE, "병원 입구"),
      opened: SOURCE,
      image: { file: "2.png", name: "image2" },
    };

    const result = applyInsertForm(SOURCE, target, text("새 입구"), syntax);

    expect(result).toMatchObject({
      ok: true,
      source: SOURCE.replace('import image1 from "./1.png";', 'import image2 from "./2.png";').replace(
        '<Image src={image1} alt="병원 입구" />',
        '<Image src={image2} alt="새 입구" />',
      ),
    });
  });

  test("일반 편집의 교체 폼은 기존 대체 텍스트로 열고, 취소하면 본문과 저장할 첨부가 그대로다", async () => {
    const session = uploadSession(GALLERY, "body");
    const item = imageIn(bodyInserts(session.plan.doc, GALLERY_BODY, syntax), "병원 입구");
    const replace = bodyImageReplace(session.plan.doc, GALLERY_BODY, item);
    const image = await attach(session);
    const target: InsertFormTarget = { kind: "replace", ...replace, image };

    expect(formInitialValue(target)).toEqual(text("병원 입구"));
    // 취소는 폼을 닫을 뿐 본문에 적용하지 않는다. 새 파일은 첨부에 남지만 본문이 쓰지 않아 저장하지 않는다.
    expect(session.unsaved(GALLERY_BODY)).toBe(false);
    expect(session.submission(GALLERY_BODY)).toEqual({ ok: true, images: [] });
  });

  test("일반 편집에서 교체하면 첨부할 때 더한 새 이미지를 그 자리만 가리키고, 그 새 이미지만 저장할 첨부가 된다", async () => {
    const session = uploadSession(GALLERY, "body");
    const item = imageIn(bodyInserts(session.plan.doc, GALLERY_BODY, syntax), "병원 입구");
    const replace = bodyImageReplace(session.plan.doc, GALLERY_BODY, item);
    const image = await attach(session);

    const result = applyBodyInsertForm(
      session.plan.doc,
      GALLERY_BODY,
      { kind: "replace", ...replace, image },
      text("새 입구"),
      syntax,
    );

    expect(image).toEqual({ file: "3.png", name: "image3" });
    const body = GALLERY_BODY.replace('<Image src={image1} alt="병원 입구" />', '<Image src={image3} alt="새 입구" />');
    expect(result).toEqual({ ok: true, body, changed: true });
    expect(session.submission(body)).toMatchObject({ ok: true, images: [{ file: "3.png" }] });
  });

  test("교체 폼은 바꿀 이미지와 새 파일을 보이고, 바꾸지 않는 것을 알린다", () => {
    const target: InsertFormTarget = {
      kind: "replace",
      item: sourceImage(GALLERY, "시간표"),
      opened: GALLERY,
      image: { file: "3.png", name: "image3" },
    };

    expect(insertFormLabels(target)).toEqual({ title: "이미지 교체", field: "대체 텍스트" });
    expect(insertFormDescription(target)).toBe(
      "이 자리의 이미지(2.png)만 새 이미지(3.png)로 바꿔요. 같은 이미지를 쓰는 다른 곳과 레포에 있는 기존 파일은 그대로 둬요.",
    );
    expect(insertFormDescription({ kind: "edit", item: target.item })).toBeNull();
  });

  test("적용하지 않은 교체 폼은 입력 전에도 떠날 때 묻고, 저장과 모드 전환을 막아 적용하거나 취소하라는 상태가 된다", () => {
    const area = setup(GALLERY);
    const target: InsertFormTarget = {
      kind: "replace",
      item: sourceImage(GALLERY, "병원 입구"),
      opened: GALLERY,
      image: { file: "3.png", name: "image3" },
    };
    area.open(target);
    area.input("병원 입구");

    expect(leavingAreas(area.flow.getState())).toEqual(["source"]);
    expect(area.flow.blocks({ target: "post", action: "update", mode: "source" })).toBe(true);
    expect(area.flow.getState().form?.blocked).toBe("update");
    expect(area.flow.blockedByForm("mode")).toBe(true);
    expect(area.flow.getState().form?.blocked).toBe("mode");

    area.cancel();

    expect(area.source()).toBe(GALLERY);
    expect(area.flow.blocks({ target: "post", action: "update", mode: "source" })).toBe(false);
    expect(leavingAreas(area.flow.getState())).toEqual([]);
  });

  test("폼을 연 뒤 이미지보다 앞에 import가 늘어도 고른 그 이미지를 교체한다", () => {
    const target: InsertFormTarget = {
      kind: "replace",
      item: sourceImage(GALLERY, "입구 다시"),
      opened: GALLERY,
      image: { file: "3.png", name: "image3" },
    };
    const added = GALLERY.replace('"./2.png";\n', '"./2.png";\nimport image9 from "./9.png";\n');

    const result = applyInsertForm(added, target, text("입구 다시"), syntax);

    expect(result).toMatchObject({
      ok: true,
      source: added
        .replace('"./9.png";\n', '"./9.png";\nimport image3 from "./3.png";\n')
        .replace('<Image src={image1} alt="입구 다시"', '<Image src={image3} alt="입구 다시"'),
    });
  });

  test("폼을 연 뒤 이미지가 바뀌었으면 교체하지 않고 다시 선택하라고 안내한다", () => {
    const target: InsertFormTarget = {
      kind: "replace",
      item: sourceImage(GALLERY, "병원 입구"),
      opened: GALLERY,
      image: { file: "3.png", name: "image3" },
    };
    const changed = GALLERY.replace('alt="병원 입구"', 'alt="정문"');

    const result = applyInsertForm(changed, target, text("병원 입구"), syntax);

    expect(result).toEqual({ ok: false, reason: "target-changed" });
    expect(insertFormMessage(target, "target-changed")).toBe(
      "고치려던 항목이 바뀌었거나 없어졌어요. 폼을 취소하고 삽입 항목에서 다시 선택해 주세요.",
    );
  });
});

describe("이미지 제거", () => {
  test("원문 편집에서 제거하면 고른 태그 한 곳만 빠지고 다른 곳에서 쓰는 import는 남는다", () => {
    const result = removeInsert(GALLERY, sourceImage(GALLERY, "병원 입구"), syntax);

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      source: GALLERY.replace('<Image src={image1} alt="병원 입구" />\n\n', ""),
    });
  });

  test("일반 편집에서 제거하면 본문에서 그 태그만 빠진다", () => {
    if (!galleryDoc.ok) throw new Error("나눌 수 없음");
    const item = imageIn(bodyInserts(galleryDoc, GALLERY_BODY, syntax), "시간표");

    expect(removeBodyInsert(galleryDoc, GALLERY_BODY, item, syntax)).toEqual({
      ok: true,
      body: GALLERY_BODY.replace('<Image src={image2} alt="시간표" />\n\n', ""),
      changed: true,
    });
  });

  test("원문을 읽은 뒤 이미지가 바뀌었으면 지우지 않고 이유를 사용자 문구로 돌려준다", () => {
    const changed = GALLERY.replace('alt="병원 입구"', 'alt="정문"');

    const result = removeInsert(changed, sourceImage(GALLERY, "병원 입구"), syntax);

    expect(result).toEqual({ ok: false, reason: "target-changed" });
    expect(imageActionMessage("target-changed", "source")).toBe(
      "이미지가 바뀌었거나 없어졌어요. 삽입 항목을 다시 확인해 주세요.",
    );
  });
});

describe("새로 넣은 이미지의 교체·제거와 저장할 첨부", () => {
  test("일반 편집에서 넣은 새 이미지를 교체하면 이전 새 이미지는 저장할 첨부에서 빠지고, 제거하면 첨부가 남지 않는다", async () => {
    const session = uploadSession(GALLERY, "body");
    const first = await attach(session);
    let body = `${GALLERY_BODY}\n${imageFormTag({ kind: "image", image: first, place: null }, "새 사진")}\n`;
    expect(session.submission(body)).toMatchObject({ ok: true, images: [{ file: "3.png" }] });

    const item = imageIn(bodyInserts(session.plan.doc, body, syntax), "새 사진");
    const replace = bodyImageReplace(session.plan.doc, body, item);
    const second = await attach(session);
    const replaced = applyBodyInsertForm(
      session.plan.doc,
      body,
      { kind: "replace", ...replace, image: second },
      text("새 사진"),
      syntax,
    );
    if (!replaced.ok) throw new Error(replaced.reason);
    body = replaced.body;

    expect(body).toContain('<Image src={image4} alt="새 사진" />');
    expect(session.submission(body)).toMatchObject({ ok: true, images: [{ file: "4.png" }] });

    const removed = removeBodyInsert(
      session.plan.doc,
      body,
      imageIn(bodyInserts(session.plan.doc, body, syntax), "새 사진"),
      syntax,
    );
    if (!removed.ok) throw new Error(removed.reason);

    expect(removed.body).toBe(GALLERY_BODY);
    expect(session.submission(removed.body)).toEqual({ ok: true, images: [] });
    expect(session.unsaved(removed.body)).toBe(false);
  });

  test("원문 편집에서 넣은 새 이미지를 교체하면 이전 새 이미지의 import까지 빠져 저장할 첨부에서 빠진다", async () => {
    const session = uploadSession(GALLERY, "source");
    const first = await attach(session);
    const at = GALLERY.indexOf("진료 시간이에요.");
    const inserted = applyInsertForm(
      GALLERY,
      { kind: "image", image: first, place: { at: { from: at, to: at }, opened: GALLERY } },
      text("새 사진"),
      syntax,
    );
    if (!inserted.ok) throw new Error(inserted.reason);
    let source = inserted.source;
    expect(session.submission(source)).toMatchObject({ ok: true, images: [{ file: "3.png" }] });

    const second = await attach(session);
    const replaced = applyInsertForm(
      source,
      { kind: "replace", item: sourceImage(source, "새 사진"), opened: source, image: second },
      text("새 사진"),
      syntax,
    );
    if (!replaced.ok) throw new Error(replaced.reason);
    source = replaced.source;

    expect(source).not.toContain("./3.png");
    expect(session.submission(source)).toMatchObject({ ok: true, images: [{ file: "4.png" }] });

    const removed = removeInsert(source, sourceImage(source, "새 사진"), syntax);
    if (!removed.ok) throw new Error(removed.reason);

    expect(removed.source).toBe(GALLERY);
    expect(session.submission(removed.source)).toEqual({ ok: true, images: [] });
  });
});

describe("이미지 이동", () => {
  test("원문 편집에서 앞으로 옮기면 그 이미지 블록만 앞 블록과 자리를 바꾸고, 뒤로 옮기면 되돌아온다", () => {
    const moved = moveInsert(GALLERY, sourceImage(GALLERY, "시간표"), "before", syntax);
    if (!moved.ok) throw new Error(moved.reason);

    expect(moved.source).toBe(
      GALLERY.replace(
        '진료 시간이에요.\n\n<Image src={image2} alt="시간표" />',
        '<Image src={image2} alt="시간표" />\n\n진료 시간이에요.',
      ),
    );
    expect(moveInsert(moved.source, sourceImage(moved.source, "시간표"), "after", syntax)).toMatchObject({
      ok: true,
      source: GALLERY,
    });
  });

  test("일반 편집에서 뒤로 옮기면 본문에서 그 이미지 블록만 뒤 블록과 자리를 바꾼다", () => {
    if (!galleryDoc.ok) throw new Error("나눌 수 없음");
    const item = imageIn(bodyInserts(galleryDoc, GALLERY_BODY, syntax), "병원 입구");

    expect(moveBodyInsert(galleryDoc, GALLERY_BODY, item, "after", syntax)).toEqual({
      ok: true,
      body: GALLERY_BODY.replace(
        '<Image src={image1} alt="병원 입구" />\n\n진료 시간이에요.',
        '진료 시간이에요.\n\n<Image src={image1} alt="병원 입구" />',
      ),
      changed: true,
      index: 0,
    });
  });

  test("이웃 블록이 이미지면 서로 자리를 바꾸고, 옮긴 이미지가 삽입 항목 목록에서 몇 번째가 됐는지 돌려준다", () => {
    const moved = moveInsert(GALLERY, sourceImage(GALLERY, "시간표"), "after", syntax);
    if (!moved.ok) throw new Error(moved.reason);
    const list = readInserts(moved.source, syntax);
    if (!list.ok) throw new Error("읽지 못함");

    expect(moved.index).toBe(2);
    expect(insertEntries(list)[moved.index]).toMatchObject({ kind: "image", alt: "시간표" });
    expect(insertEntries(list)[1]).toMatchObject({ kind: "image", alt: "입구 다시" });
  });

  test("맨 앞 블록은 앞으로, 맨 뒤 블록은 뒤로 옮길 수 없는 상태를 돌려주고 버튼 옆 안내는 두지 않는다", () => {
    if (!galleryDoc.ok) throw new Error("나눌 수 없음");
    const first = imageIn(bodyInserts(galleryDoc, GALLERY_BODY, syntax), "병원 입구");
    const last = sourceImage(SOURCE, "병원 입구");

    const firstMoves = bodyImageMoves(galleryDoc, GALLERY_BODY, first, syntax);
    const lastMoves = imageMoves(SOURCE, last, syntax);

    expect(firstMoves).toEqual({ before: "first-block", after: null });
    expect(lastMoves).toEqual({ before: null, after: "last-block" });
    expect(imageMoves(GALLERY, sourceImage(GALLERY, "시간표"), syntax)).toEqual({ before: null, after: null });
    expect(imageMoveNotice(firstMoves, "body")).toBeNull();
    expect(imageMoveNotice(lastMoves, "source")).toBeNull();
    expect(moveInsert(SOURCE, last, "after", syntax)).toEqual({ ok: false, reason: "last-block" });
  });

  test("문단 안 이미지는 어느 쪽으로도 옮길 수 없고, 그 이유와 원문으로 가는 방법을 돌려준다", () => {
    if (!galleryDoc.ok) throw new Error("나눌 수 없음");
    const inline = imageIn(bodyInserts(galleryDoc, GALLERY_BODY, syntax), "문단 안");

    const moves = bodyImageMoves(galleryDoc, GALLERY_BODY, inline, syntax);

    expect(moves).toEqual({ before: "in-paragraph", after: "in-paragraph" });
    expect(imageMoveNotice(moves, "body")).toBe(
      "옮길 수 없어요. 문단 안에 글자와 함께 있는 이미지예요. 원문 편집에서 직접 옮겨 주세요.",
    );
    expect(moveBodyInsert(galleryDoc, GALLERY_BODY, inline, "before", syntax)).toEqual({
      ok: false,
      reason: "in-paragraph",
    });
    expect(imageActionMessage("in-container", "source")).toBe(
      "옮길 수 없어요. 목록이나 인용 안에 있는 이미지예요. 원문에서 직접 옮겨 주세요.",
    );
  });
});

describe.each(fixtureSources.map((source) => [source.name, source.syntax, loadFixtures(source.name)] as const))(
  "%s 픽스처 전체의 일반 편집 이미지",
  (_, fixtureSyntax, fixtures) => {
    const key = ({ name, alt }: ImageInsertItem) => `${name}:${alt}`;

    // 이미지를 지우면 import도 빠질 수 있어, 본문을 다시 나눠 얻은 본문이 그 태그만 뺀 본문인지 본다.
    test.skipIf(!fixtures)(
      "본문 이미지를 하나씩 지우면 그 이미지만 목록에서 빠지고 나머지 본문은 그대로다",
      { timeout: 60_000 },
      () => {
        const failures: string[] = [];
        let removed = 0;
        for (const fixture of fixtures ?? []) {
          const doc = parseMdx(fixture.source, fixtureSyntax);
          const list = bodyInserts(doc, doc.ok ? doc.body : "", fixtureSyntax);
          if (!doc.ok || !list.ok) continue;
          const bodyStart = fixture.source.length - doc.body.length;
          const images = list.items.filter(isImageInsert);
          for (const [index, image] of images.entries()) {
            const result = removeBodyInsert(doc, doc.body, image, fixtureSyntax);
            const after = result.ok ? bodyInserts(doc, result.body, fixtureSyntax) : null;
            const rest = after?.ok ? after.items.filter(isImageInsert).map(key) : null;
            const expected = images.filter((_, other) => other !== index).map(key);
            const kept = result.ok && result.body.startsWith(doc.body.slice(0, image.from - bodyStart).trimEnd());
            if (!kept || JSON.stringify(rest) !== JSON.stringify(expected)) failures.push(`${fixture.path} ${index}`);
            removed += 1;
          }
        }
        expect(failures).toEqual([]);
        expect(removed).toBeGreaterThan(0);
      },
    );
  },
);
