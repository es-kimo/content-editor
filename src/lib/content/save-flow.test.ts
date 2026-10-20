import { describe, expect, test, vi } from "vitest";

import { createGitHubClient } from "@/lib/github";
import { yjshdConfig } from "@/test/config";
import { fakeGitRepo } from "@/test/fake-git";

import { editorKeys, readPost, type Post } from "./read";
import { saveBody } from "./save-body";
import { createSaveFlow, discardedAreas, reopenedAreas, type SaveRequest, type SaveState } from "./save-flow";
import { saveMetadata } from "./save-metadata";
import { saveSource } from "./save-source";
import type { EditArea } from "./unsaved";

const REPO = "es-kimo/yjshd";
const POST = "content/4.게시판/1.휴진/page.mdx";
const config = yjshdConfig();
const syntax = config.syntax;

const SOURCE = `import image1 from "./1.png";

export const metadata = {
  title: '11월 휴진 안내',
  description: '안녕하세요.',
  keywords: [],
  other: { status: "ready", createdAt: "2020-11-20T00:00:00Z" },
};

# 11월 휴진 안내

본문 <Image src={image1} alt="" />
`;

const FORM = {
  title: "12월 휴진 안내",
  description: "안녕하세요.",
  "other.createdAt": "2020-11-20T00:00",
  "other.status": "ready",
};

const setup = () => {
  const repo = fakeGitRepo(REPO, "main", [
    { path: POST, content: SOURCE },
    { path: "README.md", content: "# yjshd\n" },
  ]);
  const client = createGitHubClient("ghu_token", repo.fetch);
  return { repo, client, read: async () => (await readPost(client, REPO, config, POST))! };
};

/** 글 화면(`post/page.tsx`)이 저장 뒤 다시 여는 영역. metadata·본문은 `editorKeys`, 원문은 sha가 key다. */
function actuallyReopened(before: Post, after: Post): EditArea[] {
  const [b, a] = [editorKeys(before), editorKeys(after)];
  return [
    ...(b.metadata !== a.metadata ? (["metadata"] as const) : []),
    ...(b.body !== a.body ? (["body", "images"] as const) : []),
    ...(before.sha !== after.sha ? (["source", "sourceImages"] as const) : []),
  ];
}

const sourceSave = (after: string): SaveRequest => ({ target: "source", before: SOURCE, after, syntax });

describe("reopenedAreas", () => {
  test("metadata를 저장하면 metadata와 원문만 다시 열리고 고치던 본문은 남는다", async () => {
    const { client, read } = setup();
    const before = await read();

    await saveMetadata(client, REPO, config, { path: POST, baseSha: before.sha, values: FORM });

    expect(actuallyReopened(before, await read())).toEqual(reopenedAreas({ target: "metadata" }));
    expect(reopenedAreas({ target: "metadata" })).not.toContain("body");
  });

  test("본문을 저장하면 본문·첨부와 원문만 다시 열리고 고치던 metadata 폼은 남는다", async () => {
    const { client, read } = setup();
    const before = await read();
    const body = `${before.doc.ok ? before.doc.body : ""}\n추가 문단\n`;

    await saveBody(client, REPO, config, { path: POST, baseSha: before.sha, body });

    expect(actuallyReopened(before, await read())).toEqual(reopenedAreas({ target: "body" }));
    expect(reopenedAreas({ target: "body" })).not.toContain("metadata");
  });

  test.each([
    [
      "metadata만 고친 원문",
      SOURCE.replace("11월 휴진 안내',", "12월 휴진 안내',"),
      ["metadata", "source", "sourceImages"],
    ],
    [
      "본문만 고친 원문",
      SOURCE.replace("본문 <Image", "고친 본문 <Image"),
      ["body", "images", "source", "sourceImages"],
    ],
    [
      "metadata와 본문을 함께 고친 원문",
      SOURCE.replace("11월 휴진 안내',", "12월 휴진 안내',").replace("본문 <Image", "고친 본문 <Image"),
      ["metadata", "body", "images", "source", "sourceImages"],
    ],
    ["import만 고친 원문", SOURCE.replace("./1.png", "./2.png"), ["source", "sourceImages"]],
  ])("%s을 저장하면 실제로 다시 열리는 영역을 미리 안다", async (_, edited, expected) => {
    const { client, read } = setup();
    const before = await read();

    await saveSource(client, REPO, config, { path: POST, baseSha: before.sha, source: edited });

    expect(reopenedAreas(sourceSave(edited))).toEqual(expected);
    expect(actuallyReopened(before, await read())).toEqual(expected);
  });
});

