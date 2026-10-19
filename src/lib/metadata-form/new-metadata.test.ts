import { describe, expect, test } from "vitest";

import { yjshdConfig } from "@/test/config";

import { buildForm } from "./form";
import { newMetadata } from "./new-metadata";

const [board, lecture] = yjshdConfig().collections;
const NOW = new Date("2026-10-19T03:04:05.678Z");

describe("newMetadata", () => {
  test("제목을 맨 앞에 두고 config 필드를 순서대로 채운다", () => {
    const metadata = newMetadata(board!, "11월 휴진 안내", NOW);

    expect(metadata.title).toBe("11월 휴진 안내");
    expect(Object.keys(metadata)).toEqual(["title", "description", "keywords", "other"]);
  });

  test("status는 첫 선택지, createdAt은 지금 시각을 초 단위 UTC로 채운다", () => {
    const metadata = newMetadata(board!, "11월 휴진 안내", NOW);

    expect(metadata.other).toEqual({ createdAt: "2026-10-19T03:04:05Z", status: "ready" });
  });

  test("문자열은 빈 문자열, 목록은 빈 배열로 둔다", () => {
    const metadata = newMetadata(board!, "11월 휴진 안내", NOW);

    expect(metadata.description).toBe("");
    expect(metadata.keywords).toEqual([]);
  });

  test("만든 metadata는 폼에서 잠기는 필드 없이 열린다", () => {
    for (const collection of [board!, lecture!]) {
      const form = buildForm(collection, newMetadata(collection, "새 글", NOW));
      expect(form.filter((field) => field.locked !== null)).toEqual([]);
    }
  });
});
