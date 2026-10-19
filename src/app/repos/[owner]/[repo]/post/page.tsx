import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { isUnauthorized, LoginLink, loadRepoConfig, postHref, repoHref } from "@/app/_lib/repo";
import { pageAccessToken, type SearchParams } from "@/app/_lib/session";
import { assertRepoAllowed } from "@/app/_lib/site";
import { createGitHubClient, readPost, type Post } from "@/lib/content";

type Params = Promise<{ owner: string; repo: string }>;

export default function PostPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16 font-sans">
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <PostView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function PostView({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { owner, repo: name } = await params;
  const repo = `${owner}/${name}`;
  await assertRepoAllowed(repo);
  const path = (await searchParams).path;
  if (typeof path !== "string") notFound();

  const accessToken = await pageAccessToken(searchParams, postHref(repo, path));
  if (!accessToken) return <LoginLink />;
  const loaded = await loadRepoConfig(repo, accessToken);
  if (!loaded.ok) return loaded.view;

  let post: Post | null;
  try {
    post = await readPost(createGitHubClient(accessToken, fetch), repo, loaded.config, path);
  } catch (e) {
    if (isUnauthorized(e)) return <LoginLink />;
    throw e;
  }
  if (!post) notFound();

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={repoHref(repo, post.collection.name)} className="text-sm text-zinc-500 underline">
          {repo} · {post.collection.name}
        </Link>
        <h1 className="text-xl font-semibold break-all">{post.path}</h1>
        <p className="text-xs text-zinc-500">blob {post.sha}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">metadata</h2>
        <MetadataView post={post} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">본문</h2>
        {post.doc.ok ? (
          <pre className="overflow-x-auto rounded border p-3 text-sm whitespace-pre-wrap">{post.doc.body}</pre>
        ) : (
          <>
            <p className="text-sm text-amber-600">
              구간으로 나눌 수 없는 글이라 원문 전체를 보인다: {post.doc.message}
            </p>
            <pre className="overflow-x-auto rounded border p-3 text-sm whitespace-pre-wrap">{post.source}</pre>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">이미지 {post.images.length}개</h2>
        {post.images.length > 0 && (
          <ul className="list-disc pl-5 text-sm">
            {post.images.map((image) => (
              <li key={image.path}>
                {image.name} <span className="text-zinc-500">({Math.ceil(image.size / 1024)}KB)</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function MetadataView({ post }: { post: Post }) {
  if (!post.metadata) return <p className="text-sm text-zinc-500">metadata export가 없다.</p>;
  if (!post.metadata.editable) {
    return <p className="text-sm text-amber-600">폼으로 읽을 수 없어 원문 모드로만 편집한다: {post.metadata.reason}</p>;
  }
  return (
    <pre className="overflow-x-auto rounded border p-3 text-sm">{JSON.stringify(post.metadata.value, null, 2)}</pre>
  );
}