describe("discardedAreas", () => {
  const all = { metadata: true, body: true, images: true, source: true };

  test("metadata·본문 저장은 다른 영역 중 원문 입력만 버린다", () => {
    expect(discardedAreas({ target: "metadata" }, all)).toEqual(["source"]);
    expect(discardedAreas({ target: "body" }, all)).toEqual(["source"]);
  });

  test("원문 저장은 고친 원문이 바꾸는 영역의 입력만 버린다", () => {
    expect(discardedAreas(sourceSave(SOURCE.replace("11월 휴진 안내',", "12월 휴진 안내',")), all)).toEqual([
      "metadata",
    ]);
    expect(discardedAreas(sourceSave(SOURCE.replace("본문 <Image", "고친 본문 <Image")), all)).toEqual([
      "body",
      "images",
    ]);
  });

  test("일반 편집 첨부와 원문 편집 첨부는 각자의 저장으로만 저장하고, 다른 쪽 저장은 버리는지 묻거나 그대로 둔다", () => {
    const attached = { images: true, sourceImages: true };

    expect(discardedAreas({ target: "body" }, attached)).toEqual(["sourceImages"]);
    expect(discardedAreas({ target: "metadata" }, attached)).toEqual(["sourceImages"]);
    // 본문을 바꾸지 않는 원문 저장은 일반 편집을 다시 열지 않으므로 그 첨부는 미저장으로 남는다.
    expect(discardedAreas(sourceSave(SOURCE.replace("./1.png", "./2.png")), attached)).toEqual([]);
    expect(discardedAreas(sourceSave(SOURCE.replace("본문 <Image", "고친 본문 <Image")), attached)).toEqual(["images"]);
  });

  test("다시 열리는 영역에 미저장 입력이 없으면 버릴 것이 없다", () => {
    expect(discardedAreas({ target: "metadata" }, { metadata: true, body: true, images: true })).toEqual([]);
    expect(discardedAreas({ target: "new" }, { title: true, submenu: true })).toEqual([]);
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

const HREF = "/repos/es-kimo/yjshd/post?path=a&saved=c1";
const SAVED: SaveState = { status: "saved", href: HREF };

describe("createSaveFlow", () => {
  test("응답이 올 때까지 저장 중으로 두고 같은 저장도 다른 영역 저장도 다시 제출하지 않는다", async () => {
    const { flow } = setupFlow({ metadata: true, body: true });
    const pending = deferred();
    const submit = vi.fn(() => pending.promise);
    const other = vi.fn(() => pending.promise);

    expect(flow.request({ target: "metadata" }, submit)).toBe(true);
    expect(flow.request({ target: "metadata" }, submit)).toBe(false);
    expect(flow.request({ target: "body" }, other)).toBe(false);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(flow.getState().phase).toEqual({ kind: "saving", target: "metadata" });
    expect(flow.getState().changed).toEqual({ metadata: true, body: true });
  });

  test("성공하면 저장한 글 화면으로 한 번 가고, 그 화면이 열릴 때까지 다음 저장을 받지 않는다", async () => {
    const { flow, navigate } = setupFlow({ metadata: true, body: true });
    const pending = deferred();

    flow.request({ target: "metadata" }, () => pending.promise);
    pending.resolve(SAVED);
    await flush();

    expect(navigate).toHaveBeenCalledExactlyOnceWith(HREF);
    expect(flow.getState().phase).toMatchObject({
      kind: "saved",
      target: "metadata",
      reopened: ["metadata", "source", "sourceImages"],
    });
    expect(flow.request({ target: "body" }, () => pending.promise)).toBe(false);

    flow.settle();
    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().changed.body).toBe(true);
  });

  test("저장한 글 화면이 열리면 다시 열린 영역의 결과만 지우고 남은 영역의 결과는 둔다", async () => {
    const { flow } = setupFlow();
    flow.request({ target: "body" }, async () => ({ status: "error", message: "본문 오류" }));
    await flush();

    flow.request({ target: "metadata" }, async () => SAVED);
    await flush();
    flow.settle();

    expect(flow.getState().results.metadata).toBeUndefined();
    expect(flow.getState().results.body).toEqual({ status: "error", message: "본문 오류" });
  });

  test("변경 없음이면 제출한 영역의 기준만 갱신하고 다른 영역의 미저장 표시는 그대로다", async () => {
    const { flow, navigate } = setupFlow({ metadata: true, body: true });
    const onUnchanged = vi.fn();

    flow.request({ target: "body" }, async () => ({ status: "unchanged" }), onUnchanged);
    await flush();

    expect(onUnchanged).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().changed).toEqual({ metadata: true, body: true });
    expect(flow.getState().results.body).toEqual({ status: "unchanged" });
  });

  test.each<[string, SaveState]>([
    ["입력 오류", { status: "error", message: "입력한 값을 확인해 주세요.", fields: { title: "값을 입력해 주세요." } }],
    ["컴파일 오류", { status: "error", message: "원문 편집에서 고쳐 주세요.", detail: "3행: Unexpected token" }],
    ["충돌", { status: "error", message: "글을 연 뒤 다른 곳에서 글이 바뀌었어요." }],
  ])("%s로 실패하면 결과를 보이고 미저장 표시를 둔 채 다시 저장할 수 있다", async (_, result) => {
    const { flow, navigate } = setupFlow({ source: true });

    flow.request({ target: "source", before: SOURCE, after: SOURCE, syntax }, async () => result);
    await flush();

    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().results.source).toEqual(result);
    expect(flow.getState().changed).toEqual({ source: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(flow.request({ target: "source", before: SOURCE, after: SOURCE, syntax }, async () => SAVED)).toBe(true);
  });

  test("새 글 만들기 요청 자체가 실패해도 제목·하위 메뉴 표시를 둔 채 오류를 보이고 다시 만들 수 있다", async () => {
    const { flow } = setupFlow({ title: true, submenu: true });
    const pending = deferred();

    flow.request({ target: "new" }, () => pending.promise);
    pending.reject(new TypeError("Failed to fetch"));
    await flush();

    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().results.new?.status).toBe("error");
    expect(flow.getState().changed).toEqual({ title: true, submenu: true });
  });

  test("저장으로 사라질 다른 영역 입력이 있으면 제출하기 전에 그 영역을 알린다", () => {
    const { flow } = setupFlow({ metadata: true, source: true });
    const submit = vi.fn(async () => SAVED);

    flow.request({ target: "metadata" }, submit);

    expect(submit).not.toHaveBeenCalled();
    expect(flow.getState().phase).toEqual({ kind: "confirming", target: "metadata", discarded: ["source"] });
    expect(flow.request({ target: "body" }, submit)).toBe(false);
  });

  test("계속 편집을 고르면 제출하지 않아 커밋이 생기지 않고 입력 표시도 그대로다", async () => {
    const { repo, client, read } = setup();
    const post = await read();
    const { flow, navigate } = setupFlow({ metadata: true, source: true });

    flow.request({ target: "metadata" }, async () => {
      await saveMetadata(client, REPO, config, { path: POST, baseSha: post.sha, values: FORM });
      return SAVED;
    });
    flow.cancel();
    await flush();

    expect(repo.log()).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().changed).toEqual({ metadata: true, source: true });
  });

  test("버리기에 동의해도 저장이 실패하면 아무 영역도 다시 열지 않고 모든 미저장 표시를 둔다", async () => {
    const { flow, navigate } = setupFlow({ metadata: true, body: true, images: true, source: true });

    flow.request({ target: "metadata" }, async () => ({
      status: "error",
      message: "글을 연 뒤 다른 곳에서 글이 바뀌었어요.",
    }));
    flow.confirm();
    await flush();

    expect(navigate).not.toHaveBeenCalled();
    expect(flow.getState().phase).toEqual({ kind: "idle" });
    expect(flow.getState().changed).toEqual({ metadata: true, body: true, images: true, source: true });
  });

  test("버리기에 동의하고 저장이 성공하면 그때 저장한 글 화면으로 가 동의한 영역을 다시 연다", async () => {
    const { repo, client, read } = setup();
    const post = await read();
    const { flow, navigate } = setupFlow({ metadata: true, source: true });

    flow.request({ target: "metadata" }, async () => {
      const result = await saveMetadata(client, REPO, config, { path: POST, baseSha: post.sha, values: FORM });
      return result.ok ? SAVED : { status: "error", message: "실패" };
    });
    flow.confirm();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());

    expect(repo.log()).toHaveLength(2);
    expect(flow.getState().phase).toMatchObject({ kind: "saved", reopened: ["metadata", "source", "sourceImages"] });
  });
});

