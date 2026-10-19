import Link from "next/link";
import { Suspense } from "react";

import { isUnauthorized, LoginLink, loadRepoConfig, postHref, repoHref } from "@/app/_lib/repo";
import { pageAccessToken, type SearchParams } from "@/app/_lib/session";
import { assertRepoAllowed } from "@/app/_lib/site";
import { createGitHubClient, listPosts, timed, type PostListItem } from "@/lib/content";

type Params = Promise<{ owner: string; repo: string }>;

export default function RepoPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16 font-sans">
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <PostList params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function PostList({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { owner, repo: name } = await params;
  const repo = `${owner}/${name}`;
  await assertRepoAllowed(repo);
  const selected = (await searchParams).collection;

  const accessToken = await pageAccessToken(
    searchParams,
    repoHref(repo, typeof selected === "string" ? selected : undefined),
  );
  if (!accessToken) return <LoginLink />;
  const loaded = await loadRepoConfig(repo, accessToken);
  if (!loaded.ok) return loaded.view;
  const { config } = loaded;

  const collection = config.collections.find((c) => c.name === selected) ?? config.collections[0];
  const client = createGitHubClient(accessToken, fetch);
  let posts: PostListItem[];
  let elapsed: number;
  try {
    ({ value: posts, ms: elapsed } = await timed(() => listPosts(client, repo, config, collection)));
  } catch (e) {
    if (isUnauthorized(e)) return <LoginLink />;
    throw e;
  }

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-zinc-500 underline">
          처음으로
        </Link>
        <h1 className="text-2xl font-semibold">{repo}</h1>
        <p className="text-sm text-zinc-500">브랜치 {config.branch}</p>
      </header>
      <nav className="flex flex-wrap gap-2">
        {config.collections.map((c) => (
          <Link
            key={c.name}
            href={repoHref(repo, c.name)}
            aria-current={c === collection ? "page" : undefined}
            className="rounded border px-3 py-1 text-sm aria-[current=page]:bg-black aria-[current=page]:text-white dark:aria-[current=page]:bg-white dark:aria-[current=page]:text-black"
          >
            {c.name}
          </Link>
        ))}
      </nav>
      <section className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">
          {collection.name} {posts.length}편 · API 호출 {client.calls}번 · {elapsed}ms
        </p>
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
