import type { NextRequest } from "next/server";

import { readSession } from "@/app/_lib/session";
import { assertRepoAllowed } from "@/app/_lib/site";

import { imageResponse } from "./image-response";

export async function GET(request: NextRequest, ctx: RouteContext<"/repos/[owner]/[repo]/image">) {
  const { owner, repo: name } = await ctx.params;
  const repo = `${owner}/${name}`;
  await assertRepoAllowed(repo);
  // 이미지 요청은 갱신 라우트로 보낼 수 없으므로 남은 토큰으로 읽는다.
  const session = await readSession({ refresh: false });
  const { searchParams } = request.nextUrl;
  return imageResponse({
    repo,
    session,
    post: searchParams.get("post"),
    src: searchParams.get("src"),
    fetchFn: fetch,
  });
}
