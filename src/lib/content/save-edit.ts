import type { EditorConfig } from "@/lib/editor-config";
import type { GitHubClient } from "@/lib/github";
import { checkMdx, parseMdx, printMdx, readMetadata, setMetadata } from "@/lib/mdx-doc";
import {
  actionStatus,
  readStatus,
  STATUS_FIELD,
  TITLE_FIELD,
  withStatus,
  type FormValues,
  type PostAction,
  type PostStatus,
  type StatusProblem,
} from "@/lib/metadata-form";

import {
  applyMetadataForm,
  commitEdit,
  commitSource,
  editBody,
  openForEdit,
  openPost,
  withRequired,
  type CommitEditResult,
  type EditablePost,
  type MetadataFormResult,
  type OpenForEditResult,
} from "./edit-post";
import type { Post } from "./read";
import { checkSourceUploads, checkUploads, type UploadCheck, type UploadImage } from "./upload";

/** 저장할 글 전체. 일반 편집은 제목을 포함한 설정 폼과 본문, 원문 편집은 파일 전체 원문이다. */
export type EditContent =
  | {
      mode: "form";
      values: FormValues;
      body: string;
      /** 본문에 넣은 새 이미지. 글 폴더에 저장하고 import를 더해 같은 커밋에 담는다. */
      images?: UploadImage[];
    }
  | {
      mode: "source";
      source: string;
      /** 원문에 넣은 새 이미지. 원문이 그 import를 이미 담고 있어 글 폴더에 저장만 한다. */
      images?: UploadImage[];
    };

export type SaveEditInput = {
  path: string;
  /** 편집 화면을 연 글의 blob sha. 그 사이 글이 바뀌었으면 저장하지 않는다. */
  baseSha: string;
} & (
  | { action: Exclude<PostAction, "unpublish">; content: EditContent }
  /** 게시 내리기는 미저장 편집을 담지 않는다. 화면이 먼저 반영하거나 버리게 한다. */
  | { action: "unpublish" }
);

export type SaveEditResult =
  | CommitEditResult
  | Exclude<OpenForEditResult, { ok: true }>
  | Exclude<MetadataFormResult, { ok: true }>
  | Exclude<UploadCheck, { ok: true }>
  | { ok: false; reason: StatusProblem }
  /** 고친 원문의 metadata를 읽거나 쓸 수 없거나 상태를 담을 `other`가 객체가 아니라 상태를 행동에 맞출 수 없다. */
  | { ok: false; reason: "source-status" };

/**
 * 글 전체를 커밋 하나로 저장하고 게시 상태를 행동이 정한 값으로 둔다. 폼·원문에 적힌 상태는 따르지 않는다.
 * 서버에서 다시 읽은 원본에 반영하므로 바뀌는 곳은 고친 곳과 상태뿐이다. 게시 내리기는 상태만 바꾼다.
 */
export async function saveEdit(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: SaveEditInput,
): Promise<SaveEditResult> {
  if (input.action === "unpublish") {
    const opened = await openForEdit(client, repo, config, input.path, input.baseSha);
    if (!opened.ok) return opened;
    const decided = decideStatus(opened.post, input.action);
    if (!decided.ok) return decided;
    return saveForm(client, repo, config, opened.post, decided.status, input.action, null);
  }

  const { content } = input;
  if (content.mode === "form") {
    const check = checkUploads(content.images ?? []);
    if (!check.ok) return check;
    const opened = await openForEdit(client, repo, config, input.path, input.baseSha);
    if (!opened.ok) return opened;
    const decided = decideStatus(opened.post, input.action);
    if (!decided.ok) return decided;
    return saveForm(client, repo, config, opened.post, decided.status, input.action, content);
  }

  const opened = await openPost(client, repo, config, input.path, input.baseSha);
  if (!opened.ok) return opened;
  const decided = decideStatus(opened.post, input.action);
  if (!decided.ok) return decided;
  return saveSource(client, repo, config, opened.post, decided.status, input.action, content);
}

/** 서버에서 읽은 글의 상태로 행동을 할 수 있는지 본다. metadata를 읽을 수 없는 글은 상태를 알 수 없는 글이다. */
function decideStatus(post: Post, action: PostAction) {
  const current = post.metadata?.editable ? readStatus(post.metadata.value) : null;
  return actionStatus(post.collection, current, action);
}

async function saveForm(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  post: EditablePost,
  status: PostStatus,
  action: PostAction,
  content: Extract<EditContent, { mode: "form" }> | null,
): Promise<SaveEditResult> {
  const applied = applyMetadataForm(post, { ...content?.values, [STATUS_FIELD]: status });
  if (!applied.ok && applied.reason === "not-editable") return applied;
  const title = applied.ok ? applied.value.title : content?.values[TITLE_FIELD];
  const body = content?.body ?? post.doc.body;
  const errors = withRequired(applied.ok ? [] : applied.errors, action, title, body);
  if (!applied.ok || errors.length > 0) return { ok: false, reason: "invalid", errors };

  const images = content?.images ?? [];
  const edited = editBody(post, setMetadata(post.doc, applied.value), body, images);
  if (!edited.ok) return edited;
  return commitEdit(client, repo, config, post, edited.doc, applied.value.title, images);
}

async function saveSource(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  post: Post,
  status: PostStatus,
  action: PostAction,
  content: Extract<EditContent, { mode: "source" }>,
): Promise<SaveEditResult> {
  const images = content.images ?? [];
  const check = checkSourceUploads(
    images,
    content.source,
    post.images.map((image) => image.name),
  );
  if (!check.ok) return check;

  const doc = parseMdx(content.source, config.syntax);
  const metadata = readMetadata(doc);
  if (!doc.ok || !metadata?.editable) {
    // 나눌 수 없는 원문은 대개 컴파일도 되지 않는다. 그 오류가 상태를 맞출 수 없다는 안내보다 고칠 곳을 잘 알려 준다.
    const compiled = await checkMdx(content.source, config.syntax);
    if (!compiled.ok) return { ok: false, reason: "compile", error: compiled.error };
    return { ok: false, reason: "source-status" };
  }

  const errors = withRequired([], action, metadata.value.title, doc.body);
  if (errors.length > 0) return { ok: false, reason: "invalid", errors };

  const next = withStatus(metadata.value, status);
  if (!next) return { ok: false, reason: "source-status" };
  const source = printMdx(setMetadata(doc, next));
  return commitSource(client, repo, config, post, source, metadata.value.title, images);
}
