import { connection, type NextRequest } from "next/server";

import { handleLogin, readAuthConfig } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // Cache Components에서 GET 핸들러는 빌드 때 프리렌더를 시도한다. 환경변수를 읽기 전에 요청 시점으로 미룬다.
  await connection();
  return handleLogin(request, readAuthConfig());
}
