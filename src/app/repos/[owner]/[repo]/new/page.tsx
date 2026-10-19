import Link from "next/link";

import { CollectionTabs, newPostHref, openRepoPage, repoHref } from "@/app/_lib/repo";
import type { SearchParams } from "@/app/_lib/session";
import { PageShell } from "@/app/_lib/ui";
import { listSubmenus, needsSubmenu } from "@/lib/content";

import { createPostAction } from "./actions";
import { NewPostForm } from "./new-post-form";

type Params = Promise<{ owner: string; repo: string }>;

export default function NewPostPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <PageShell>
      <NewPostView params={params} searchParams={searchParams} />
    </PageShell>
  );
}

async function NewPostView({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { owner, repo: name } = await params;
  const repo = `${owner}/${name}`;
  const selected = (await searchParams).collection;

  const page = await openRepoPage(
    repo,
    searchParams,
    newPostHref(repo, typeof selected === "string" ? selected : undefined),
    async ({ client, config }) => {
      const collection = config.collections.find((c) => c.name === selected) ?? config.collections[0];
      const submenus = needsSubmenu(collection) ? await listSubmenus(client, repo, config, collection) : null;
      return { collection, submenus };
    },
  );
  if (!page.ok) return page.view;
  const { config } = page;
  const { collection, submenus } = page.value;

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
          collection={collection}
          submenus={submenus}
          action={createPostAction.bind(null, repo, collection.name)}
        />
      )}
    </>
  );
}
