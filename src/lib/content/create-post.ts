import type { Collection, EditorConfig } from "@/lib/editor-config";
import type { GitHubClient } from "@/lib/github";
import { checkMdx, newMdx, parseMdx, printMdx, type MdxError } from "@/lib/mdx-doc";
import {
  actionStatus,
  applyForm,
  newMetadata,
  STATUS_FIELD,
  TITLE_FIELD,
  type FormValues,
  type PostAction,
  type StatusProblem,
} from "@/lib/metadata-form";

import { savePost } from "./commit";
import { editBody, withRequired } from "./edit-post";
import { readPostList } from "./posts";
import { checkSubmenuName, newPostPath, postSlug, submenuFolder } from "./slug";
import { checkUploads, type UploadCheck, type UploadImage } from "./upload";

/** 새 글에 하위 메뉴를 골라야 하는 컬렉션인지. */
export function needsSubmenu(collection: Collection): boolean {
  return collection.path.split("/").includes("{submenu}");
}

/**
 * 컬렉션에 이미 있는 하위 메뉴. 이름순.
 * 휴지통에 없는 글이 하나라도 있는 폴더만 메뉴다. 초안만 있는 메뉴도 다음 글을 쓸 때 고를 수 있다.
 */
export async function listSubmenus(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  collection: Collection,
): Promise<string[]> {
  const submenus = (await readPostList(client, repo, config, collection)).flatMap(({ params, trashed }) =>
    params.submenu === undefined || trashed ? [] : [params.submenu],
  );
  return [...new Set(submenus)].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}

/** 새 글의 하위 메뉴. 기존 메뉴를 고르거나, 새 이름을 입력해 첫 글과 함께 만든다. */
export type NewPostSubmenu = { kind: "existing"; name: string } | { kind: "new"; name: string };

export type CreatePostInput = {
  /** 컬렉션 이름 (`Collection.name`). */
  collection: string;
  /** 처음 저장은 초안으로 두거나 바로 게시한다. */
  action: Extract<PostAction, "save-draft" | "publish">;
  /** 제목을 포함한 설정 폼 값. 게시 상태는 행동이 정하므로 따르지 않는다. */
  values: FormValues;
  body: string;
  /** 본문에 넣은 새 이미지. 글 폴더에 저장하고 import를 더해 같은 커밋에 담는다. */
  images?: UploadImage[];
  /** 하위 메뉴가 있는 컬렉션에서만 쓴다. */
  submenu?: NewPostSubmenu;
};

/** 하위 메뉴 필드 오류의 키. */
export const SUBMENU_FIELD = "submenu";

export type CreatePostResult =
  | { ok: true; path: string; commit: string }
  /** `key`는 설정 폼의 키, `BODY_FIELD`, `SUBMENU_FIELD`, `collection`이다. */
  | { ok: false; reason: "invalid"; errors: { key: string; message: string }[] }
  /** 같은 이름의 글 폴더가 이미 있다. */
  | { ok: false; reason: "exists"; path: string }
  | { ok: false; reason: "not-fast-forward" }
  | { ok: false; reason: "compile"; error: MdxError }
  | Exclude<UploadCheck, { ok: true }>
  /** 컬렉션 설정이 게시 상태를 다루지 못한다. */
  | { ok: false; reason: StatusProblem };

/**
 * 새 글을 제목·설정·본문·이미지와 함께 처음 저장한다. 글과 이미지, 새 하위 메뉴 폴더가 커밋 1개에 담긴다.
 * 제목으로 글 폴더를 정하고, 상태는 행동이 정한 값으로 둔다.
 * 같은 폴더가 이미 있으면(글 파일 없이 이미지만 있어도) 만들지 않고, 새 하위 메뉴 자리에 무엇이 있어도 만들지 않는다.
 */
