import { describe, expect, test } from "vitest";

import { yjshdConfig } from "@/test/config";

import { checkSubmenuName, newPostPath, postSlug } from "./slug";

describe("postSlug", () => {
  test("기존 글처럼 제목을 그대로 폴더 이름으로 쓴다", () => {
    expect(postSlug("2026년 1월 휴진 안내")).toBe("2026년 1월 휴진 안내");
    expect(postSlug("만성콩팥병 (투석 환자) 코로나19 예방접종")).toBe("만성콩팥병 (투석 환자) 코로나19 예방접종");
  });

  test("경로·URL에 쓸 수 없는 문자는 _로 바꾼다", () => {
    expect(postSlug("콩팥이 하는 일이 무엇인가요?")).toBe("콩팥이 하는 일이 무엇인가요_");
    expect(postSlug('9/10월 휴진: "임시" #1 100%')).toBe("9_10월 휴진_ _임시_ _1 100_");
  });

  test("공백을 하나로 줄이고 앞뒤 공백과 점을 뗀다", () => {
    expect(postSlug("  ..휴진\t\n안내...  ")).toBe("휴진 안내");
  });

  test("한글 자모가 분리된 입력(NFD)도 합쳐진 형태로 쓴다", () => {
    expect(postSlug("휴진 안내".normalize("NFD"))).toBe("휴진 안내".normalize("NFC"));
  });

  test("경로 한 단계 한도를 넘는 긴 제목은 200바이트 안으로 자른다", () => {
    const slug = postSlug("가".repeat(100))!;
    expect(new TextEncoder().encode(slug).length).toBeLessThanOrEqual(200);
    expect(slug).toBe("가".repeat(66));
  });

  test("쓸 수 있는 글자가 없으면 null", () => {
    expect(postSlug(" . ")).toBeNull();
    expect(postSlug("???")).toBeNull();
  });
});

describe("checkSubmenuName", () => {
  const EXISTING = ["2.콩팥질환 정보", "3.혈액투석 1,2,3"];

  test("새 이름은 앞뒤 공백만 떼고 그대로 쓴다", () => {
    expect(checkSubmenuName("AI", EXISTING)).toEqual({ ok: true, name: "AI" });
    expect(checkSubmenuName("  4.AI 활용 (기초)  ", EXISTING)).toEqual({ ok: true, name: "4.AI 활용 (기초)" });
  });

  test("한글 자모가 분리된 입력(NFD)은 합쳐진 형태로 쓴다", () => {
    expect(checkSubmenuName("투석 식단".normalize("NFD"), EXISTING)).toEqual({
      ok: true,
      name: "투석 식단".normalize("NFC"),
    });
  });

  test("앞뒤 공백이나 유니코드 정규화만 다른 기존 메뉴는 그 메뉴를 고르게 한다", () => {
    for (const input of ["2.콩팥질환 정보", " 2.콩팥질환 정보\t", "2.콩팥질환 정보".normalize("NFD")]) {
      expect(checkSubmenuName(input, EXISTING)).toMatchObject({
        ok: false,
        problem: "duplicate",
        existing: "2.콩팥질환 정보",
      });
    }
  });

  test("기존 메뉴 이름이 NFD여도 같은 이름으로 본다", () => {
    expect(checkSubmenuName("AI 상담", ["AI 상담".normalize("NFD")])).toMatchObject({ problem: "duplicate" });
  });

  test.each([
    ["", "empty"],
    ["   ", "empty"],
    [".", "dot"],
    ["..", "dot"],
    [".AI", "dot"],
    ["AI.", "dot"],
    ["a/b", "unsafe"],
    ["a\\b", "unsafe"],
    ["AI\n기초", "unsafe"],
    ["AI\u0000", "unsafe"],
    ["AI?", "unsafe"],
    ["100%", "unsafe"],
    ["가".repeat(67), "too-long"],
  ] as const)("쓸 수 없는 이름은 고치지 않고 오류로 돌려준다: %j", (input, problem) => {
    expect(checkSubmenuName(input, EXISTING)).toMatchObject({ ok: false, problem });
  });

  test("한도는 글 폴더 이름과 같은 200바이트다", () => {
    expect(checkSubmenuName("가".repeat(66), EXISTING)).toMatchObject({ ok: true });
    expect(checkSubmenuName("a".repeat(200), EXISTING)).toMatchObject({ ok: true });
    expect(checkSubmenuName("a".repeat(201), EXISTING)).toMatchObject({ ok: false, problem: "too-long" });
  });
});

describe("newPostPath", () => {
  const [board, lecture] = yjshdConfig().collections;

  test("컬렉션 경로 패턴에 글 폴더 이름과 하위 메뉴를 넣어 파일 경로를 만든다", () => {
    expect(newPostPath(board!, "11월 휴진 안내")).toBe("content/4.게시판/11월 휴진 안내/page.mdx");
    expect(newPostPath(lecture!, "불면증", "2.콩팥질환 정보")).toBe("content/3.강좌/2.콩팥질환 정보/불면증/page.mdx");
  });

  test("하위 메뉴와 글 폴더 사이에 고정 단계가 있어도 패턴대로 넣는다", () => {
    const collection = { ...board!, path: "content/{submenu}/posts/{slug}/index.mdx" };

    expect(newPostPath(collection, "제목", "공지")).toBe("content/공지/posts/제목/index.mdx");
  });
});
