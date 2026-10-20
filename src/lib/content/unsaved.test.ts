import { describe, expect, test } from "vitest";

import { areaNames, newPostChanges, sourceChanged, unsavedAreas } from "./unsaved";

describe("unsavedAreas", () => {
  test("바뀐 영역 이름만 화면 순서로 모은다", () => {
    expect(unsavedAreas({ source: true, metadata: true, body: false })).toEqual(["metadata", "원문"]);
    expect(unsavedAreas({ title: true, submenu: true })).toEqual(["하위 메뉴", "제목"]);
  });

  test("바뀐 영역이 없으면 빈 배열이다", () => {
    expect(unsavedAreas({})).toEqual([]);
    expect(unsavedAreas({ metadata: false, body: false, source: false })).toEqual([]);
  });
});

describe("areaNames", () => {
  test("받은 순서와 상관없이 영역 이름을 화면 순서로 돌려준다", () => {
    expect(areaNames(["source", "images", "metadata"])).toEqual(["metadata", "첨부 이미지", "원문"]);
  });
});

describe("sourceChanged", () => {
  const source = 'import a from "./1.png";\n\nexport const metadata = { title: "t" };\n\n본문\n';

  test("처음 원문 그대로면 변경이 아니다", () => {
    expect(sourceChanged(source, source)).toBe(false);
  });

  test("본문 밖의 import·metadata나 끝 줄바꿈만 바꿔도 변경이다", () => {
    expect(sourceChanged(source, source.replace("./1.png", "./2.png"))).toBe(true);
    expect(sourceChanged(source, source.replace('"t"', '"u"'))).toBe(true);
    expect(sourceChanged(source, source.trimEnd())).toBe(true);
  });

  test("고쳤다가 처음 원문으로 되돌리면 변경이 사라진다", () => {
    const edited = source.replace("본문", "고친 본문");
    expect(sourceChanged(source, edited.replace("고친 본문", "본문"))).toBe(false);
  });
});

describe("newPostChanges", () => {
  const initial = { title: "", submenu: "" };

  test("처음 표시한 빈 입력 그대로면 바뀐 영역이 없다", () => {
    expect(newPostChanges(initial, initial)).toEqual({ title: false, submenu: false });
  });

  test("제목이나 하위 메뉴를 입력하면 그 영역이 바뀐 것이다", () => {
    expect(newPostChanges(initial, { title: "새 글", submenu: "" })).toEqual({ title: true, submenu: false });
    expect(newPostChanges(initial, { title: "", submenu: "공지" })).toEqual({ title: false, submenu: true });
  });

  test("필수 제목이 공백뿐인 중간 입력도 바뀐 것이고, 처음 값으로 지우면 해제된다", () => {
    expect(newPostChanges(initial, { title: " ", submenu: "" }).title).toBe(true);
    expect(newPostChanges(initial, { title: "", submenu: "" }).title).toBe(false);
  });
});
