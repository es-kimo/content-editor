import { describe, expect, test } from "vitest";

import { readStatus } from "./status";
import { readTrash, withoutTrash, withTrash } from "./trash";

const NOW = new Date("2026-10-20T09:30:15.123Z");

describe("readTrash", () => {
  test("other.trashedAt이 있으면 휴지통 글이고 그 값이 삭제 시각이다", () => {
    expect(readTrash({ other: { status: "draft", trashedAt: "2026-10-20T09:30:15Z" } })).toEqual({
      trashed: true,
      trashedAt: "2026-10-20T09:30:15Z",
    });
  });

  test("other.trashedAt이 없으면 휴지통 글이 아니다", () => {
    expect(readTrash({ title: "제목", other: { status: "ready" } })).toEqual({ trashed: false });
    expect(readTrash({ title: "제목" })).toEqual({ trashed: false });
    expect(readTrash({ other: "ready" })).toEqual({ trashed: false });
  });

  test("삭제 시각이 문자열이 아니어도 휴지통 글로 보고 시각은 null이다", () => {
    expect(readTrash({ other: { trashedAt: null } })).toEqual({ trashed: true, trashedAt: null });
    expect(readTrash({ other: { trashedAt: 1 } })).toEqual({ trashed: true, trashedAt: null });
  });
});

describe("withTrash", () => {
  test("상태를 draft로 바꾸고 주입한 시각을 초 단위 Z 형식으로 맨 끝에 더한다", () => {
    const next = withTrash({ title: "제목", other: { createdAt: "2020-11-20T00:00:00Z", status: "ready" } }, NOW);

    expect(next).toEqual({
      title: "제목",
      other: { createdAt: "2020-11-20T00:00:00Z", status: "draft", trashedAt: "2026-10-20T09:30:15Z" },
    });
    expect(Object.keys(next!.other!)).toEqual(["createdAt", "status", "trashedAt"]);
  });

  test("원래 metadata는 바꾸지 않는다", () => {
    const metadata = { title: "제목", other: { status: "ready" } };
    withTrash(metadata, NOW);

    expect(metadata).toEqual({ title: "제목", other: { status: "ready" } });
  });

  test("other가 객체가 아니면 null", () => {
    expect(withTrash({ other: "ready" }, NOW)).toBeNull();
  });
});

describe("withoutTrash", () => {
  test("삭제 시각을 빼고 상태는 draft다", () => {
    const next = withoutTrash({ title: "제목", other: { status: "ready", trashedAt: "2026-10-20T09:30:15Z" } });

    expect(next).toEqual({ title: "제목", other: { status: "draft" } });
    expect(readStatus(next!)).toBe("draft");
  });

  test("옮긴 뒤 꺼내면 키 순서까지 원래대로 돌아온다", () => {
    const metadata = { title: "제목", other: { createdAt: "2020-11-20T00:00:00Z", status: "draft" } };

    const restored = withoutTrash(withTrash(metadata, NOW)!);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(metadata));
  });

  test("other가 객체가 아니면 null", () => {
    expect(withoutTrash({ other: ["draft"] })).toBeNull();
  });
});
