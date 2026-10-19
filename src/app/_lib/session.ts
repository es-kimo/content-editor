import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readAuthConfig, REFRESH_ATTEMPTED_PARAM, REFRESH_PATH, resolvePageSession, SESSION_COOKIE } from "@/lib/auth";

export type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * 화면에서 쓸 access token. 로그인하지 않았으면 null.
 * 토큰이 만료됐으면 갱신 라우트로 보냈다가 `returnTo`로 돌아온다.
 */
export async function pageAccessToken(searchParams: SearchParams, returnTo: string): Promise<string | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const refreshAttempted = (await searchParams)[REFRESH_ATTEMPTED_PARAM] !== undefined;
  const page = resolvePageSession(cookie, readAuthConfig().sessionKey, Date.now(), refreshAttempted);
  if (page.kind === "anonymous") return null;
  if (page.kind === "refresh") redirect(`${REFRESH_PATH}?return_to=${encodeURIComponent(returnTo)}`);
  return page.session.accessToken;
}
