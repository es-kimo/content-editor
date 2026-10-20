import { describe, expect, test } from "vitest";

import { testConfig, yjshdConfig } from "@/test/config";

import { actionStatus, readStatus, statusSupport, withStatus, type PostAction } from "./status";

const [board] = yjshdConfig().collections;

const collection = (metadata: Parameters<typeof testConfig>[0][number]["metadata"]) =>
  testConfig([{ name: "글", path: "content/{slug}/page.mdx", metadata }]).collections[0]!;

describe("statusSupport", () => {
  test("other.status가 draft와 ready를 모두 가진 select면 다룰 수 있다", () => {
    expect(statusSupport(board!)).toEqual({ ok: true });
    expect(
      statusSupport(collection({ "other.status": { type: "select", options: ["hidden", "draft", "ready"] } })).ok,
    ).toBe(true);
  });

  test("other.status가 없거나 select가 아니면 status-field", () => {
    expect(statusSupport(collection({ title: { type: "string" } }))).toEqual({ ok: false, reason: "status-field" });
    expect(statusSupport(collection({ "other.status": { type: "string" } }))).toEqual({
      ok: false,
      reason: "status-field",
    });
  });

  test("선택지에 draft나 ready가 빠지면 status-options", () => {
    expect(statusSupport(collection({ "other.status": { type: "select", options: ["ready", "hidden"] } }))).toEqual({
      ok: false,
      reason: "status-options",
    });
    expect(statusSupport(collection({ "other.status": { type: "select", options: ["draft"] } }))).toEqual({
      ok: false,
      reason: "status-options",
    });
  });
});

describe("readStatus", () => {
  test("draft와 ready를 읽는다", () => {
    expect(readStatus({ other: { status: "draft" } })).toBe("draft");
    expect(readStatus({ other: { status: "ready" } })).toBe("ready");
  });

  test("상태가 없거나 그 밖의 값이면 게시 대상으로 넘겨짚지 않고 null", () => {
    expect(readStatus({ title: "제목" })).toBeNull();
    expect(readStatus({ other: { status: "hidden" } })).toBeNull();
    expect(readStatus({ other: { status: ["ready"] } })).toBeNull();
    expect(readStatus({ other: "ready" })).toBeNull();
  });
});

describe("actionStatus", () => {
  test.each<[PostAction, "draft" | "ready", "draft" | "ready"]>([
    ["save-draft", "draft", "draft"],
    ["publish", "draft", "ready"],
    ["update", "ready", "ready"],
    ["unpublish", "ready", "draft"],
  ])("%s는 %s 글에 할 수 있고 %s로 저장한다", (action, current, saved) => {
    expect(actionStatus(board!, current, action)).toEqual({ ok: true, status: saved });
  });

  test.each<[PostAction, "draft" | "ready"]>([
    ["save-draft", "ready"],
    ["publish", "ready"],
    ["update", "draft"],
    ["unpublish", "draft"],
  ])("%s는 %s 글에 할 수 없다", (action, current) => {
    expect(actionStatus(board!, current, action)).toEqual({ ok: false, reason: "action" });
  });

  test("상태를 알 수 없는 글은 어떤 행동도 status-value로 거절한다", () => {
    for (const action of ["save-draft", "publish", "update", "unpublish"] as const) {
      expect(actionStatus(board!, null, action)).toEqual({ ok: false, reason: "status-value" });
    }
  });

  test("설정이 상태를 다룰 수 없으면 글의 상태보다 설정 문제를 먼저 알린다", () => {
    const noStatus = collection({ title: { type: "string" } });
    expect(actionStatus(noStatus, null, "publish")).toEqual({ ok: false, reason: "status-field" });
  });
});

describe("withStatus", () => {
  test("상태만 바꾸고 다른 키와 키 순서는 그대로 둔다", () => {
    const metadata = { title: "제목", other: { status: "ready", createdAt: "2020-11-20T00:00:00Z" } };

    const next = withStatus(metadata, "draft");

    expect(next).toEqual({ title: "제목", other: { status: "draft", createdAt: "2020-11-20T00:00:00Z" } });
    expect(Object.keys(next.other as object)).toEqual(["status", "createdAt"]);
    expect(metadata.other.status).toBe("ready");
  });

  test("상태 키가 없으면 더한다", () => {
    expect(withStatus({ title: "제목" }, "draft")).toEqual({ title: "제목", other: { status: "draft" } });
  });
});
