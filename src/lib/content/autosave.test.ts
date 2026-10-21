import { describe, expect, test, vi } from "vitest";

import { parseMdx } from "@/lib/mdx-doc";
import { memoryStorage } from "@/test/draft-storage";
import { JPEG, PNG, SOURCE } from "@/test/upload-images";

import { AUTOSAVE_FAILED, autosaveNotice, createAutosave, type Schedule } from "./autosave";
import { draftAttachments, listDrafts, saveDraft, type DraftContent, type DraftKey } from "./draft";
import { createLeaveGuard } from "./leave-guard";
import type { SaveState } from "./save-flow";
import { createUploadSession, type PreparedImage } from "./upload-session";

const NOW = new Date("2026-10-20T00:00:00Z");
const OWNER = { login: "alice", repo: "es-kimo/blog", branch: "main" };
const POST = { kind: "post", path: "content/a/index.mdx" } as const;
const KEY: DraftKey = { ...OWNER, doc: POST, tab: "tab-1" };

const content = (body: string, attachments: DraftContent["attachments"] = []): DraftContent => ({
  input: { mode: "form", values: { title: "제목" }, body },
  form: null,
  attachments,
});

/** 주입할 시계. `advance`는 시각을 옮기며 그 사이에 예약된 일을 부르고, 그 일이 시작한 저장소 쓰기가 끝나길 기다린다. */
function fakeClock() {
  let time = NOW.getTime();
  let tasks: { at: number; run: () => void }[] = [];
  const schedule: Schedule = (run, ms) => {
    const task = { at: time + ms, run };
    tasks.push(task);
    return () => (tasks = tasks.filter((t) => t !== task));
  };
  const advance = async (ms: number) => {
    time += ms;
    const due = tasks.filter((task) => task.at <= time);
    tasks = tasks.filter((task) => task.at > time);
    due.forEach((task) => task.run());
    await new Promise((resolve) => setTimeout(resolve));
  };
  return { schedule, now: () => new Date(time), advance };
}

/** 편집 화면처럼 `typed`를 지금 입력으로 보관하는 자동 보관. */
const setup = ({ quota }: { quota?: number } = {}) => {
  const clock = fakeClock();
  const { storage, items, block } = memoryStorage({ quota });
  const set = vi.spyOn(storage, "set");
  let typed: DraftContent | null = null;
  const autosave = createAutosave({
    storage,
    key: KEY,
    base: () => "sha-1",
    collect: () => typed,
    schedule: clock.schedule,
    now: clock.now,
  });
  /** 입력하고 화면처럼 자동 보관에 알린다. */
  const type = (body: string, attachments?: DraftContent["attachments"]) => {
    typed = content(body, attachments);
    autosave.touch();
  };
  const drafts = () => listDrafts(storage, OWNER, POST, clock.now());
  return { autosave, clock, storage, items, block, set, type, drafts, typed: () => typed };
};

const SAVED: SaveState = { status: "saved", href: "/repos/es-kimo/blog/post?path=content/a/index.mdx" };

