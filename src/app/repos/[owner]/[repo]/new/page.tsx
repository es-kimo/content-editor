import { LeaveLink } from "@/app/_lib/leave";
import { CollectionTabs, newPostHref, openRepoPage, repoHref } from "@/app/_lib/repo";
import type { SearchParams } from "@/app/_lib/session";
import { PageShell } from "@/app/_lib/ui";
import { UnsavedNotice, UnsavedProvider } from "@/app/_lib/unsaved";
import { listSubmenus, needsSubmenu, newPostActions, openNewPost } from "@/lib/content";

import { BodyModes } from "../post/body-modes";
import { MetadataForm } from "../post/metadata-form";
import { PostEditorProvider } from "../post/post-editor";
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
  const opened = openNewPost(collection, config.syntax, new Date());

  return (
    <UnsavedProvider>
      <header className="flex flex-col gap-1">
        <LeaveLink href={repoHref(repo, collection.name)} className="text-sm text-zinc-500 underline">
          {repo} · {collection.name}
        </LeaveLink>
        <h1 className="text-2xl font-semibold">새 글</h1>
        <p className="text-sm text-zinc-500">
          ‘임시저장’이나 ‘게시’를 누르기 전에는 레포에 저장하지 않아요. 저장하면 브랜치 {config.branch}에 글 하나로
          저장하고 글 화면으로 가요. 제목이 폴더 이름이 돼요.
        </p>
        <UnsavedNotice />
      </header>
      <CollectionTabs config={config} current={collection} href={(c) => newPostHref(repo, c)} />
      {/* 컬렉션을 바꾸면 입력과 결과를 새로 시작한다. */}
      <PostEditorProvider key={collection.name} initial={collection.editor} post={opened.post}>
        <MetadataForm version="new" fields={opened.fields} target="new" ownTitle>
          <NewPostForm
            collection={collection}
            submenus={submenus}
            actions={newPostActions(collection)}
            save={createPostAction.bind(null, repo, collection.name)}
          >
            <BodyModes
              collection={collection}
              source={opened.post.source}
              doc={opened.doc}
              files={opened.post.files}
              keys={{ source: "new", body: "new" }}
              syntax={config.syntax}
              preview={config.preview}
            />
          </NewPostForm>
        </MetadataForm>
      </PostEditorProvider>
    </UnsavedProvider>
  );
}
