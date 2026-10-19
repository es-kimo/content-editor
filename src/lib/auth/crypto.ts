import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** base64url로 인코딩된 32바이트 키를 읽는다. 길이가 맞지 않으면 예외. */
export function parseKey(secret: string): Buffer {
  const key = Buffer.from(secret, "base64url");
  if (key.length !== 32) throw new Error(`SESSION_SECRET은 base64url 32바이트여야 한다 (현재 ${key.length}바이트)`);
  return key;
}

/** 평문을 AES-256-GCM으로 암호화해 `iv | tag | 암호문`을 base64url 한 덩어리로 돌려준다. */
export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** `seal`의 역. 형식이 틀리거나 인증 태그가 맞지 않으면(변조·다른 키) `null`. */
export function unseal(sealed: string, key: Buffer): string | null {
  const raw = Buffer.from(sealed, "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) return null;
  const decipher = createDecipheriv(ALGORITHM, key, raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
