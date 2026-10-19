import { randomBytes, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import type { AuthConfig } from "./config";
import { authorizeUrl, exchangeCode, GitHubAuthError, type Fetch, type Warn } from "./github";
import { ensureFreshSession } from "./refresh";
import {
  baseCookieOptions,
  decodeSession,
  encodeSession,
  SESSION_COOKIE,
  sessionMaxAge,
  STATE_COOKIE,
  type Session,
} from "./session";

export type HandlerDeps = { fetch: Fetch; now: number; warn: Warn };

export const CALLBACK_PATH = "/api/auth/callback";
export const REFRESH_PATH = "/api/auth/refresh";

/** GitHub 인가 화면에 머무를 수 있는 시간. 이보다 늦은 콜백은 state 쿠키가 없어 거부된다. */
const STATE_MAX_AGE_S = 10 * 60;

const text = (body: string, status: number) =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

function setSessionCookie(res: NextResponse, session: Session, config: AuthConfig, now: number) {
  res.cookies.set(SESSION_COOKIE, encodeSession(session, config.sessionKey), {
    ...baseCookieOptions,
    maxAge: sessionMaxAge(session, now),
  });
}

function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { ...baseCookieOptions, maxAge: 0 });
}

function statesMatch(expected: string | undefined, actual: string | null): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 같은 사이트 경로만 받는다. `//evil.com` 같은 프로토콜 상대 URL로 밖으로 보내지 않기 위해서다. */
export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

export function handleLogin(request: NextRequest, config: AuthConfig): NextResponse {
  const state = randomBytes(32).toString("base64url");
  const res = NextResponse.redirect(
    authorizeUrl({ clientId: config.clientId, redirectUri: request.nextUrl.origin + CALLBACK_PATH, state }),
  );
  res.cookies.set(STATE_COOKIE, state, { ...baseCookieOptions, path: CALLBACK_PATH, maxAge: STATE_MAX_AGE_S });
  return res;
}

export async function handleCallback(request: NextRequest, config: AuthConfig, deps: HandlerDeps) {
  const params = request.nextUrl.searchParams;
  const error = params.get("error");
  if (error) return text(`GitHub 로그인이 취소되었거나 실패했다: ${error}`, 400);
  if (!statesMatch(request.cookies.get(STATE_COOKIE)?.value, params.get("state"))) {
    return text("state가 일치하지 않는다. 로그인을 처음부터 다시 시도한다.", 400);
  }
  const code = params.get("code");
  if (!code) return text("code가 없다", 400);

  let session: Session;
  try {
    session = await exchangeCode(config, { code, redirectUri: request.nextUrl.origin + CALLBACK_PATH }, deps);
  } catch (e) {
    if (!(e instanceof GitHubAuthError)) throw e;
    deps.warn(e.message);
    return text("GitHub 토큰 교환에 실패했다", 502);
  }

  const res = NextResponse.redirect(new URL("/", request.nextUrl.origin));
  setSessionCookie(res, session, config, deps.now);
  res.cookies.set(STATE_COOKIE, "", { ...baseCookieOptions, path: CALLBACK_PATH, maxAge: 0 });
  return res;
}

/** 서버 컴포넌트는 쿠키를 쓸 수 없어서, 갱신이 필요한 화면은 이 경로를 거쳐 돌아온다. */
export async function handleRefresh(request: NextRequest, config: AuthConfig, deps: HandlerDeps) {
  const returnTo = new URL(safeReturnTo(request.nextUrl.searchParams.get("return_to")), request.nextUrl.origin);
  const res = NextResponse.redirect(returnTo);
  const session = decodeSession(request.cookies.get(SESSION_COOKIE)?.value, config.sessionKey);
  if (!session) {
    clearSessionCookie(res);
    return res;
  }
  const result = await ensureFreshSession(session, config, deps);
  if (result.kind === "expired") clearSessionCookie(res);
  else if (result.kind === "refreshed") setSessionCookie(res, result.session, config, deps.now);
  return res;
}

export function handleLogout(request: NextRequest): NextResponse {
  // POST 폼 제출 뒤 GET으로 첫 화면을 다시 불러오도록 303을 쓴다.
  const res = NextResponse.redirect(new URL("/", request.nextUrl.origin), 303);
  clearSessionCookie(res);
  return res;
}
