"use server";

import { runRepoAction } from "@/app/_lib/action";
import { postHref } from "@/app/_lib/repo";
import { createPost, newPostFromSource, readNewPostForm, type NewPostAction, type NewPostSubmenu } from "@/lib/content";

import type { PostSaveInput } from "../post/actions";
import { readImages } from "../post/form-images";
import { createError, createResultState, sourceProblemState, type CreateState } from "./create-result";

/** 새 글 저장에서 FormData 밖으로 받는 값. 글 저장 입력에 고른 하위 메뉴를 더한다. 행동은 임시저장·게시만 받는다. */
export type NewPostSaveInput = PostSaveInput & { submenu?: NewPostSubmenu };

const isNewPostAction = (action: unknown): action is NewPostAction => action === "save-draft" || action === "publish";

const isSubmenu = (value: unknown): value is NewPostSubmenu =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  (value.kind === "existing" || value.kind === "new") &&
  "name" in value &&
  typeof value.name === "string";

/**
 * 새 글을 행동(임시저장·게시)에 따라 제목·설정·본문·첨부와 새 하위 메뉴까지 커밋 하나로 처음 저장한다.
 * 일반 편집은 설정 폼 값(`data`)과 본문을, 원문 편집은 원문을 받는다. 컬렉션은 서버 컴포넌트에서 bind한다.
 * 저장하면 그 글의 글 화면 주소를 돌려준다.
 */
export async function createPostAction(
  repo: string,
  collection: string,
  input: NewPostSaveInput,
  data: FormData,
): Promise<CreateState> {
  const action = input?.action;
  if (
    !isNewPostAction(action) ||
    (input.mode !== "wysiwyg" && input.mode !== "source") ||
    typeof input.text !== "string" ||
    (input.submenu !== undefined && !isSubmenu(input.submenu)) ||
    !(data instanceof FormData)
  ) {
    return createError("입력을 읽지 못했어요. 입력한 내용을 따로 보관한 뒤 새로고침해 다시 저장해 주세요.");
  }

  const outcome = await runRepoAction(repo, async ({ client, config }) => {
    const found = config.collections.find((c) => c.name === collection);
    const images = await readImages(data);
    const now = new Date();
    let content = { values: found ? readNewPostForm(found, data) : {}, body: input.text, images };
    if (found && input.mode === "source") {
      const converted = newPostFromSource(found, config.syntax, { source: input.text, images }, now);
      if (!converted.ok) return sourceProblemState(converted);
      content = converted.input;
    }
    const result = await createPost(
      client,
      repo,
      config,
      { collection, action, ...content, submenu: input.submenu },
      now,
    );
    return createResultState(result, action, (path) => postHref(repo, path));
  });
  if (!outcome.ok) return createError(outcome.message, { detail: outcome.detail });
  return outcome.value;
}