export async function createPost(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: CreatePostInput,
  now: Date,
): Promise<CreatePostResult> {
  const collection = config.collections.find((c) => c.name === input.collection);
  if (!collection) {
    return { ok: false, reason: "invalid", errors: [{ key: "collection", message: "편집 설정에 없는 글 분류예요." }] };
  }
  const images = input.images ?? [];
  const check = checkUploads(images);
  if (!check.ok) return check;
  const decided = actionStatus(collection, "draft", input.action);
  if (!decided.ok) return decided;

  const title = (input.values[TITLE_FIELD] ?? "").replace(/\s+/g, " ").trim();
  const applied = applyForm(collection, newMetadata(collection, title, now), {
    ...input.values,
    [TITLE_FIELD]: title,
    [STATUS_FIELD]: decided.status,
  });
  const errors = withRequired(applied.ok ? [] : applied.errors, input.action, title, input.body);
  const slug = postSlug(title);
  // 빈 제목은 withRequired가 이미 알렸다.
  if (title !== "" && slug === null) {
    errors.push({ key: TITLE_FIELD, message: "폴더 이름으로 쓸 수 있는 글자가 없어요. 글자나 숫자를 넣어 주세요." });
  }
  const submenu = needsSubmenu(collection)
    ? await pickSubmenu(client, repo, config, collection, input.submenu)
    : { ok: true as const, name: undefined, newFolder: null };
  if (!submenu.ok) errors.push({ key: SUBMENU_FIELD, message: submenu.message });
  if (!applied.ok || !submenu.ok || slug === null || errors.length > 0) return { ok: false, reason: "invalid", errors };

  const path = newPostPath(collection, slug, submenu.name);
  // 새 글 원문의 틀(metadata 출력과 구간 사이 빈 줄)만 newMdx에서 받고, 그 제목 줄은 입력한 본문으로 바꾼다.
  const doc = parseMdx(newMdx(applied.value, title), config.syntax);
  const edited = editBody({ images: [] }, doc, input.body, images);
  if (!edited.ok) return edited;
  const source = printMdx(edited.doc);
  const compiled = await checkMdx(source, config.syntax);
  if (!compiled.ok) return { ok: false, reason: "compile", error: compiled.error };

  const { newFolder } = submenu;
  const result = await savePost(client, repo, config, {
    path,
    baseSha: null,
    source,
    title,
    images: images.map(({ file, content }) => ({ name: file, content })),
    newFolders: newFolder ? [newFolder] : [],
  });
  if (result.ok) return { ok: true, path, commit: result.commit };
  if (result.reason === "changed" && result.path === newFolder) {
    // 글이 없어 목록에 없던 폴더이거나, 검사한 뒤 다른 곳에서 같은 이름의 메뉴가 생겼다. 그 안에 끼워 넣지 않는다.
    const message = "같은 이름의 폴더가 이미 있어요. 새 하위 메뉴 이름을 바꿔 주세요.";
    return { ok: false, reason: "invalid", errors: [{ key: SUBMENU_FIELD, message }] };
  }
  if (result.reason === "changed") return { ok: false, reason: "exists", path };
  return result;
}

/** 입력한 하위 메뉴를 확인한다. `newFolder`는 이 글과 함께 새로 만드는 메뉴 폴더의 경로다. */
async function pickSubmenu(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  collection: Collection,
  submenu: NewPostSubmenu | undefined,
): Promise<{ ok: true; name: string; newFolder: string | null } | { ok: false; message: string }> {
  if (!submenu || (submenu.kind === "existing" && submenu.name === "")) {
    return { ok: false, message: "하위 메뉴를 골라 주세요." };
  }
  const existing = await listSubmenus(client, repo, config, collection);
  if (submenu.kind === "existing") {
    return existing.includes(submenu.name)
      ? { ok: true, name: submenu.name, newFolder: null }
      : { ok: false, message: "목록에 없는 하위 메뉴예요. 목록에서 골라 주세요." };
  }
  const checked = checkSubmenuName(submenu.name, existing);
  if (!checked.ok) return { ok: false, message: checked.message };
  return { ok: true, name: checked.name, newFolder: submenuFolder(collection, checked.name) };
}
