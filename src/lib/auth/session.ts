import { seal, unseal } from "./crypto";

/** 시각은 모두 epoch 밀리초. 만료 시각이 `null`이면 만료 없는 토큰이다. */
export type Session = {
  accessToken: string;
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
};

export const SESSION_COOKIE = "ce_session";
export const STATE_COOKIE = "ce_oauth_state";

/** access token 만료까지 이만큼 남으면 미리 갱신한다. 요청 도중에 만료되지 않게 하려는 여유다. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** refresh token도 만료가 없을 때 쿠키를 유지할 기간. */
const NON_EXPIRING_MAX_AGE_S = 180 * 24 * 60 * 60;

export const baseCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

export function encodeSession(session: Session, key: Buffer): string {
  return seal(JSON.stringify(session), key);
}

const isNullableNumber = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const isNullableString = (v: unknown) => v === null || typeof v === "string";

/** 쿠키 값을 복호화한다. 변조·다른 키·형식 불일치는 모두 `null`. */
export function decodeSession(value: string | undefined, key: Buffer): Session | null {
  if (!value) return null;
  const json = unseal(value, key);
  if (json === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const s = data as Record<string, unknown>;
  if (
    typeof s.accessToken !== "string" ||
    !isNullableNumber(s.accessTokenExpiresAt) ||
    !isNullableString(s.refreshToken) ||
    !isNullableNumber(s.refreshTokenExpiresAt)
  ) {
    return null;
  }
  return {
    accessToken: s.accessToken,
    accessTokenExpiresAt: s.accessTokenExpiresAt as number | null,
    refreshToken: s.refreshToken as string | null,
    refreshTokenExpiresAt: s.refreshTokenExpiresAt as number | null,
  };
}

/** access token 만료가 `REFRESH_MARGIN_MS` 안으로 들어왔거나 지났는가. */
export function needsRefresh(session: Session, now: number): boolean {
  return session.accessTokenExpiresAt !== null && session.accessTokenExpiresAt - now <= REFRESH_MARGIN_MS;
}

/** 세션 쿠키의 수명(초). refresh token이 살아 있는 동안만 쿠키를 유지한다. */
export function sessionMaxAge(session: Session, now: number): number {
  const until = session.refreshToken ? session.refreshTokenExpiresAt : session.accessTokenExpiresAt;
  if (until === null) return NON_EXPIRING_MAX_AGE_S;
  return Math.max(0, Math.floor((until - now) / 1000));
}