describe("보관 시점", () => {
  test("입력하는 동안은 보관하지 않고, 마지막 입력 뒤 2초 안에 마지막 입력을 한 번 보관한다", async () => {
    const { clock, set, type, drafts } = setup();
    type("ㅇ");
    await clock.advance(400);
    type("안");
    await clock.advance(400);
    type("안녕");
    await clock.advance(400);
    expect(set).not.toHaveBeenCalled();

    await clock.advance(1600);

    expect(set).toHaveBeenCalledTimes(1);
    expect((await drafts()).map((draft) => draft.input)).toEqual([content("안녕").input]);
    await clock.advance(10_000);
    expect(set).toHaveBeenCalledTimes(1);
  });

  test("보관하면 보관 시각이 상태에 남는다", async () => {
    const { autosave, clock, type } = setup();
    expect(autosave.getState()).toEqual({ kind: "idle" });
    type("본문");
    await clock.advance(2000);

    expect(autosave.getState()).toEqual({ kind: "saved", savedAt: clock.now().getTime(), missing: [] });
  });

  test("준비 중인 이미지는 보관본에 들지 않고 ‘보관했어요’ 표시도 그 이미지까지 보관했다고 하지 않는다", async () => {
    const { clock, drafts, storage } = setup();
    const prepared = { extension: "png", content: PNG, width: 10, height: 20 };
    const session = createUploadSession({
      doc: parseMdx(SOURCE),
      files: ["1.png"],
      // ready.png만 바로 준비하고 나머지는 준비 중으로 남긴다.
      prepare: (file: { name: string }) =>
        new Promise<PreparedImage>((resolve) => (file.name === "ready.png" ? resolve(prepared) : undefined)),
    });
    let body = "";
    await session.add([{ name: "ready.png" }], ({ images }) => (body = `<Image src={${images[0]!.name}} alt="" />`));
    void session.add([{ name: "preparing.png" }], () => {});
    const autosave = createAutosave({
      storage,
      key: KEY,
      base: () => "sha-1",
      collect: () => content(body, draftAttachments(session, body)),
      schedule: clock.schedule,
      now: clock.now,
    });

    autosave.touch();
    await clock.advance(2000);

    expect(session.preparing).toBe(true);
    expect((await drafts())[0]?.attachments.map((attachment) => attachment.file)).toEqual(["2.png"]);
    expect(autosaveNotice(autosave.getState(), session.preparing)?.text).toBe(
      "이 브라우저에 보관했어요 · 2026-10-20 09:00. 준비 중인 이미지는 아직 보관하지 않았어요.",
    );
  });

  test("보관하지 못하면 실패 상태가 되고 다음 입력에 다시 보관한다", async () => {
    const { autosave, clock, type, block, drafts } = setup();
    type("처음");
    await clock.advance(2000);
    block();
    type("막힌 뒤 입력");
    await clock.advance(2000);

    expect(autosave.getState()).toEqual({ kind: "failed" });
    expect((await drafts()).map((draft) => draft.input)).toEqual([content("처음").input]);
  });

  test("첨부를 담지 못해 텍스트만 보관하면 빠진 첨부 이름이 상태에 남는다", async () => {
    const { autosave, clock, type } = setup({ quota: 0 });
    type("본문", [{ file: "2.png", content: PNG }]);
    await clock.advance(2000);

    expect(autosave.getState()).toMatchObject({ kind: "saved", missing: ["2.png"] });
  });
});

describe("상태 문구", () => {
  const savedAt = NOW.getTime();

  test("보관에 성공하면 ‘이 브라우저에 보관했어요’와 한국 시각을 보이고 경고 색을 쓰지 않는다", () => {
    expect(autosaveNotice({ kind: "saved", savedAt, missing: [] }, false)).toEqual({
      tone: "info",
      text: "이 브라우저에 보관했어요 · 2026-10-20 09:00",
    });
  });

  test("보관에 실패하면 ‘자동 보관하지 못했어요’를 경고로 보인다", () => {
    const notice = autosaveNotice({ kind: "failed" }, false);
    expect(notice).toEqual({ tone: "warning", text: AUTOSAVE_FAILED });
    expect(notice?.text).toMatch(/^자동 보관하지 못했어요/);
  });

  test("텍스트만 보관했으면 다 보관했다고 하지 않고 빠진 첨부 이름과 다시 고르라는 안내를 경고로 보인다", () => {
    const notice = autosaveNotice({ kind: "saved", savedAt, missing: ["2.png", "3.jpg"] }, false);
    expect(notice?.tone).toBe("warning");
    expect(notice?.text).toContain("글자만 보관했어요 · 2026-10-20 09:00");
    expect(notice?.text).toContain("이미지 2개(2.png, 3.jpg)는 보관하지 못했어요");
    expect(notice?.text).toContain("이미지를 다시 골라 주세요");
  });

  test("아직 보관한 적이 없으면 아무것도 보이지 않는다", () => {
    expect(autosaveNotice({ kind: "idle" }, false)).toBeNull();
  });
});

