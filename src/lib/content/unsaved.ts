// 편집 화면이 입력할 때마다 브라우저에서 부른다. GitHub 클라이언트를 import하지 않는다.

/** 저장하지 않은 변경을 따로 판정하는 편집 영역. */
export type EditArea = "metadata" | "body" | "images" | "source" | "submenu" | "title";

/** 화면에 보일 영역 이름. 화면 위에서 아래 순서다. 글 화면 위의 제목 입력도 글 설정으로 저장하므로 `metadata`에 든다. */
const AREA_NAMES: { [area in EditArea]: string } = {
  metadata: "글 설정",
  body: "본문",
  images: "첨부 이미지",
  source: "원문",
  submenu: "하위 메뉴",
  title: "제목",
};

/** 영역별 변경 여부를 모아 바뀐 영역 이름을 화면 순서로 돌려준다. 바뀐 영역이 없으면 빈 배열. */
export function unsavedAreas(changed: { [area in EditArea]?: boolean }): string[] {
  return areaNames((Object.keys(changed) as EditArea[]).filter((area) => changed[area]));
}

/** 영역들의 화면 이름을 화면 순서로. */
export function areaNames(areas: EditArea[]): string[] {
  return (Object.keys(AREA_NAMES) as EditArea[]).filter((area) => areas.includes(area)).map((area) => AREA_NAMES[area]);
}

/** 원문 모드에 저장하지 않은 변경이 있는지. import·metadata를 포함한 파일 전체 문자열로 비교한다. */
export function sourceChanged(initial: string, current: string): boolean {
  return current !== initial;
}

export type NewPostInput = { title: string; submenu: string };

/** 새 글 입력 중 처음 표시한 값에서 바뀐 영역. 필수값을 비운 중간 입력도 처음 값과 다르면 바뀐 것이다. */
export function newPostChanges(
  initial: NewPostInput,
  current: NewPostInput,
): { [area in "title" | "submenu"]: boolean } {
  return { title: current.title !== initial.title, submenu: current.submenu !== initial.submenu };
}
