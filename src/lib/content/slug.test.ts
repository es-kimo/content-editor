import { describe, expect, test } from "vitest";

import { yjshdConfig } from "@/test/config";

import { newPostPath, postSlug } from "./slug";

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
