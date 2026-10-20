/** 글의 게시 상태를 담는 필드의 키. 글 목록의 상태 칸도 이 값을 읽는다. */
export const STATUS_FIELD = "other.status";

/** config에 라벨이 없을 때 쓰는 알려진 필드의 이름. */
const KNOWN_LABELS: { [key: string]: string } = {
  title: "제목",
  description: "요약",
  keywords: "검색어",
  "other.createdAt": "작성일",
  [STATUS_FIELD]: "상태",
};

/** 상태 값의 화면 이름. 저장하는 값은 그대로다. ‘게시 대상’은 사이트에 반영됐다는 뜻이 아니다. */
const STATUS_LABELS: { [value: string]: string } = {
  ready: "게시 대상",
  draft: "초안",
};

/** 필드의 화면 이름. config의 라벨을 우선하고, 없으면 알려진 이름, 그것도 없으면 키를 그대로 보인다. */
export function fieldLabel(key: string, label?: string): string {
  return label ?? (Object.hasOwn(KNOWN_LABELS, key) ? KNOWN_LABELS[key]! : key);
}

/** 선택지 값의 화면 이름. 상태 필드의 알려진 값만 이름을 바꾸고, 그 밖의 값은 그대로 보인다. */
export function optionLabel(key: string, value: string): string {
  if (key !== STATUS_FIELD || !Object.hasOwn(STATUS_LABELS, value)) return value;
  return STATUS_LABELS[value]!;
}
