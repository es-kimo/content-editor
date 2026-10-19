import Link from "next/link";
import { Suspense } from "react";

import { CollectionTabs, isUnauthorized, LoginLink, loadRepoConfig, newPostHref, repoHref } from "@/app/_lib/repo";
import { pageAccessToken, type SearchParams } from "@/app/_lib/session";
import { assertRepoAllowed } from "@/app/_lib/site";
import { createGitHubClient, listSubmenus, needsSubmenu } from "@/lib/content";
import { compilePathPattern } from "@/lib/editor-config";

import { createPostAction } from "./actions";
import { NewPostForm } from "./new-post-form";

type Params = Promise<{ owner: string; repo: string }>;

export default function NewPostPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16 font-sans">
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <NewPostView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function NewPostView({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { owner, repo: name } = await params;
  const repo = `${owner}/${name}`;
  await assertRepoAllowed(repo);
  const selected = (await searchParams).collection;

  const accessToken = await pageAccessToken(
    searchParams,
    newPostHref(repo, typeof selected === "string" ? selected : undefined),
  );
  if (!accessToken) return <LoginLink />;
  const loaded = await loadRepoConfig(repo, accessToken);
  if (!loaded.ok) return loaded.view;
  const { config } = loaded;

  const collection = config.collections.find((c) => c.name === selected) ?? config.collections[0];
  let submenus: string[] | null = null;
  if (needsSubmenu(collection)) {
    try {
      submenus = await listSubmenus(createGitHubClient(accessToken, fetch), repo, config, collection);
    } catch (e) {
      if (isUnauthorized(e)) return <LoginLink />;
      throw e;
    }
  }

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={repoHref(repo, collection.name)} className="text-sm text-zinc-500 underline">
          {repo} · {collection.name}
        </Link>
        <h1 className="text-2xl font-semibold">새 글</h1>
        <p className="text-sm text-zinc-500">
          만들면 브랜치 {config.branch}에 바로 커밋하고 편집 화면으로 간다. 제목이 폴더 이름이 된다.
        </p>
      </header>
      <CollectionTabs config={config} current={collection} href={(c) => newPostHref(repo, c)} />
      {submenus?.length === 0 ? (
        <p className="text-amber-600">
          <code>{collection.path}</code>에 맞는 글이 없어 고를 하위 메뉴가 없다. 하위 메뉴 폴더는 레포에서 먼저 만든다.
        </p>
      ) : (
        <NewPostForm
          // 컬렉션을 바꾸면 입력과 결과를 새로 시작한다.
          key={collection.name}
          folder={compilePathPattern(collection.path).prefix}
          submenus={submenus}
          action={createPostAction.bind(null, repo, collection.name)}
        />
      )}
    </>
  );
}
