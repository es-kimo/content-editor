"use server";

import { runRepoAction } from "@/app/_lib/action";
import { postHref } from "@/app/_lib/repo";
import { createPost } from "@/lib/content";

import { createError, createResultState, type CreateState } from "./create-result";

/** 새 글 만들기. 만들면 그 글의 편집 화면 주소를 돌려준다. 컬렉션은 서버 컴포넌트에서 bind한다. */
export async function createPostAction(repo: string, collection: string, data: FormData): Promise<CreateState> {
  const title = data.get("title");
  const submenu = data.get("submenu");
  if (typeof title !== "string") return createError("제목을 읽을 수 없다. 새로고침한 뒤 다시 만든다.");

  const outcome = await runRepoAction(repo, ({ client, config }) =>
    createPost(
      client,
      repo,
      config,
      { collection, title, submenu: typeof submenu === "string" ? submenu : undefined },
      new Date(),
    ),
  );
  if (!outcome.ok) return createError(outcome.message);
  return createResultState(
    outcome.value,
    (path, commit) => `${postHref(repo, path)}&${new URLSearchParams({ saved: commit })}`,
  );
}
