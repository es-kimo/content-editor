import Link from "next/link";

import { CollectionTabs, openRepoPage, postHref, repoHref, trashHref } from "@/app/_lib/repo";
import type { SearchParams } from "@/app/_lib/session";
import { PageShell, TechDetails } from "@/app/_lib/ui";
import { listTitle, listTrash, timed, trashedAtText } from "@/lib/content";

import { restorePostAction } from "../post/actions";
import { RestoreButton } from "../post/restore-button";

type Params = Promise<{ owner: string; repo: string }>;

export default function TrashPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <PageShell>
      <TrashList params={params} searchParams={searchParams} />
    </PageShell>
  );
}

/** 글 분류 하나의 휴지통. 최근에 지운 글이 위에 오고, 글마다 초안으로 복구할 수 있다. */
async function TrashList({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { owner, repo: name } = await params;
  const repo = `${owner}/${name}`;
  const selected = (await searchParams).collection;

  const page = await openRepoPage(
    repo,
    searchParams,
    trashHref(repo, typeof selected === "string" ? selected : undefined),
    async ({ client, config }) => {
      const collection = config.collections.find((c) => c.name === selected) ?? config.collections[0];
      const { value: posts, ms: elapsed } = await timed(() => listTrash(client, repo, config, collection));
      return { collection, posts, elapsed, calls: client.calls };
    },
  );
  if (!page.ok) return page.view;
  const { config } = page;
  const { collection, posts, elapsed, calls } = page.value;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={repoHref(repo, collection.name)} className="text-sm text-zinc-500 underline">
          {repo} · {collection.name}
        </Link>
        <h1 className="text-2xl font-semibold">휴지통</h1>
        <p className="text-sm text-zinc-500">휴지통의 글은 사이트에 보이지 않아요. 복구하면 초안이 돼요.</p>
      </header>
      <CollectionTabs config={config} current={collection} href={(c) => trashHref(repo, c)} />
      <section className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">
          {collection.name} {posts.length}편
        </p>
        {posts.length === 0 ? (
          <p className="text-zinc-500">휴지통에 {collection.name} 글이 없어요.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 font-normal">제목</th>
                <th className="py-1 font-normal">삭제 시각</th>
                <th className="py-1 font-normal">
                  <span className="sr-only">복구</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.path} className="border-t align-top">
                  <td className="py-2 break-words">
                    <Link href={postHref(repo, post.path)} className="underline">
                      {listTitle(post)}
                    </Link>
                  </td>
                  <td className="py-2 whitespace-nowrap">{trashedAtText(post.trashedAt)}</td>
                  <td className="py-2">
                    <RestoreButton restore={restorePostAction.bind(null, repo, post.path, post.sha)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <TechDetails
        items={[
          ["API 호출", `${calls}번`],
          ["불러온 시간", `${elapsed}ms`],
        ]}
      />
    </>
  );
}
