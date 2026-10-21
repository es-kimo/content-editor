import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { LeaveLink } from "@/app/_lib/leave";
import { openRepoPage, postHref, repoHref } from "@/app/_lib/repo";
import type { SearchParams } from "@/app/_lib/session";
import { PageShell, TechDetails } from "@/app/_lib/ui";
import { UnsavedNotice, UnsavedProvider } from "@/app/_lib/unsaved";
import {
  editorKeys,
  editorModes,
  IMAGE_COMPONENT,
  postActions,
  postTitle,
  readPost,
  sourceComponents,
  type Post,
  type PostActions,
} from "@/lib/content";
import type { Syntax } from "@/lib/mdx-doc";
import { buildForm, optionLabel, STATUS_FIELD, type FormField } from "@/lib/metadata-form";

import { savePostAction } from "./actions";
import { BodyEditor } from "./body-editor";
import { EditorModeSwitch } from "./editor-mode-switch";
import { MetadataForm, MetadataSettings, MetadataTitleInput } from "./metadata-form";
import { PostActionBar } from "./post-actions";
import { PostEditorProvider } from "./post-editor";
import { savedMessage } from "./save-result";
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
  const { path, saved, action } = await searchParams;
  if (typeof path !== "string") notFound();

  const page = await openRepoPage(repo, searchParams, postHref(repo, path), ({ client, config }) =>
    readPost(client, repo, config, path),
  );
  if (!page.ok) return page.view;
  const { config, value: post } = page;
  if (!post) notFound();

  const commit = typeof saved === "string" ? saved : undefined;
  const fields = metadataFields(post);
  const modes = editorModes(post);
  const actions = postActions(post.collection, post.metadata?.editable ? post.metadata.value : null);
  const title = postTitle(post.metadata);
  const content = (
    <>
      <header className="flex flex-col gap-1">
        <LeaveLink href={repoHref(repo, post.collection.name)} className="text-sm text-zinc-500 underline">
          {repo} · {post.collection.name}
        </LeaveLink>
        <h1 className="text-2xl font-semibold break-words">{title}</h1>
        {actions.status && <p className="text-sm">상태: {POST_STATE_LABELS[actions.status]}</p>}
        {commit && (
          <p className="text-sm text-green-700">{savedMessage(typeof action === "string" ? action : undefined)}</p>
        )}
        <UnsavedNotice />
      </header>

      {fields.ok && <MetadataTitleInput />}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">본문</h2>
        <BodyView post={post} syntax={config.syntax} preview={config.preview} />
      </section>

      <section className="flex flex-col gap-2">
        {fields.ok ? (
          <MetadataSettings />
        ) : (
          <>
            <h2 className="font-medium">글 설정</h2>
            {fields.notice}
          </>
        )}
      </section>

      <PostActionBar actions={actions} title={title} save={savePostAction.bind(null, repo, post.path, post.sha)} />

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

      <TechDetails
        items={[
          ["파일 경로", post.path],
          ["blob SHA", post.sha],
          ...(commit ? [["저장한 커밋", commit] satisfies [string, string]] : []),
          // 글 설정을 폼으로 읽을 수 없는 글도 원문 전용이라, 그 이유도 여기에 담긴다.
          ...(modes.sourceOnly ? [["일반 편집 제한 원문", modes.sourceOnly.message] satisfies [string, string]] : []),
        ]}
      />
    </>
  );

  return (
    // 저장하면 새 커밋을 `saved`로 받아 다시 열리므로, 그 커밋으로 저장한 글 화면이 열렸는지 안다.
    <UnsavedProvider revision={commit}>
      <PostEditorProvider
        initial={modes.initial}
        post={{
          collection: post.collection,
          syntax: config.syntax,
          source: post.source,
          files: post.images.map((image) => image.name),
        }}
      >
        {fields.ok ? (
          <MetadataForm version={editorKeys(post).metadata} fields={fields.fields}>
            {content}
          </MetadataForm>
        ) : (
          content
        )}
      </PostEditorProvider>
    </UnsavedProvider>
  );
}

/** 화면 제목 가까이 보일 글 상태. 휴지통 글은 게시 상태 값과 상관없이 휴지통이다. */
const POST_STATE_LABELS: { [status in NonNullable<PostActions["status"]>]: string } = {
  draft: optionLabel(STATUS_FIELD, "draft"),
  ready: optionLabel(STATUS_FIELD, "ready"),
  trashed: "휴지통",
};

/** 원문 전용 글의 구체적인 제한 이유. 기술 원문은 기술 상세에 둔다. */
const SOURCE_ONLY = {
  doc: "글 설정과 본문을 나눠 읽을 수 없는 구성이에요.",
  metadata: "글 설정을 폼으로 읽을 수 없어요.",
};

function BodyView({ post, syntax, preview }: { post: Post; syntax: Syntax; preview?: string }) {
  const modes = editorModes(post);
  // 이미지는 글 분류 설정이 허용하고, import를 더할 수 있게 원문을 나눌 수 있는 글에만 넣는다.
  const upload =
    post.collection.components.includes(IMAGE_COMPONENT) && post.doc.ok
      ? { files: post.images.map((image) => image.name) }
      : null;
  // 원문은 파일 전체라 저장하면 바뀐다. 저장한 파일로 다시 열도록 key를 sha로 둔다.
  const source = (
    <SourceEditor
      key={post.sha}
      source={post.source}
      syntax={syntax}
      components={sourceComponents(post.collection)}
      upload={upload}
      preview={preview}
    />
  );
  if (modes.sourceOnly || !post.doc.ok) {
    return (
      <>
        {modes.sourceOnly && (
          <p className="text-sm text-amber-600">
            이 글은 일반 편집을 지원하지 않아요. 원문 편집을 이용해 주세요. {SOURCE_ONLY[modes.sourceOnly.reason]}
          </p>
        )}
        {source}
      </>
    );
  }
  return (
    <EditorModeSwitch
      source={source}
      wysiwyg={
        // 저장해도 본문이 그대로면 편집기를 다시 열지 않도록 key를 sha가 아닌 본문 원본으로 둔다.
        <BodyEditor
          key={editorKeys(post).body}
          doc={post.doc}
          body={post.doc.body}
          syntax={syntax}
          components={post.collection.components}
          upload={upload}
          preview={preview}
        />
      }
    />
  );
}

/** 글 설정 폼에 실을 필드. 폼으로 고칠 수 없으면 글 설정 자리에 대신 보일 안내. */
function metadataFields(post: Post): { ok: true; fields: FormField[] } | { ok: false; notice: ReactNode } {
  if (!post.metadata) {
    return {
      ok: false,
      notice: <p className="text-sm text-zinc-500">이 글에는 글 설정이 없어요. 원문 편집에서 추가할 수 있어요.</p>,
    };
  }
  if (!post.metadata.editable) {
    return {
      ok: false,
      notice: <p className="text-sm text-amber-600">글 설정을 폼으로 읽을 수 없어요. 원문 편집에서 고쳐 주세요.</p>,
    };
  }
  const fields = buildForm(post.collection, post.metadata.value);
  if (fields.length === 0) {
    return {
      ok: false,
      notice: <p className="text-sm text-zinc-500">이 글 분류에는 고칠 수 있는 글 설정이 없어요.</p>,
    };
  }
  return { ok: true, fields };
}
