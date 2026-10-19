import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { isUnauthorized, LoginLink, loadRepoConfig, postHref, repoHref } from "@/app/_lib/repo";
import { pageAccessToken, type SearchParams } from "@/app/_lib/session";
import { assertRepoAllowed } from "@/app/_lib/site";
import { createGitHubClient, readPost, type Post } from "@/lib/content";
import { buildForm } from "@/lib/metadata-form";

import { saveBodyAction, saveMetadataAction } from "./actions";
import { BodyEditor } from "./body-editor";
import { MetadataForm } from "./metadata-form";

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
  const { path, saved } = await searchParams;
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
        {typeof saved === "string" && <p className="text-sm text-green-700">저장했다. 커밋 {saved.slice(0, 7)}</p>}
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">metadata</h2>
        <MetadataView repo={repo} post={post} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">본문</h2>
        {post.doc.ok && post.collection.editor === "wysiwyg" ? (
          // 저장한 뒤 같은 주소로 돌아오면 새 본문으로 에디터를 다시 열도록 key를 sha로 둔다.
          <BodyEditor
            key={post.sha}
            body={post.doc.body}
            syntax={loaded.config.syntax}
            components={post.collection.components}
            action={saveBodyAction.bind(null, repo, post.path, post.sha)}
          />
        ) : post.doc.ok ? (
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

function MetadataView({ repo, post }: { repo: string; post: Post }) {
  if (!post.metadata) return <p className="text-sm text-zinc-500">metadata export가 없다.</p>;
  if (!post.metadata.editable) {
    return <p className="text-sm text-amber-600">폼으로 읽을 수 없어 원문 모드로만 편집한다: {post.metadata.reason}</p>;
  }
  const fields = buildForm(post.collection, post.metadata.value);
  if (fields.length === 0) {
    return <p className="text-sm text-zinc-500">config에 이 컬렉션의 metadata 필드가 없다.</p>;
  }
  // 저장한 뒤 같은 주소로 돌아오면 새 sha로 폼을 다시 만들도록 key를 sha로 둔다.
  return (
    <MetadataForm key={post.sha} fields={fields} action={saveMetadataAction.bind(null, repo, post.path, post.sha)} />
  );
}
