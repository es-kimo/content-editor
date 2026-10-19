import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { allowsRepo, siteForHeaders, type SiteScope } from "@/lib/sites";

/** 이 요청의 Host로 고른 사이트. */
export async function pageSiteScope(): Promise<SiteScope> {
  return siteForHeaders(await headers());
}

/** 도메인에 고정된 레포가 아닌 레포 화면은 처음 화면으로 돌려보낸다. */
export async function assertRepoAllowed(repo: string): Promise<void> {
  if (!allowsRepo(await pageSiteScope(), repo)) redirect("/");
}
