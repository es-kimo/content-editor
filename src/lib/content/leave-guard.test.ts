import { describe, expect, test, vi } from "vitest";

import { parseMdx } from "@/lib/mdx-doc";
import { yjshdConfig } from "@/test/config";

import { createLeaveGuard, leavingAreas, traverseNeedsConfirm, type Leave } from "./leave-guard";
import { createSaveFlow, type SaveState } from "./save-flow";
import { createUploadSession, type PreparedImage } from "./upload-session";

const LIST: Leave = { kind: "push", href: "/repos/es-kimo/yjshd?collection=게시판" };
const BACK: Leave = { kind: "traverse", key: "previous" };

/** 편집 화면처럼 저장 흐름이 모은 미저장 영역으로 이탈을 지킨다. */
const setup = () => {
  const navigate = vi.fn();
  const flow = createSaveFlow({ navigate });
  const go = vi.fn();
  const guard = createLeaveGuard({ areas: () => leavingAreas(flow.getState()), go });
  return { flow, guard, go, navigate };
};

describe("앱 안 이동 확인", () => {
  test("미저장 영역이 있으면 목록 이동을 막고 사라질 영역과 함께 확인을 띄운다", () => {
    const { flow, guard, go } = setup();
    flow.report("metadata", true);

    expect(guard.request(LIST)).toBe(false);

    expect(guard.getState()).toEqual({ pending: LIST, areas: ["metadata"] });
    expect(go).not.toHaveBeenCalled();
  });

  test("계속 편집하면 이동하지 않고 확인을 닫으며, 다시 이동하려 하면 다시 묻는다", () => {
    const { flow, guard, go } = setup();
    flow.report("body", true);
    guard.request(BACK);

    guard.stay();

    expect(guard.getState().pending).toBeNull();
    expect(go).not.toHaveBeenCalled();
    expect(guard.request(BACK)).toBe(false);
    expect(guard.warnsUnload()).toBe(true);
  });

  test("변경 버리고 나가기는 요청한 목적지로 한 번만 가고, 도착할 때까지 다시 막거나 기본 경고를 요청하지 않는다", () => {
    const { flow, guard, go } = setup();
    flow.report("title", true);
    guard.request(BACK);

    guard.leave();
    guard.leave();

    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(BACK);
    // 뒤로 가기를 다시 실행하면 같은 이동이 다시 요청된다. 이미 나가기로 했으니 통과시킨다.
    expect(guard.request(BACK)).toBe(true);
    expect(guard.warnsUnload()).toBe(false);
  });

  test("변경 버리고 나가기를 고른 때부터 도착할 때까지만 입력을 버리는 중이다", () => {
    const { flow, guard } = setup();
    flow.report("metadata", true);
    guard.request(LIST);
    guard.stay();
    expect(guard.discarding()).toBe(false);

    guard.request(LIST);
    guard.leave();
    expect(guard.discarding()).toBe(true);

    guard.arrived();
    expect(guard.discarding()).toBe(false);
  });

  test("작성 취소처럼 화면이 이미 확인받은 이동은 이탈 확인 없이 한 번만 가고 입력을 버리는 중으로 둔다", () => {
    const { flow, guard, go } = setup();
    flow.report("title", true);
    flow.report("body", true);

    guard.abandon(LIST);
    guard.abandon(LIST);

    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(LIST);
    expect(guard.getState().pending).toBeNull();
    expect(guard.discarding()).toBe(true);
    expect(guard.warnsUnload()).toBe(false);
  });

  test("나간 뒤 화면 주소가 바뀌면 남은 미저장 입력을 다시 지킨다", () => {
    const { flow, guard } = setup();
    flow.report("title", true);
    guard.request(LIST);
    guard.leave();

    guard.arrived();

    expect(guard.request(LIST)).toBe(false);
    expect(guard.warnsUnload()).toBe(true);
  });

  test("확인 중에 다른 이동을 요청하면 막고 처음 목적지를 유지한다", () => {
    const { flow, guard } = setup();
    flow.report("source", true);
    guard.request(LIST);

    expect(guard.request(BACK)).toBe(false);

    expect(guard.getState().pending).toEqual(LIST);
  });

  test("변경 없는 화면은 확인 없이 이동하고 기본 경고도 요청하지 않는다", () => {
    const { guard } = setup();

    expect(guard.request(LIST)).toBe(true);
    expect(guard.getState().pending).toBeNull();
    expect(guard.warnsUnload()).toBe(false);
  });
});

describe("브라우저 기본 경고", () => {
  test("미저장 변경이 있을 때만 요청하고 입력을 되돌리면 요청하지 않는다", () => {
    const { flow, guard } = setup();
    flow.report("submenu", true);
    expect(guard.warnsUnload()).toBe(true);

    flow.report("submenu", false);

    expect(guard.warnsUnload()).toBe(false);
  });

  test("이미지를 준비하는 동안 요청하고 준비가 끝나 본문에서 빠지면 요청하지 않는다", async () => {
    const { flow, guard } = setup();
    const body = "# 휴진\n";
    let finish: (image: PreparedImage) => void = () => {};
    const session = createUploadSession<{ name: string }>({
      doc: parseMdx(body, yjshdConfig().syntax),
      files: [],
      prepare: () => new Promise((resolve) => (finish = resolve)),
    });
    // 화면(body-editor)처럼 본문이 참조하는 첨부와 준비 중을 첨부 이미지 영역으로 알린다.
    const added = session.add([{ name: "사진.png" }], () => {});
    flow.report("images", session.unsaved(body));
    expect(guard.warnsUnload()).toBe(true);

    finish({ extension: "png", content: new Uint8Array([1]), width: 1, height: 1 });
    await added;
    flow.report("images", session.unsaved(body));

    expect(guard.warnsUnload()).toBe(false);
  });
});

