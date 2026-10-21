import { describe, expect, test, vi } from "vitest";

import { createGitHubClient } from "@/lib/github";
import type { MetadataObject, PostAction } from "@/lib/metadata-form";
import { testConfig, yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";
import { PNG } from "@/test/upload-images";

import { editorKeys, readPost } from "./read";
import {
  collectPostInput,
  createSaveFlow,
  modeHasUnsaved,
  postActions,
  savedAreas,
  STATUS_PROBLEM_MESSAGES,
  TRASHED_MESSAGE,
  type SaveRequest,
  type SaveState,
} from "./save-flow";
import { saveEdit } from "./save-edit";
import type { EditArea } from "./unsaved";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";
const config = yjshdConfig();
const board = config.collections.find((collection) => collection.name === "게시판")!;

const SOURCE = `import image1 from "./1.png";

export const metadata = {
  title: '11월 휴진 안내',
  description: '안녕하세요.',
  keywords: [],
  other: { status: "draft", createdAt: "2020-11-20T00:00:00Z" },
};

# 11월 휴진 안내

본문 <Image src={image1} alt="" />
`;

const ALL_ACTIONS: PostAction[] = ["save-draft", "publish", "update", "unpublish"];

/** 행동 하나를 일반 편집으로 하는 글 저장 요청. 게시 내리기는 입력을 담지 않는다. */
const postSave = (action: PostAction, mode: "wysiwyg" | "source" = "wysiwyg"): SaveRequest =>
  action === "unpublish" ? { target: "post", action } : { target: "post", action, mode };

describe("savedAreas", () => {
  test("일반 편집의 글 단위 저장은 제목·설정·본문·첨부를 한 요청에 함께 담는다", () => {
    for (const action of ["save-draft", "publish", "update"] as const) {
      expect(savedAreas(postSave(action))).toEqual(["metadata", "body", "images"]);
    }
  });

  test("원문 편집의 글 단위 저장은 원문과 원문 첨부를 한 요청에 함께 담는다", () => {
    expect(savedAreas(postSave("update", "source"))).toEqual(["source", "sourceImages"]);
  });

  test("게시 내리기는 상태만 바꾸므로 입력을 담지 않는다", () => {
    expect(savedAreas(postSave("unpublish"))).toEqual([]);
  });

  test("일반 편집 저장 한 번이 제목·설정·본문·첨부를 커밋 하나로 남기고, 다시 연 글은 그 값으로 열린다", async () => {
    const repo = fakeGitRepo(REPO, "main", [
      { path: POST, content: SOURCE },
      { path: "content/4.게시판/1.휴진/1.png", content: PNG },
    ]);
    const client = createGitHubClient("ghu_token", repo.fetch);
    const before = (await readPost(client, REPO, config, POST))!;

    const result = await saveEdit(client, REPO, config, {
      path: POST,
      baseSha: before.sha,
      action: "save-draft",
      content: {
        mode: "form",
        values: { title: "12월 휴진 안내", description: "새 요약" },
        body: `${before.doc.ok ? before.doc.body : ""}\n<Image src={image2} alt="안내문" />\n`,
        images: [{ file: "2.png", content: PNG }],
      },
    });

    expect(result.ok).toBe(true);
    expect(repo.log()).toHaveLength(2);
    const after = (await readPost(client, REPO, config, POST))!;
    expect(after.metadata?.editable && after.metadata.value).toMatchObject({ title: "12월 휴진 안내" });
    expect(after.metadata?.editable && after.metadata.value).toMatchObject({ description: "새 요약" });
    expect(editorKeys(after).body).toContain('<Image src={image2} alt="안내문" />');
    expect(repo.file("content/4.게시판/1.휴진/2.png")).toBeDefined();
  });
});

/** 이름·값 쌍으로 만든 FormData. */
const formData = (entries: [string, string | File][]) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

describe("collectPostInput", () => {
  const image = new File([PNG], "2.png", { type: "image/png" });
  const settings = (unchanged = vi.fn()) => ({
    data: formData([
      ["title", "12월 휴진 안내"],
      ["description", "새 요약"],
    ]),
    unchanged,
  });
  const wysiwyg = (unchanged = vi.fn()) => ({ text: "새 본문\n", data: formData([["image", image]]), unchanged });
  const source = (unchanged = vi.fn()) => ({ text: SOURCE, data: formData([["image", image]]), unchanged });

  test("일반 편집은 설정 폼 값과 본문·첨부 이미지를 한 요청에 함께 담는다", () => {
    const input = collectPostInput(
      { settings: () => settings(), wysiwyg: () => wysiwyg(), source: () => source() },
      "wysiwyg",
    );

    expect(input?.text).toBe("새 본문\n");
    expect(input?.data.get("title")).toBe("12월 휴진 안내");
    expect(input?.data.get("description")).toBe("새 요약");
    expect(input?.data.getAll("image")).toHaveLength(1);
    expect((input?.data.get("image") as File).name).toBe("2.png");
  });

  test("일반 편집이 변경 없음으로 끝나면 설정 폼과 본문 모두 낸 입력을 저장 기준으로 삼는다", () => {
    const settingsUnchanged = vi.fn();
    const bodyUnchanged = vi.fn();
    const input = collectPostInput(
      { settings: () => settings(settingsUnchanged), wysiwyg: () => wysiwyg(bodyUnchanged) },
      "wysiwyg",
    );

    input?.unchanged();

    expect(settingsUnchanged).toHaveBeenCalledOnce();
    expect(bodyUnchanged).toHaveBeenCalledOnce();
  });

  test("원문 편집은 원문과 그 첨부만 담고 설정 폼과 일반 편집 본문은 읽지 않는다", () => {
    const readSettings = vi.fn(() => settings());
    const readBody = vi.fn(() => wysiwyg());
    const input = collectPostInput({ settings: readSettings, wysiwyg: readBody, source: () => source() }, "source");

    expect(input?.text).toBe(SOURCE);
    expect(input?.data.get("title")).toBeNull();
    expect(input?.data.getAll("image")).toHaveLength(1);
    expect(readSettings).not.toHaveBeenCalled();
    expect(readBody).not.toHaveBeenCalled();
  });

  test("설정 폼이 입력을 낼 수 없으면 저장하지 않고 본문보다 먼저 설정 폼을 알린다", () => {
    const readBody = vi.fn(() => wysiwyg());

    expect(collectPostInput({ settings: () => null, wysiwyg: readBody }, "wysiwyg")).toBeNull();
    expect(readBody).not.toHaveBeenCalled();
  });

  test("어느 영역이든 입력을 낼 수 없으면 저장하지 않는다", () => {
    expect(collectPostInput({ settings: () => settings(), wysiwyg: () => null }, "wysiwyg")).toBeNull();
    expect(collectPostInput({ settings: () => settings() }, "wysiwyg")).toBeNull();
    expect(collectPostInput({ settings: () => settings(), source: () => null }, "source")).toBeNull();
    expect(collectPostInput({ settings: () => settings(), wysiwyg: () => wysiwyg() }, "source")).toBeNull();
  });
});

describe("modeHasUnsaved", () => {
  test("일반 편집은 제목·설정·본문·첨부, 원문 편집은 원문과 그 첨부의 미저장 입력만 센다", () => {
    expect(modeHasUnsaved("wysiwyg", { metadata: true })).toBe(true);
    expect(modeHasUnsaved("wysiwyg", { images: true })).toBe(true);
    expect(modeHasUnsaved("wysiwyg", { source: true, sourceImages: true })).toBe(false);
    expect(modeHasUnsaved("source", { sourceImages: true })).toBe(true);
    expect(modeHasUnsaved("source", { metadata: true, body: true })).toBe(false);
  });
});

describe("postActions", () => {
  const metadata = (other: MetadataObject["other"]): MetadataObject => ({ title: "제목", other });

  test("초안은 ‘게시’가 주 행동이고 ‘임시저장’이 보조 행동이다", () => {
    expect(postActions(board, metadata({ status: "draft" }))).toEqual({
      ok: true,
      status: "draft",
      primary: "publish",
      secondary: ["save-draft"],
    });
  });

  test("게시 대상은 ‘수정 반영’이 주 행동이고 ‘게시 내리기’가 보조 행동이다", () => {
    expect(postActions(board, metadata({ status: "ready" }))).toEqual({
      ok: true,
      status: "ready",
      primary: "update",
      secondary: ["unpublish"],
    });
  });

  test("휴지통 글은 게시 상태 값과 상관없이 휴지통이고 복구하라는 안내만 있다", () => {
    expect(postActions(board, metadata({ status: "ready", trashedAt: "2026-10-20T00:00:00Z" }))).toEqual({
      ok: false,
      status: "trashed",
      notice: TRASHED_MESSAGE,
    });
  });

  test("설정에 초안·게시 상태가 없는 글 분류의 글은 행동이 없고 편집 설정을 확인하라고 안내한다", () => {
    const noField = testConfig([{ name: "글", path: "content/{slug}/page.mdx", metadata: {} }]).collections[0]!;
    const oneOption = testConfig([
      {
        name: "글",
        path: "content/{slug}/page.mdx",
        metadata: { "other.status": { type: "select", options: ["ready", "hidden"] } },
      },
    ]).collections[0]!;

    expect(postActions(noField, metadata({ status: "draft" }))).toEqual({
      ok: false,
      status: null,
      notice: STATUS_PROBLEM_MESSAGES["status-field"],
    });
    expect(postActions(oneOption, metadata({ status: "ready" }))).toEqual({
      ok: false,
      status: null,
      notice: STATUS_PROBLEM_MESSAGES["status-options"],
    });
    expect(STATUS_PROBLEM_MESSAGES["status-field"]).toContain("편집 설정을 확인");
  });

  test("상태를 읽을 수 없는 글은 다른 상태로 넘겨짚지 않고 행동 없이 원문을 확인하라고 안내한다", () => {
    for (const value of [metadata({ status: "hidden" }), metadata({}), metadata("x"), null]) {
      expect(postActions(board, value)).toEqual({
        ok: false,
        status: null,
        notice: STATUS_PROBLEM_MESSAGES["status-value"],
      });
    }
    expect(STATUS_PROBLEM_MESSAGES["status-value"]).toContain("원문");
  });
});

function deferred() {
  let resolve!: (state: SaveState) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<SaveState>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const setupFlow = (changed: { [area in EditArea]?: boolean } = {}) => {
  const navigate = vi.fn<(href: string) => void>();
  const flow = createSaveFlow({ navigate });
  for (const [area, value] of Object.entries(changed)) flow.report(area as EditArea, value);
  return { flow, navigate };
};

const HREF = "/repos/es-kimo/yjshd/post?path=a&saved=c1&action=update";
const SAVED: SaveState = { status: "saved", href: HREF };
const UPDATE = postSave("update");

describe("createSaveFlow", () => {
  test("응답이 올 때까지 저장 중으로 두고 같은 행동도 다른 행동도 다시 제출하지 않는다", async () => {
    const { flow } = setupFlow({ metadata: true, body: true });
    const pending = deferred();
    const submit = vi.fn(() => pending.promise);
    const other = vi.fn(() => pending.promise);

    expect(flow.request(UPDATE, submit)).toBe(true);
    expect(flow.request(UPDATE, submit)).toBe(false);
    expect(flow.request(postSave("unpublish"), other)).toBe(false);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(flow.getState().phase).toEqual({ kind: "saving", request: UPDATE });
    expect(flow.getState().changed).toEqual({ metadata: true, body: true });
  });

  test("글 단위 저장은 다른 영역 입력을 버릴지 묻지 않고 바로 제출한다", () => {
    for (const [request, changed] of [
      [postSave("publish"), { metadata: true, body: true, images: true }],
      [postSave("update", "source"), { source: true, sourceImages: true }],
    ] as const) {
      const { flow } = setupFlow(changed);
      const submit = vi.fn(() => new Promise<SaveState>(() => {}));

      expect(flow.request(request, submit)).toBe(true);

      expect(submit).toHaveBeenCalledOnce();
      expect(flow.getState().phase.kind).toBe("saving");
    }
  });

  test("성공하면 저장한 글 화면으로 한 번 가고, 그 화면이 열릴 때까지 다음 저장을 받지 않는다", async () => {
    const { flow, navigate } = setupFlow({ metadata: true, body: true });
    const pending = deferred();

    flow.request(UPDATE, () => pending.promise);
    pending.resolve(SAVED);
    await flush();

    expect(navigate).toHaveBeenCalledExactlyOnceWith(HREF);
    expect(flow.getState().phase).toMatchObject({ kind: "saved", request: UPDATE });
    expect(flow.request(UPDATE, () => pending.promise)).toBe(false);

    expect(flow.settle()).toEqual(UPDATE);
    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.settle()).toBeNull();
  });

  test("저장 중에 알린 미저장 입력은 성공 응답이 와도 지우지 않는다", async () => {
    const { flow } = setupFlow({ body: true });
    const pending = deferred();
    flow.request(UPDATE, () => pending.promise);

    flow.report("metadata", true);
    pending.resolve(SAVED);
    await flush();
    flow.settle();

    expect(flow.getState().changed).toEqual({ body: true, metadata: true });
  });

  test("저장한 글 화면이 열리면 그 저장의 결과만 지우고 다른 대상의 결과는 둔다", async () => {
    const { flow } = setupFlow();
    flow.request({ target: "new" }, async () => ({ status: "error", message: "새 글 오류" }));
    await flush();

    flow.request(UPDATE, async () => SAVED);
    await flush();
    flow.settle();

    expect(flow.getState().results.post).toBeUndefined();
    expect(flow.getState().results.new).toEqual({ status: "error", message: "새 글 오류" });
  });

  test("변경 없음이면 제출한 입력의 기준만 갱신하고 미저장 표시는 편집 영역이 알린 그대로다", async () => {
    const { flow, navigate } = setupFlow({ metadata: true, body: true });
    const onUnchanged = vi.fn();

    flow.request(UPDATE, async () => ({ status: "unchanged" }), onUnchanged);
    await flush();

    expect(onUnchanged).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().changed).toEqual({ metadata: true, body: true });
    expect(flow.getState().results.post).toEqual({ status: "unchanged" });
  });

  test.each<[string, SaveState]>([
    ["입력 오류", { status: "error", message: "입력한 값을 확인해 주세요.", fields: { title: "값을 입력해 주세요." } }],
    ["컴파일 오류", { status: "error", message: "원문 편집에서 고쳐 주세요.", detail: "3행: Unexpected token" }],
    ["충돌", { status: "error", message: "글을 연 뒤 다른 곳에서 글이 바뀌었어요." }],
  ])("%s로 실패하면 결과를 보이고 미저장 표시를 둔 채 다시 저장할 수 있다", async (_, result) => {
    const { flow, navigate } = setupFlow({ source: true });
    const request = postSave("update", "source");

    flow.request(request, async () => result);
    await flush();

    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().results.post).toEqual(result);
    expect(flow.getState().changed).toEqual({ source: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(flow.request(request, async () => SAVED)).toBe(true);
  });

  test("저장 요청 자체가 실패해도 입력 표시를 둔 채 오류를 보이고 다시 저장할 수 있다", async () => {
    const { flow } = setupFlow({ title: true, submenu: true });
    const pending = deferred();

    flow.request({ target: "new" }, () => pending.promise);
    pending.reject(new TypeError("Failed to fetch"));
    await flush();

    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().results.new?.status).toBe("error");
    expect(flow.getState().changed).toEqual({ title: true, submenu: true });
    expect(flow.request({ target: "new" }, async () => SAVED)).toBe(true);
  });
});