describe("저장 성공 정리", () => {
  test("저장에 성공하면 저장한 내용의 보관본을 지운다", async () => {
    const { autosave, clock, type, typed, drafts } = setup();
    type("저장할 본문");
    await clock.advance(2000);
    expect(await drafts()).toHaveLength(1);

    const result = await autosave.saving(typed(), async () => SAVED);

    expect(result).toEqual(SAVED);
    expect(await drafts()).toEqual([]);
  });

  test("입력 직후 보관하기 전에 저장해도 저장한 내용을 먼저 보관하고 저장에 성공하면 지운다", async () => {
    const { autosave, clock, type, typed, drafts } = setup();
    type("처음 보관한 본문");
    await clock.advance(2000);
    type("저장 직전에 고친 본문");

    await autosave.saving(typed(), async () => SAVED);
    await clock.advance(2000);

    expect(await drafts()).toEqual([]);
  });

  test("저장에 실패하면 보관본을 남긴다", async () => {
    const { autosave, clock, type, typed, drafts } = setup();
    type("저장하지 못한 본문");
    await clock.advance(2000);

    await autosave.saving(typed(), async () => ({ status: "error", message: "실패" }));

    expect((await drafts()).map((draft) => draft.input)).toEqual([content("저장하지 못한 본문").input]);
  });

  test("다른 탭의 보관본은 저장에 성공해도 남긴다", async () => {
    const { autosave, clock, type, typed, storage, drafts } = setup();
    await saveDraft(storage, { ...KEY, tab: "tab-2" }, content("다른 탭"), "sha-1", NOW);
    type("저장할 본문");
    await clock.advance(2000);

    await autosave.saving(typed(), async () => SAVED);

    expect((await drafts()).map((draft) => draft.key.tab)).toEqual(["tab-2"]);
  });
});

describe("버리기 정리", () => {
  /** 편집 화면처럼 이탈 확인이 입력을 버리고 떠나면 자동 보관도 버린다. */
  const guarded = (autosave: ReturnType<typeof setup>["autosave"]) => {
    const go = vi.fn();
    const guard = createLeaveGuard({ areas: () => ["body"], go });
    guard.onDiscard(() => void autosave.discard());
    return { guard, go };
  };

  test("‘변경 버리고 나가기’를 고르면 이 탭의 보관본을 지우고 그 뒤로는 보관하지 않는다", async () => {
    const { autosave, clock, type, drafts } = setup();
    const { guard, go } = guarded(autosave);
    type("버릴 입력");
    await clock.advance(2000);
    guard.request({ kind: "push", href: "/repos/es-kimo/blog" });

    guard.leave();
    await clock.advance(0);

    expect(go).toHaveBeenCalled();
    expect(await drafts()).toEqual([]);
    type("떠나는 중 입력");
    await clock.advance(2000);
    expect(await drafts()).toEqual([]);
  });

  test("‘변경 버리고 나가기’는 아직 보관하지 않은 입력의 보관도 취소한다", async () => {
    const { autosave, clock, type, drafts } = setup();
    const { guard } = guarded(autosave);
    type("버릴 입력");
    guard.request({ kind: "traverse", key: "previous" });

    guard.leave();
    await clock.advance(2000);

    expect(await drafts()).toEqual([]);
  });

  test("계속 편집하면 보관본을 지우지 않는다", async () => {
    const { autosave, clock, type, drafts } = setup();
    const { guard } = guarded(autosave);
    type("남길 입력");
    await clock.advance(2000);
    guard.request({ kind: "push", href: "/repos/es-kimo/blog" });

    guard.stay();
    await clock.advance(0);

    expect(await drafts()).toHaveLength(1);
  });

  test("새 글 ‘작성 취소’를 확인하면 그 새 글의 보관본을 지운다", async () => {
    const clock = fakeClock();
    const { storage } = memoryStorage();
    const key: DraftKey = { ...OWNER, doc: { kind: "new", collection: "blog", id: "new-1" }, tab: "tab-1" };
    await saveDraft(
      storage,
      { ...key, doc: { kind: "new", collection: "blog", id: "new-2" } },
      content("다른 새 글"),
      null,
      NOW,
    );
    const autosave = createAutosave({
      storage,
      key,
      base: () => null,
      collect: () => content("취소할 새 글"),
      schedule: clock.schedule,
      now: clock.now,
    });
    const { guard } = guarded(autosave);
    autosave.touch();
    await clock.advance(2000);

    guard.abandon({ kind: "push", href: "/repos/es-kimo/blog?collection=blog" });
    await clock.advance(0);

    const left = await listDrafts(storage, OWNER, { kind: "new", collection: "blog" }, clock.now());
    expect(left.map((draft) => draft.input)).toEqual([content("다른 새 글").input]);
  });
});

