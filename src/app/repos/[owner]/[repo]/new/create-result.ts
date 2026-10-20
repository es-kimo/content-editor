import type { CreatePostResult, SaveState } from "@/lib/content";

/** 새 글 만들기에는 바뀐 것이 없어 커밋하지 않는 결과가 없다. */
export type CreateState = Exclude<SaveState, { status: "unchanged" }>;

export const createError = (message: string, fields?: { [key: string]: string }): CreateState => ({
  status: "error",
  message,
  fields,
});

/**
 * 새 글 만들기 결과를 화면 상태로. 만들면 화면이 그 글의 편집 화면(`savedHref`)으로 간다.
 * 서버에서 이동하지 않고 화면에 맡겨, 화면이 만들기 성공에 따른 이동을 다른 이동과 구분하게 한다.
 */
export function createResultState(
  result: CreatePostResult,
  savedHref: (path: string, commit: string) => string,
): CreateState {
  if (result.ok) return { status: "saved", href: savedHref(result.path, result.commit) };
  switch (result.reason) {
    case "invalid":
      // 컬렉션은 화면이 bind한 값이라 입력 칸이 없다. config가 바뀐 경우라 목록에서 다시 고르게 한다.
      if (result.errors.some((e) => e.key === "collection")) {
        return createError("config에 없는 컬렉션이다. 글 목록에서 컬렉션을 다시 고른다.");
      }
      return createError("입력을 확인한다.", Object.fromEntries(result.errors.map((e) => [e.key, e.message])));
    case "exists":
      return createError("입력을 확인한다.", { title: "같은 이름의 글 폴더가 이미 있다. 제목을 바꿔 다시 만든다." });
    case "not-fast-forward":
      return createError("만드는 사이 다른 곳에서 레포가 바뀌었다. 다시 만든다.");
  }
}