describe("적용하지 않은 폼", () => {
  test.each<SaveRequest>([{ target: "metadata" }, { target: "body" }, sourceSave(SOURCE), { target: "new" }])(
    "폼이 열려 있으면 $target 저장을 제출하지 않고 막은 저장을 알린다",
    (request) => {
      const { flow } = setupFlow({ metadata: true, body: true, source: true });
      const submit = vi.fn(async () => SAVED);
      flow.openForm("body");

      expect(flow.request(request, submit)).toBe(false);

      expect(submit).not.toHaveBeenCalled();
      expect(flow.getState().phase).toEqual({ kind: "idle" });
      expect(flow.getState().form?.blocked).toBe(request.target);
    },
  );

  test("폼이 열려 있으면 모드 전환을 막고, 폼이 없으면 막지 않는다", () => {
    const { flow } = setupFlow();
    expect(flow.blockedByForm("mode")).toBe(false);

    flow.openForm("source");

    expect(flow.blockedByForm("mode")).toBe(true);
    expect(flow.getState().form?.blocked).toBe("mode");
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

  test("폼을 적용하거나 취소해 닫으면 다시 저장할 수 있고 미저장 표시는 편집 영역이 알린 그대로다", async () => {
    const { flow } = setupFlow({ body: true });
    const submit = vi.fn(async () => SAVED);
    flow.openForm("body");
    flow.editForm(true);
    flow.request({ target: "body" }, submit);

    flow.closeForm();

    expect(flow.getState().changed).toEqual({ body: true });
    expect(flow.request({ target: "body" }, submit)).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });

  test("저장 중이거나 버릴지 묻는 중에는 폼을 열지 않는다", () => {
    const saving = setupFlow({ body: true }).flow;
    saving.request({ target: "body" }, () => new Promise<SaveState>(() => {}));
    expect(saving.openForm("body")).toBe(false);

    const confirming = setupFlow({ metadata: true, source: true }).flow;
    confirming.request({ target: "metadata" }, async () => SAVED);
    expect(confirming.openForm("source")).toBe(false);
    expect(confirming.getState().form).toBeNull();
  });

  test("저장이 실패해도 그 뒤에 연 폼의 상태와 모든 영역의 미저장 표시를 둔다", async () => {
    const { flow } = setupFlow({ metadata: true, body: true, images: true });
    flow.request({ target: "metadata" }, async () => ({
      status: "error",
      message: "글을 연 뒤 다른 곳에서 글이 바뀌었어요.",
    }));
    await flush();

    expect(flow.openForm("body")).toBe(true);
    flow.editForm(true);

    expect(flow.getState().changed).toEqual({ metadata: true, body: true, images: true });
    expect(flow.getState().form).toEqual({ area: "body", dirty: true, blocked: null });
  });
});