describe("복구한 보관본 이어 쓰기", () => {
  test("복구하면 그 입력을 이 탭의 보관본으로 옮기고 원래 보관본은 지워, 같은 입력이 보관본 둘로 나뉘지 않는다", async () => {
    const { autosave, clock, type, storage, drafts } = setup();
    const previous: DraftKey = { ...KEY, tab: "previous-tab" };
    await saveDraft(storage, previous, content("지난번 입력", [{ file: "2.jpg", content: JPEG }]), "sha-1", NOW);
    const [draft] = await drafts();

    await autosave.restore(draft);

    expect((await drafts()).map((d) => [d.key.tab, d.input, d.attachments.map((a) => a.file)])).toEqual([
      ["tab-1", content("지난번 입력").input, ["2.jpg"]],
    ]);
    type("지난번 입력에 이어 쓴 입력");
    await clock.advance(2000);
    expect((await drafts()).map((d) => [d.key.tab, d.input])).toEqual([
      ["tab-1", content("지난번 입력에 이어 쓴 입력").input],
    ]);
  });

  test("텍스트만 보관된 보관본을 복구하면 빠진 이미지를 다시 고를 때까지 상태와 보관본에 그 이름이 남는다", async () => {
    const { autosave, clock, type, storage, drafts } = setup({ quota: JPEG.length - 1 });
    const previous: DraftKey = { ...KEY, tab: "previous-tab" };
    await saveDraft(storage, previous, content("지난번 입력", [{ file: "2.jpg", content: JPEG }]), "sha-1", NOW);
    const [draft] = await drafts();
    expect(draft.missing).toEqual(["2.jpg"]);

    await autosave.restore(draft);
    expect(autosave.getState()).toMatchObject({ kind: "saved", missing: ["2.jpg"] });
    expect(autosaveNotice(autosave.getState(), false)?.tone).toBe("warning");
    expect((await drafts()).map((d) => [d.key.tab, d.missing])).toEqual([["tab-1", ["2.jpg"]]]);

    type("지난번 입력에 이어 쓴 입력");
    await clock.advance(2000);
    expect(autosave.getState()).toMatchObject({ kind: "saved", missing: ["2.jpg"] });
    expect((await drafts()).map((d) => d.missing)).toEqual([["2.jpg"]]);

    type("이미지를 다시 고른 입력", [{ file: "2.jpg", content: new Uint8Array(1) }]);
    await clock.advance(2000);
    expect(autosave.getState()).toMatchObject({ kind: "saved", missing: [] });
    expect((await drafts()).map((d) => [d.missing, d.attachments.map((a) => a.file)])).toEqual([[[], ["2.jpg"]]]);
  });

  test("아직 열려 있는 탭의 보관본을 다른 탭에서 복구해도 두 탭은 같은 보관본을 덮어쓰지 않는다", async () => {
    const clock = fakeClock();
    const { storage } = memoryStorage();
    const tab = (id: string) => {
      let typed: DraftContent | null = null;
      const autosave = createAutosave({
        storage,
        key: { ...KEY, tab: id },
        base: () => "sha-1",
        collect: () => typed,
        schedule: clock.schedule,
        now: clock.now,
      });
      const type = (body: string) => {
        typed = content(body);
        autosave.touch();
      };
      return { autosave, type };
    };
    const drafts = async () =>
      (await listDrafts(storage, OWNER, POST, clock.now())).map((d) => [d.key.tab, d.input]).sort();
    const a = tab("tab-a");
    a.type("A에서 쓰는 중");
    await clock.advance(2000);

    const b = tab("tab-b");
    const [draftOfA] = await listDrafts(storage, OWNER, POST, clock.now());
    await b.autosave.restore(draftOfA);
    a.type("A에서 이어 쓴 입력");
    b.type("B에서 이어 쓴 입력");
    await clock.advance(2000);

    expect(await drafts()).toEqual([
      ["tab-a", content("A에서 이어 쓴 입력").input],
      ["tab-b", content("B에서 이어 쓴 입력").input],
    ]);
    await b.autosave.discard();
    expect(await drafts()).toEqual([["tab-a", content("A에서 이어 쓴 입력").input]]);
  });

  test("복구한 입력을 보관하지 못하면 원래 보관본을 지우지 않는다", async () => {
    const { autosave, storage, block, drafts } = setup();
    const previous: DraftKey = { ...KEY, tab: "previous-tab" };
    await saveDraft(storage, previous, content("지난번 입력"), "sha-1", NOW);
    const [draft] = await drafts();
    block();

    await autosave.restore(draft);

    expect(autosave.getState()).toEqual({ kind: "failed" });
    expect((await drafts()).map((d) => [d.key.tab, d.input])).toEqual([["previous-tab", content("지난번 입력").input]]);
  });
});
