"use server";

import { redirect } from "next/navigation";

import { runRepoAction } from "@/app/_lib/action";
import { postHref } from "@/app/_lib/repo";
import { createPost } from "@/lib/content";

export type CreateState = { status: "idle" } | { status: "error"; message: string; fields?: { [key: string]: string } };

const error = (message: string, fields?: { [key: string]: string }): CreateState => ({
  status: "error",
  message,
  fields,
});

/** 새 글 만들기. 만들면 그 글의 편집 화면으로 간다. 컬렉션은 서버 컴포넌트에서 bind한다. */
export async function createPostAction(
  repo: string,
  collection: string,
  _prev: CreateState,
  data: FormData,
): Promise<CreateState> {
  const title = data.get("title");
  const submenu = data.get("submenu");
  if (typeof title !== "string") return error("제목을 읽을 수 없다. 새로고침한 뒤 다시 만든다.");

  const outcome = await runRepoAction(repo, ({ client, config }) =>
    createPost(
      client,
      repo,
      config,
      { collection, title, submenu: typeof submenu === "string" ? submenu : undefined },
      new Date(),
    ),
  );
  if (!outcome.ok) return error(outcome.message);
  const result = outcome.value;

  if (result.ok) redirect(`${postHref(repo, result.path)}&${new URLSearchParams({ saved: result.commit })}`);
  switch (result.reason) {
    case "invalid":
      // 컬렉션은 화면이 bind한 값이라 입력 칸이 없다. config가 바뀐 경우라 목록에서 다시 고르게 한다.
      if (result.errors.some((e) => e.key === "collection")) {
        return error("config에 없는 컬렉션이다. 글 목록에서 컬렉션을 다시 고른다.");
      }
      return error("입력을 확인한다.", Object.fromEntries(result.errors.map((e) => [e.key, e.message])));
    case "exists":
      return error("입력을 확인한다.", { title: "같은 이름의 글 폴더가 이미 있다. 제목을 바꿔 다시 만든다." });
    case "not-fast-forward":
      return error("만드는 사이 다른 곳에서 레포가 바뀌었다. 다시 만든다.");
  }
}
