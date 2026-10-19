import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  readAuthConfig,
  REFRESH_ATTEMPTED_PARAM,
  REFRESH_PATH,
  resolvePageSession,
  SESSION_COOKIE,
  type PageSession,
} from "@/lib/auth";

export type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** 갱신 라우트를 거쳐 `returnTo`로 돌아오는 주소. */
export const refreshHref = (returnTo: string) => `${REFRESH_PATH}?return_to=${encodeURIComponent(returnTo)}`;

/**
 * 요청의 세션 쿠키를 해석한다.
 * 화면은 `searchParams`로 갱신 라우트를 이미 거쳐 왔는지 본다. 서버 액션(`refresh: false`)은 갱신 라우트로 보내면
 * 입력이 사라지므로 만료가 가까워도 남은 토큰을 쓴다.
 */
export async function readSession(options: { searchParams: SearchParams } | { refresh: false }): Promise<PageSession> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const refreshAttempted =
    "searchParams" in options ? (await options.searchParams)[REFRESH_ATTEMPTED_PARAM] !== undefined : true;
  return resolvePageSession(cookie, readAuthConfig().sessionKey, Date.now(), refreshAttempted);
}

/**
 * 화면에서 쓸 access token. 로그인하지 않았으면 null.
 * 토큰이 만료됐으면 갱신 라우트로 보냈다가 `returnTo`로 돌아온다.
 */
export async function pageAccessToken(searchParams: SearchParams, returnTo: string): Promise<string | null> {
  const page = await readSession({ searchParams });
  if (page.kind === "anonymous") return null;
  if (page.kind === "refresh") redirect(refreshHref(returnTo));
  return page.session.accessToken;
}
