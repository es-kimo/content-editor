// 새 글 화면이 입력하는 동안 글 경로를 보여 주려고 브라우저에서도 쓴다. GitHub 클라이언트를 import하지 않는다.

import { compilePathPattern, type Collection } from "@/lib/editor-config";

// 경로·URL·Windows 파일 이름에 쓸 수 없거나 뜻이 달라지는 문자. 기존 mdx-cli 글도 `?`를 `_`로 바꿔 두었다.
const UNSAFE = /[/\\?#%*:|"<>\p{Cc}]/gu;
// `g` 없이 있는지만 본다. `g`가 붙은 정규식의 test는 lastIndex가 남아 번갈아 틀린다.
const UNSAFE_CHAR = new RegExp(UNSAFE.source, "u");
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

export type SubmenuNameProblem =
  /** 앞뒤 공백을 떼면 남는 글자가 없다. */
  | "empty"
  /** `.`·`..`처럼 점으로 시작하거나 끝난다. 숨김 폴더가 되거나 경로의 뜻이 달라진다. */
  | "dot"
  /** 경로 구분자, 제어 문자, 글 폴더 이름에서 바꾸는 문자가 있다. */
  | "unsafe"
  /** 글 폴더 이름과 같은 바이트 한도를 넘는다. */
  | "too-long"
  /** 앞뒤 공백·유니코드 정규화를 맞추면 기존 하위 메뉴와 같다. */
  | "duplicate";

export type SubmenuNameCheck =
  | { ok: true; name: string }
  | { ok: false; problem: Exclude<SubmenuNameProblem, "duplicate">; message: string }
  /** `existing`은 같은 이름의 기존 하위 메뉴. 화면이 그 메뉴를 고르게 안내한다. */
  | { ok: false; problem: "duplicate"; message: string; existing: string };

/**
 * 새 하위 메뉴 이름을 검사하고 폴더 이름으로 쓸 이름을 돌려준다. 앞뒤 공백을 떼고 NFC로 맞추는 것 말고는 고치거나 자르지 않는다.
 * 메뉴 이름은 사이트 메뉴에 그대로 보이므로, 글 폴더 이름처럼 몰래 바꾸지 않고 사용자가 고치게 한다.
 * @param existing 컬렉션에 이미 있는 하위 메뉴 (`listSubmenus`)
 */
export function checkSubmenuName(input: string, existing: readonly string[]): SubmenuNameCheck {
  const name = input.trim().normalize("NFC");
  if (name === "") return { ok: false, problem: "empty", message: "새 하위 메뉴 이름을 입력해 주세요." };
  if (name.startsWith(".") || name.endsWith(".")) {
    return {
      ok: false,
      problem: "dot",
      message: "하위 메뉴 이름은 점(.)으로 시작하거나 끝날 수 없어요. 이름을 바꿔 주세요.",
    };
  }
  if (UNSAFE_CHAR.test(name)) {
    return {
      ok: false,
      problem: "unsafe",
      message: '하위 메뉴 이름에 / \\ ? # % * : | " < > 같은 기호나 줄바꿈은 쓸 수 없어요. 이름을 바꿔 주세요.',
    };
  }
  if (new TextEncoder().encode(name).length > MAX_SLUG_BYTES) {
    return { ok: false, problem: "too-long", message: "하위 메뉴 이름이 너무 길어요. 더 짧게 입력해 주세요." };
  }
  const same = existing.find((submenu) => submenu.normalize("NFC") === name);
  if (same !== undefined) {
    return {
      ok: false,
      problem: "duplicate",
      message: `‘${same}’ 하위 메뉴가 이미 있어요. 새로 만들지 말고 목록에서 골라 주세요.`,
      existing: same,
    };
  }
  return { ok: true, name };
}

/**
 * 새 글의 파일 경로. 실제로 만드는 경로(createPost)와 새 글 화면이 미리 보여 주는 경로가 갈라지지 않게 둘 다 이것을 쓴다.
 * 하위 메뉴는 컬렉션 경로에 `{submenu}`가 있을 때만 쓰인다.
 */
export function newPostPath(collection: Collection, slug: string, submenu?: string): string {
  return compilePathPattern(collection.path).build({ slug, submenu });
}

/** 하위 메뉴 폴더의 경로. 경로 패턴에서 `{submenu}` 단계까지다. */
export function submenuFolder(collection: Collection, submenu: string): string {
  const segments = collection.path.split("/");
  return [...segments.slice(0, segments.indexOf("{submenu}")), submenu].join("/");
}