describe("적용하지 않은 폼", () => {
  test("폼에 작성 중 입력이 있으면 목록 이동을 막고, 계속 편집하면 폼과 입력 표시를 그대로 둔다", () => {
    const { flow, guard, go } = setup();
    flow.openForm("source");
    flow.editForm(true);

    expect(guard.request(LIST)).toBe(false);
    expect(guard.getState().areas).toEqual(["source"]);
    guard.stay();

    expect(go).not.toHaveBeenCalled();
    expect(flow.getState().form).toMatchObject({ area: "source", dirty: true });
    expect(guard.warnsUnload()).toBe(true);
  });

  test("열기만 하고 입력하지 않은 폼은 잃을 입력이 없어 묻지 않는다", () => {
    const { flow, guard } = setup();
    flow.openForm("body");

    expect(guard.request(BACK)).toBe(true);
    expect(guard.warnsUnload()).toBe(false);
  });

  test("본문 변경과 폼 입력이 함께 있어도 본문을 한 번만 알린다", () => {
    const { flow, guard } = setup();
    flow.report("body", true);
    flow.report("metadata", true);
    flow.openForm("body");
    flow.editForm(true);

    guard.request(LIST);

    expect(guard.getState().areas).toEqual(["body", "metadata"]);
  });
});

describe("저장 뒤 이동", () => {
  test("저장하는 동안은 입력이 아직 저장되지 않았으니 이탈을 확인한다", () => {
    const { flow, guard } = setup();
    flow.report("metadata", true);
    flow.request({ target: "post", action: "update", mode: "wysiwyg" }, () => new Promise<SaveState>(() => {}));

    expect(flow.getState().phase.kind).toBe("saving");
    expect(guard.request(LIST)).toBe(false);
  });

  test("새 글을 저장하고 글 화면으로 가는 동안은 저장한 제목·하위 메뉴·설정·본문·첨부 때문에 경고하지 않는다", async () => {
    const { flow, guard, navigate } = setup();
    for (const area of ["title", "submenu", "metadata", "body", "images"] as const) flow.report(area, true);

    flow.request({ target: "new", action: "save-draft", mode: "wysiwyg" }, async () => ({
      status: "saved",
      href: "/repos/es-kimo/yjshd/post?path=a",
    }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(guard.warnsUnload()).toBe(false);
    expect(guard.request(LIST)).toBe(true);
  });

  test("일반 편집으로 글을 저장해 다시 열리는 동안에도 저장에 담지 않은 원문 편집 입력은 계속 지킨다", async () => {
    const { flow, guard, navigate } = setup();
    flow.report("body", true);
    flow.report("metadata", true);
    flow.report("source", true);

    flow.request({ target: "post", action: "update", mode: "wysiwyg" }, async () => ({
      status: "saved",
      href: "/repos/es-kimo/yjshd/post?saved=c",
    }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(guard.request(LIST)).toBe(false);
    expect(guard.getState().areas).toEqual(["source"]);
    flow.settle();
    flow.report("body", false);
    flow.report("metadata", false);
    expect(guard.warnsUnload()).toBe(true);
  });

  test("게시 내리기는 확인에서 버리기로 한 입력이라 저장한 글 화면으로 가는 동안 경고하지 않는다", async () => {
    const { flow, guard, navigate } = setup();
    flow.report("body", true);
    flow.report("source", true);

    flow.request({ target: "post", action: "unpublish" }, async () => ({
      status: "saved",
      href: "/repos/es-kimo/yjshd/post?saved=c",
    }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(guard.warnsUnload()).toBe(false);
    expect(guard.request(LIST)).toBe(true);
  });

  test("휴지통 이동은 확인에서 버리기로 한 입력이라 옮긴 글 화면으로 가는 동안 경고하지 않는다", async () => {
    const { flow, guard, navigate } = setup();
    flow.report("metadata", true);
    flow.report("source", true);

    flow.request({ target: "post", action: "trash" }, async () => ({
      status: "saved",
      href: "/repos/es-kimo/yjshd/post?saved=c",
    }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(guard.warnsUnload()).toBe(false);
    expect(guard.request(LIST)).toBe(true);
  });
});

describe("뒤로·앞으로 판정", () => {
  const POST = "http://localhost/repos/es-kimo/yjshd/post?path=a";

  test("막을 수 있는 다른 주소로의 이력 이동은 앱이 확인한다", () => {
    expect(traverseNeedsConfirm({ from: POST, to: "http://localhost/repos/es-kimo/yjshd", cancelable: true })).toBe(
      true,
    );
  });

  test("막을 수 없는 이력 이동은 앱이 확인하지 않고 브라우저 기본 경고에 맡긴다", () => {
    expect(traverseNeedsConfirm({ from: POST, to: "https://example.com/", cancelable: false })).toBe(false);
  });

  test("해시만 다른 이력은 같은 화면이라 확인하지 않는다", () => {
    expect(traverseNeedsConfirm({ from: `${POST}#본문`, to: POST, cancelable: true })).toBe(false);
  });
});
