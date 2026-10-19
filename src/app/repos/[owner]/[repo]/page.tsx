import Link from "next/link";

import { CollectionTabs, newPostHref, openRepoPage, postHref, repoHref } from "@/app/_lib/repo";
import type { SearchParams } from "@/app/_lib/session";
import { PageShell } from "@/app/_lib/ui";
import { listPosts, timed } from "@/lib/content";

type Params = Promise<{ owner: string; repo: string }>;

export default function RepoPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <PageShell>
      <PostList params={params} searchParams={searchParams} />
    </PageShell>
  );
}

async function PostList({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { owner, repo: name } = await params;
  const repo = `${owner}/${name}`;
  const selected = (await searchParams).collection;

  const page = await openRepoPage(
    repo,
    searchParams,
    repoHref(repo, typeof selected === "string" ? selected : undefined),
    async ({ client, config }) => {
      const collection = config.collections.find((c) => c.name === selected) ?? config.collections[0];
      const { value: posts, ms: elapsed } = await timed(() => listPosts(client, repo, config, collection));
      return { collection, posts, elapsed, calls: client.calls };
    },
  );
  if (!page.ok) return page.view;
  const { config } = page;
  const { collection, posts, elapsed, calls } = page.value;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-zinc-500 underline">
          처음으로
        </Link>
        <h1 className="text-2xl font-semibold">{repo}</h1>
        <p className="text-sm text-zinc-500">브랜치 {config.branch}</p>
      </header>
      <CollectionTabs config={config} current={collection} href={(c) => repoHref(repo, c)} />
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm text-zinc-500">
            {collection.name} {posts.length}편 · API 호출 {calls}번 · {elapsed}ms
          </p>
          <Link href={newPostHref(repo, collection.name)} className="text-sm underline">
            새 글
          </Link>
        </div>
        {posts.length === 0 ? (
          <p className="text-zinc-500">
            <code>{collection.path}</code>에 맞는 글이 없다.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 font-normal">제목</th>
                <th className="py-1 font-normal">상태</th>
                <th className="py-1 font-normal">작성일</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.path} className="border-t">
                  <td className="py-2">
                    <Link href={postHref(repo, post.path)} className="underline">
                      {post.title}
                    </Link>
                    {post.problem && (
                      <span className="ml-2 text-xs text-amber-600" title={post.problem}>
                        metadata를 읽지 못함
                      </span>
                    )}
                  </td>
                  <td className="py-2">{post.status ?? "-"}</td>
                  <td className="py-2 whitespace-nowrap">{post.createdAt?.slice(0, 10) ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
