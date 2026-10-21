import { prepareRepoPage } from "@/app/_lib/repo-page";
import type { PageSession } from "@/lib/auth";
import { readRepoImage } from "@/lib/content";

/** SVG 주소를 문서로 열어도 스크립트가 돌지 않게, 오류 응답까지 모든 응답에 붙인다. */
const SAFE_HEADERS = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" };

const status = (code: 401 | 404) => new Response(null, { status: code, headers: SAFE_HEADERS });

/**
 * 레포 이미지 라우트의 응답. 로그인하지 않았거나 토큰을 쓸 수 없으면 401, 설정·글·파일을 읽을 수 없으면 404.
 * 남의 비공개 레포 내용이 공유 캐시에 남지 않게 저장하지 않는다.
 */
export async function imageResponse({
  repo,
  session,
  post,
  src,
  fetchFn,
}: {
  repo: string;
  session: PageSession;
  post: string | null;
  src: string | null;
  fetchFn: typeof fetch;
}): Promise<Response> {
  if (session.kind !== "ok") return status(401);
  if (post === null || src === null) return status(404);

  const page = await prepareRepoPage({
    repo,
    session,
    // 갱신 라우트로 보내지 않으므로 돌아올 주소는 쓰이지 않는다.
    returnTo: "",
    fetchFn,
    read: ({ client, config }) => readRepoImage(client, repo, config, post, src),
  });
  if (page.kind === "login" || page.kind === "refresh") return status(401);
  if (page.kind === "config" || !page.value.ok) return status(404);

  return new Response(page.value.bytes, {
    headers: { ...SAFE_HEADERS, "Content-Type": page.value.contentType, "Cache-Control": "private, no-store" },
  });
}