describe("적용하지 않은 폼과 준비 중인 이미지", () => {
  test.each(ALL_ACTIONS)("폼이 열려 있으면 %s 저장을 제출하지 않고 막은 행동을 알린다", (action) => {
    const { flow } = setupFlow({ metadata: true, body: true });
    const submit = vi.fn(async () => SAVED);
    flow.openForm("body");

    expect(flow.blocks(postSave(action))).toBe(true);
    expect(flow.request(postSave(action), submit)).toBe(false);

    expect(submit).not.toHaveBeenCalled();
    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().form?.blocked).toBe(action);
  });

  test("폼이 열려 있으면 새 글 만들기도 제출하지 않는다", () => {
    const { flow } = setupFlow({ title: true });
    const submit = vi.fn(async () => SAVED);
    flow.openForm("body");

    expect(flow.request({ target: "new" }, submit)).toBe(false);

    expect(submit).not.toHaveBeenCalled();
    expect(flow.getState().form?.blocked).toBe("new");
  });

  test.each(ALL_ACTIONS)("어느 편집 영역이든 이미지를 준비하는 중이면 %s 저장을 제출하지 않는다", (action) => {
    for (const area of ["body", "source"] as const) {
      const { flow } = setupFlow({ body: true });
      const submit = vi.fn(async () => SAVED);
      flow.prepare(area, true);

      expect(flow.blocks(postSave(action))).toBe(true);
      expect(flow.request(postSave(action), submit)).toBe(false);

      expect(submit).not.toHaveBeenCalled();
      expect(flow.getState().phase).toEqual({ kind: "idle" });
    }
  });

  test("이미지 준비가 끝나면 다시 저장할 수 있다", () => {
    const { flow } = setupFlow({ body: true });
    const submit = vi.fn(() => new Promise<SaveState>(() => {}));
    flow.prepare("body", true);
    flow.prepare("body", false);

    expect(flow.blocks(UPDATE)).toBe(false);
    expect(flow.request(UPDATE, submit)).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });

  test("폼이 열려 있으면 모드 전환을 막고, 폼이 없으면 막지 않는다", () => {
    const { flow } = setupFlow();
    expect(flow.blockedByForm("mode")).toBe(false);

    flow.openForm("source");

    expect(flow.blockedByForm("mode")).toBe(true);
    expect(flow.getState().form?.blocked).toBe("mode");
  });

  test("영역마다 이미지를 준비하는 중인지 따로 두어, 한쪽 준비가 끝나도 다른 쪽 준비는 남는다", () => {
    const { flow } = setupFlow();
    flow.prepare("body", true);
    flow.prepare("source", true);

    flow.prepare("body", false);

    expect(flow.getState().preparing).toEqual({ body: false, source: true });
  });

  test("폼이 열려 있으면 이미지 받기를 막고, 폼을 닫으면 막은 기록도 함께 사라진다", () => {
    const { flow } = setupFlow();
    flow.openForm("body");

    expect(flow.blockedByForm("image")).toBe(true);
    expect(flow.getState().form?.blocked).toBe("image");

    flow.closeForm();

    expect(flow.getState().form).toBeNull();
    expect(flow.blockedByForm("image")).toBe(false);
  });

  test("폼을 적용하거나 취소해 닫으면 다시 저장할 수 있고 미저장 표시는 편집 영역이 알린 그대로다", () => {
    const { flow } = setupFlow({ body: true });
    const submit = vi.fn(async () => SAVED);
    flow.openForm("body");
    flow.editForm(true);
    flow.request(UPDATE, submit);

    flow.closeForm();

    expect(flow.getState().changed).toEqual({ body: true });
    expect(flow.request(UPDATE, submit)).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });

  test("저장 중에는 폼을 열지 않는다", () => {
    const { flow } = setupFlow({ body: true });
    flow.request(UPDATE, () => new Promise<SaveState>(() => {}));

    expect(flow.openForm("body")).toBe(false);
    expect(flow.getState().form).toBeNull();
  });

  test("저장이 실패해도 그 뒤에 연 폼의 상태와 모든 영역의 미저장 표시를 둔다", async () => {
    const { flow } = setupFlow({ metadata: true, body: true, images: true });
    flow.request(UPDATE, async () => ({ status: "error", message: "글을 연 뒤 다른 곳에서 글이 바뀌었어요." }));
    await flush();

    expect(flow.openForm("body")).toBe(true);
    flow.editForm(true);

    expect(flow.getState().changed).toEqual({ metadata: true, body: true, images: true });
    expect(flow.getState().form).toEqual({ area: "body", dirty: true, blocked: null });
  });
});
