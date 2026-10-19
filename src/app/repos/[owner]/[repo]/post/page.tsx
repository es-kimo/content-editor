import Link from "next/link";
import { notFound } from "next/navigation";

import { openRepoPage, postHref, repoHref } from "@/app/_lib/repo";
import type { SearchParams } from "@/app/_lib/session";
import { PageShell } from "@/app/_lib/ui";
import { editorKeys, editorModes, IMAGE_COMPONENT, readPost, type Post } from "@/lib/content";
import type { Syntax } from "@/lib/mdx-doc";
import { buildForm } from "@/lib/metadata-form";

import { saveBodyAction, saveMetadataAction, saveSourceAction } from "./actions";
import { BodyEditor } from "./body-editor";
import { EditorModeSwitch } from "./editor-mode-switch";
import { MetadataForm } from "./metadata-form";
import { SourceEditor } from "./source-editor";

type Params = Promise<{ owner: string; repo: string }>;

export default function PostPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <PageShell>
      <PostView params={params} searchParams={searchParams} />
    </PageShell>
  );
}

async function PostView({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { owner, repo: name } = await params;
  const repo = `${owner}/${name}`;
  const { path, saved } = await searchParams;
  if (typeof path !== "string") notFound();

  const page = await openRepoPage(repo, searchParams, postHref(repo, path), ({ client, config }) =>
    readPost(client, repo, config, path),
  );
  if (!page.ok) return page.view;
  const { config, value: post } = page;
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
        <BodyView repo={repo} post={post} syntax={config.syntax} />
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

const SOURCE_ONLY = {
  doc: "구간으로 나눌 수 없는 글이라 원문 모드로만 고친다",
  metadata: "metadata를 폼으로 읽을 수 없는 글이라 원문 모드로만 고친다",
};

function BodyView({ repo, post, syntax }: { repo: string; post: Post; syntax: Syntax }) {
  const modes = editorModes(post);
  // 원문은 파일 전체라 어느 영역을 저장해도 바뀐다. 저장한 파일로 다시 열도록 key를 sha로 둔다.
  const source = (
    <SourceEditor
      key={post.sha}
      source={post.source}
      syntax={syntax}
      action={saveSourceAction.bind(null, repo, post.path, post.sha)}
    />
  );
  if (modes.sourceOnly || !post.doc.ok) {
    return (
      <>
        {modes.sourceOnly && (
          <p className="text-sm text-amber-600">
            {SOURCE_ONLY[modes.sourceOnly.reason]}: {modes.sourceOnly.message}
          </p>
        )}
        {source}
      </>
    );
  }
  return (
    <EditorModeSwitch
      initial={modes.initial}
      source={source}
      wysiwyg={
        // 다른 영역을 저장해도 고치던 본문이 남도록 key를 sha가 아닌 본문 원본으로 둔다.
        <BodyEditor
          key={editorKeys(post).body}
          body={post.doc.body}
          syntax={syntax}
          components={post.collection.components}
          upload={
            post.collection.components.includes(IMAGE_COMPONENT)
              ? { doc: post.doc, files: post.images.map((image) => image.name) }
              : null
          }
          action={saveBodyAction.bind(null, repo, post.path, post.sha)}
        />
      }
    />
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
  // 본문을 저장해도 고치던 폼 입력이 남도록 key를 sha가 아닌 metadata 원본으로 둔다.
  return (
    <MetadataForm
      key={editorKeys(post).metadata}
      fields={fields}
      action={saveMetadataAction.bind(null, repo, post.path, post.sha)}
    />
  );
}
