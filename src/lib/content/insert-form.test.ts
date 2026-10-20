import { describe, expect, test, vi } from "vitest";

import { readInserts, type InsertItem } from "@/lib/mdx-doc";
import { yjshdConfig } from "@/test/config";

import { applyInsertForm, formDirty, formInitialValue, insertItemName, type InsertFormTarget } from "./insert-form";
import { leavingAreas } from "./leave-guard";
import { createSaveFlow } from "./save-flow";
import { sourceChanged } from "./unsaved";

const syntax = yjshdConfig().syntax;

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
  let form: { target: InsertFormTarget; value: string } | null = null;
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
      form = { target, value: formInitialValue(target) };
      return true;
    },
    input(value: string) {
      form!.value = value;
      flow.editForm(formDirty(form!.target, value));
    },
    apply() {
      const result = applyInsertForm(current, form!.target, form!.value, syntax);
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
    const footnote = (): InsertFormTarget => ({ kind: "footnote", at: { from: at, to: at }, opened: SOURCE });
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
      applyInsertForm(typed, { kind: "footnote", at: { from: at, to: at }, opened: SOURCE }, "내용", syntax),
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

describe("항목 이름", () => {
  test("항목은 컴포넌트 이름이 아니라 용도와 번호로 부른다", () => {
    const list = readInserts(
      `${SOURCE}\n<FootnoteRef ids={["1"]}>\n  달력\n</FootnoteRef>\n\n<TOC items={toc} />\n`,
      syntax,
    );
    expect(list.ok && list.items.map(insertItemName)).toEqual(["각주 1", "이미지", "각주 1 출처", "목차"]);
  });
});
