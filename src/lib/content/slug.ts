// 새 글 화면이 입력하는 동안 폴더 이름을 보여 주려고 브라우저에서도 쓴다. GitHub 클라이언트를 import하지 않는다.

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
