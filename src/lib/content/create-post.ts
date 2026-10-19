import { compilePathPattern, type Collection, type EditorConfig } from "@/lib/editor-config";
import { newMdx } from "@/lib/mdx-doc";
import { newMetadata } from "@/lib/metadata-form";

import type { GitHubClient } from "./client";
import { savePost } from "./commit";
import { fetchTree, matchPosts } from "./posts";

// 경로·URL·Windows 파일 이름에 쓸 수 없거나 뜻이 달라지는 문자. 기존 mdx-cli 글도 `?`를 `_`로 바꿔 두었다.
const UNSAFE = /[/\\?#%*:|"<>\p{Cc}]/gu;
// GitHub과 파일 시스템의 경로 한 단계 한도(255바이트)보다 여유를 둔다.
const MAX_SLUG_BYTES = 200;

/**
 * 제목으로 만든 글 폴더 이름. 기존 글처럼 제목을 그대로 쓰되, 경로에 쓸 수 없는 문자는 `_`로 바꾸고
 * 공백을 하나로 줄이고 앞뒤 공백과 점을 뗀다. 쓸 수 있는 글자가 없으면 null.
 */
export function postSlug(title: string): string | null {
  let slug = title
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(UNSAFE, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  const encoder = new TextEncoder();
  while (encoder.encode(slug).length > MAX_SLUG_BYTES) slug = [...slug].slice(0, -1).join("").trimEnd();
  return slug === "" || /^_+$/.test(slug) ? null : slug;
}

/** 새 글에 하위 메뉴를 골라야 하는 컬렉션인지. */
export function needsSubmenu(collection: Collection): boolean {
  return collection.path.split("/").includes("{submenu}");
}

/**
 * 컬렉션에 이미 있는 하위 메뉴. 이름순.
 * 새 글은 이 중에서만 고른다. 하위 메뉴 폴더를 새로 만들면 사이트 메뉴에 무엇이 생길지 에디터가 알 수 없다.
 */
export async function listSubmenus(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  collection: Collection,
): Promise<string[]> {
  const submenus = matchPosts(await fetchTree(client, repo, config.branch), collection).flatMap(({ params }) =>
    params.submenu === undefined ? [] : [params.submenu],
  );
  return [...new Set(submenus)].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}

export type CreatePostInput = {
  /** 컬렉션 이름 (`Collection.name`). */
  collection: string;
  title: string;
  /** 하위 메뉴가 있는 컬렉션에서만 쓴다. */
  submenu?: string;
};

export type CreatePostField = keyof CreatePostInput;

export type CreatePostResult =
  | { ok: true; path: string; commit: string }
  | { ok: false; reason: "invalid"; errors: { key: CreatePostField; message: string }[] }
  /** 같은 이름의 글 폴더가 이미 있다. */
  | { ok: false; reason: "exists"; path: string }
  | { ok: false; reason: "not-fast-forward" };

/**
 * 제목으로 글 폴더를 정하고 기본 metadata와 제목 줄만 있는 글을 커밋 1개로 만든다.
 * 같은 폴더가 이미 있으면(글 파일 없이 이미지만 있어도) 만들지 않는다.
 */
export async function createPost(
  client: GitHubClient,
  repo: string,
  config: EditorConfig,
  input: CreatePostInput,
  now: Date,
): Promise<CreatePostResult> {
  const invalid = (key: CreatePostField, message: string): CreatePostResult => ({
    ok: false,
    reason: "invalid",
    errors: [{ key, message }],
  });

  const collection = config.collections.find((c) => c.name === input.collection);
  if (!collection) return invalid("collection", "config에 없는 컬렉션이다");
  const title = input.title.replace(/\s+/g, " ").trim();
  if (title === "") return invalid("title", "필수 항목이다");
  const slug = postSlug(title);
  if (slug === null) return invalid("title", "폴더 이름으로 쓸 수 있는 글자가 없다");

  let submenu: string | undefined;
  if (needsSubmenu(collection)) {
    submenu = input.submenu;
    if (!submenu) return invalid("submenu", "필수 항목이다");
    if (!(await listSubmenus(client, repo, config, collection)).includes(submenu)) {
      return invalid("submenu", `컬렉션에 없는 하위 메뉴다: ${submenu}`);
    }
  }

  const path = compilePathPattern(collection.path).build({ slug, submenu });
  const result = await savePost(client, repo, config, {
    path,
    baseSha: null,
    source: newMdx(newMetadata(collection, title, now), title),
    title,
  });
  if (result.ok) return { ok: true, path, commit: result.commit };
  if (result.reason === "changed") return { ok: false, reason: "exists", path };
  return result;
}
