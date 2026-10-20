// 편집 화면이 브라우저에서 쓴다. GitHub 클라이언트를 import하지 않는다.
import type { FormValues } from "@/lib/metadata-form";

import type { NewPostSubmenu } from "./create-post";
import type { InsertFormInput, InsertFormTarget } from "./insert-form";
import type { FormArea } from "./save-flow";
import type { UploadSession } from "./upload-session";

/** 보관본을 유지하는 기간. 마지막 변경(보관 시각)부터 센다. */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 보관본을 나누는 글. 새 글은 경로가 없어 작성 건 id로 나누고, 다시 들어왔을 때 찾도록 컬렉션을 함께 둔다. */
export type DraftDoc = { kind: "post"; path: string } | { kind: "new"; collection: string; id: string };

/** 보관본 목록을 찾을 글. 새 글 화면은 새 id로 열리므로 같은 컬렉션의 새 글 보관본을 모두 찾는다. */
export type DraftQuery = { kind: "post"; path: string } | { kind: "new"; collection: string };

/** 같은 브라우저에서 보관본을 나누는 단위. 탭마다 따로 보관해 서로 덮어쓰지 않는다. */
export type DraftKey = { login: string; repo: string; branch: string; doc: DraftDoc; tab: string };

/** 모드별 입력. 일반 편집은 제목을 포함한 설정 폼 값과 본문, 원문 편집은 파일 전체 원문이다. */
export type DraftInput =
  { mode: "form"; values: FormValues; body: string; submenu?: NewPostSubmenu } | { mode: "source"; source: string };

/** 적용하지 않은 넣기·수정 폼과 그 작성 중 입력. */
export type DraftForm = { area: FormArea; target: InsertFormTarget; input: InsertFormInput };

/** 준비가 끝난 첨부. `file`은 글 폴더에 저장할 파일 이름이다. */
export type DraftAttachment = { file: string; content: Uint8Array; width?: number; height?: number };

/** 보관할 내용. */
export type DraftContent = { input: DraftInput; form: DraftForm | null; attachments: DraftAttachment[] };

/**
 * 보관본. `baseSha`는 편집을 연 글의 blob sha이고 새 글은 null, `savedAt`은 보관 시각(ms)이다.
 * `missing`은 용량이 모자라 텍스트만 보관할 때 빠진 첨부 파일 이름이다. 복구할 때 다시 골라야 한다.
 */
export type Draft = DraftContent & { key: DraftKey; baseSha: string | null; savedAt: number; missing: string[] };

/**
 * 보관본을 두는 브라우저 저장소. 값은 구조화 복제로 그대로 담는다(IndexedDB 등).
 * `set`은 용량 부족·저장 차단이면 던진다.
 */
export type DraftStorage = {
  keys(): Promise<string[]>;
  get(key: string): Promise<Draft | undefined>;
  set(key: string, draft: Draft): Promise<void>;
  delete(key: string): Promise<void>;
};

/** 보관 결과. 첨부를 담지 못하고 텍스트만 보관했으면 `missing`에 빠진 첨부 파일 이름이 있다. */
export type SaveDraftResult = { ok: true; savedAt: number; missing: string[] } | { ok: false; reason: "storage" };

/** 복구 판단. 충돌이면 자동으로 덮어쓰지 않고 현재 원격본과 보관 내용을 함께 보여 준다. */
export type DraftRestore =
  | { kind: "restorable"; draft: Draft }
  /** `changed`는 기준 글이 바뀌었거나 없어졌다, `trashed`는 글이 휴지통에 있다. */
  | { kind: "conflict"; reason: "changed" | "trashed"; draft: Draft };

const PREFIX = "content-editor-draft:";

/** 저장소 키. 계정·레포·브랜치·글·탭을 모두 담아 다른 계정이나 탭의 보관본과 섞이지 않는다. */
function draftStorageKey({ login, repo, branch, doc, tab }: DraftKey): string {
  const id = doc.kind === "post" ? [doc.path] : [doc.collection, doc.id];
  return PREFIX + JSON.stringify([login, repo, branch, doc.kind, ...id, tab]);
}

/** 업로드 세션에서 준비가 끝나 계획에 든 첨부. 준비 중인 이미지는 아직 계획에 없어 담기지 않는다. */
export function draftAttachments(session: Pick<UploadSession<{ name: string }>, "plan" | "sizes">): DraftAttachment[] {
  return session.plan.images.map(({ file, content }) => ({ file, content, ...session.sizes.get(file) }));
}

/**
 * 이 탭의 보관본을 지금 내용으로 바꾼다. 첨부까지 담지 못하면 텍스트만 보관하고 빠진 첨부를 알린다.
 * 텍스트도 담지 못하면 실패이고, 이전 보관본은 그대로 둔다.
 */
