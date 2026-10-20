"use server";

import { runRepoAction } from "@/app/_lib/action";
import { postHref } from "@/app/_lib/repo";
import { createPost } from "@/lib/content";
import { TITLE_FIELD } from "@/lib/metadata-form";

import { createError, createResultState, type CreateState } from "./create-result";

/**
 * 새 글을 제목만 있는 초안으로 저장한다. 저장하면 그 글의 편집 화면 주소를 돌려준다. 컬렉션은 서버 컴포넌트에서 bind한다.
 * 이 화면은 아직 제목과 기존 하위 메뉴만 입력받는다. 본문·설정은 편집 화면에서 쓴다.
 */
export async function createPostAction(repo: string, collection: string, data: FormData): Promise<CreateState> {
  const title = data.get("title");
  const submenu = data.get("submenu");
  if (typeof title !== "string") return createError("제목을 읽지 못했어요. 새로고침한 뒤 다시 만들어 주세요.");

  const outcome = await runRepoAction(repo, ({ client, config }) =>
    createPost(
      client,
      repo,
      config,
      {
        collection,
        action: "save-draft",
        values: { [TITLE_FIELD]: title },
        body: "",
        submenu: typeof submenu === "string" ? { kind: "existing", name: submenu } : undefined,
      },
      new Date(),
    ),
  );
  if (!outcome.ok) return createError(outcome.message, { detail: outcome.detail });
  return createResultState(
    outcome.value,
    (path, commit) => `${postHref(repo, path)}&${new URLSearchParams({ saved: commit })}`,
  );
}
