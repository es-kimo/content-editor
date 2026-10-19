import { parseKey } from "./crypto";

export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  sessionKey: Buffer;
};

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`환경변수 ${name}이(가) 없다`);
  return value;
}

export function readAuthConfig(env: Env = process.env): AuthConfig {
  return {
    clientId: required(env, "GITHUB_APP_CLIENT_ID"),
    clientSecret: required(env, "GITHUB_APP_CLIENT_SECRET"),
    sessionKey: parseKey(required(env, "SESSION_SECRET")),
  };
}