export async function saveDraft(
  storage: DraftStorage,
  key: DraftKey,
  content: DraftContent,
  baseSha: string | null,
  now: Date,
): Promise<SaveDraftResult> {
  const id = draftStorageKey(key);
  const draft: Draft = { ...content, key, baseSha, savedAt: now.getTime(), missing: [] };
  if (await trySet(storage, id, draft)) return { ok: true, savedAt: draft.savedAt, missing: [] };
  if (content.attachments.length === 0) return { ok: false, reason: "storage" };
  const missing = content.attachments.map((attachment) => attachment.file);
  if (!(await trySet(storage, id, { ...draft, attachments: [], missing }))) return { ok: false, reason: "storage" };
  return { ok: true, savedAt: draft.savedAt, missing };
}

async function trySet(storage: DraftStorage, id: string, draft: Draft): Promise<boolean> {
  try {
    await storage.set(id, draft);
    return true;
  } catch {
    return false;
  }
}

/**
 * 이 계정·레포·브랜치에서 `query` 글의 보관본을 모든 탭에서 찾아 최근 보관 순으로 돌려준다.
 * 30일이 지난 보관본은 빼고 저장소에서 지운다.
 */
export async function listDrafts(
  storage: DraftStorage,
  owner: Pick<DraftKey, "login" | "repo" | "branch">,
  query: DraftQuery,
  now: Date,
): Promise<Draft[]> {
  const drafts: Draft[] = [];
  for (const id of await storage.keys()) {
    if (!id.startsWith(PREFIX)) continue;
    const draft = await storage.get(id);
    if (!draft || !matches(draft.key, owner, query)) continue;
    if (expired(draft, now)) await storage.delete(id);
    else drafts.push(draft);
  }
  return drafts.sort((a, b) => b.savedAt - a.savedAt);
}

function matches(key: DraftKey, owner: Pick<DraftKey, "login" | "repo" | "branch">, query: DraftQuery): boolean {
  if (key.login !== owner.login || key.repo !== owner.repo || key.branch !== owner.branch) return false;
  if (key.doc.kind === "post") return query.kind === "post" && key.doc.path === query.path;
  return query.kind === "new" && key.doc.collection === query.collection;
}

function expired(draft: Draft, now: Date): boolean {
  return now.getTime() - draft.savedAt > DRAFT_TTL_MS;
}

/** 다른 글·계정의 보관본까지 저장소 전체에서 30일이 지난 보관본을 지운다. */
export async function removeExpiredDrafts(storage: DraftStorage, now: Date): Promise<void> {
  for (const id of await storage.keys()) {
    if (!id.startsWith(PREFIX)) continue;
    const draft = await storage.get(id);
    if (draft && expired(draft, now)) await storage.delete(id);
  }
}

/**
 * 저장에 성공한 뒤 부른다. 이 탭의 보관본이 저장한 내용과 같을 때만 지운다.
 * 저장하는 동안 더 입력해 보관본이 달라졌으면 그 입력을 남긴다.
 * 텍스트만 보관된 보관본은 빠진 첨부를 뺀 나머지로 비교한다. 아니면 이미 저장한 내용이 다음 접속에서 충돌로 나온다.
 */
export async function clearSavedDraft(storage: DraftStorage, key: DraftKey, saved: DraftContent): Promise<void> {
  const id = draftStorageKey(key);
  const draft = await storage.get(id);
  if (!draft) return;
  const kept = saved.attachments.filter((attachment) => !draft.missing.includes(attachment.file));
  if (sameContent(draft, { ...saved, attachments: kept })) await storage.delete(id);
}

/** '버리기'. 다음 접속에서 되살리지 않게 그 보관본을 지운다. */
export async function discardDraft(storage: DraftStorage, key: DraftKey): Promise<void> {
  await storage.delete(draftStorageKey(key));
}

function sameContent(a: DraftContent, b: DraftContent): boolean {
  return (
    JSON.stringify(a.input) === JSON.stringify(b.input) &&
    JSON.stringify(a.form) === JSON.stringify(b.form) &&
    a.attachments.length === b.attachments.length &&
    a.attachments.every((attachment, i) => sameAttachment(attachment, b.attachments[i]))
  );
}

function sameAttachment(a: DraftAttachment, b: DraftAttachment): boolean {
  return (
    a.file === b.file && a.content.length === b.content.length && a.content.every((byte, i) => byte === b.content[i])
  );
}

/**
 * 보관본을 지금 원격 글에 복구해도 되는지. 기준 sha가 현재 글 sha와 같을 때만 복구 가능이다.
 * @param current 지금 원격 글. 새 글이거나 원격에 글이 없으면 null.
 */
export function checkRestore(draft: Draft, current: { sha: string; trashed: boolean } | null): DraftRestore {
  if (current?.trashed) return { kind: "conflict", reason: "trashed", draft };
  if (draft.baseSha !== (current?.sha ?? null)) return { kind: "conflict", reason: "changed", draft };
  return { kind: "restorable", draft };
}
