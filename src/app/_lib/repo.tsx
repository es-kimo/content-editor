import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { LeaveLink } from "@/app/_lib/leave";
import { prepareRepoPage, type RepoContext } from "@/app/_lib/repo-page";
import { readSession, type SearchParams } from "@/app/_lib/session";
import { assertRepoAllowed } from "@/app/_lib/site";
import { PRIMARY_BUTTON_CLASS, TechDetails } from "@/app/_lib/ui";
import type { Collection, EditorConfig } from "@/lib/editor-config";

export function LoginLink() {
  return (
    <a href="/api/auth/login" className={PRIMARY_BUTTON_CLASS}>
      GitHub로 로그인
    </a>
  );
}

export const repoHref = (repo: string, collection?: string) =>
  `/repos/${repo}` + (collection === undefined ? "" : `?${new URLSearchParams({ collection })}`);

export const postHref = (repo: string, path: string) => `/repos/${repo}/post?${new URLSearchParams({ path })}`;

export const newPostHref = (repo: string, collection?: string) =>
  `/repos/${repo}/new` + (collection === undefined ? "" : `?${new URLSearchParams({ collection })}`);

/** 글 분류 탭. 고른 글 분류는 `aria-current`로 반전한다. 편집 화면에서는 미저장 입력을 잃기 전에 묻는다. */
export function CollectionTabs({
  config,
  current,
  href,
}: {
  config: EditorConfig;
  current: Collection;
  href: (collection: string) => string;
}) {
  return (
    <nav aria-label="글 분류" className="flex flex-wrap items-center gap-2">
      <span aria-hidden className="text-sm text-zinc-500">
        글 분류
      </span>
      {config.collections.map((c) => (
        <LeaveLink
          key={c.name}
          href={href(c.name)}
          aria-current={c === current ? "page" : undefined}
          className="rounded border px-3 py-1 text-sm aria-[current=page]:bg-black aria-[current=page]:text-white dark:aria-[current=page]:bg-white dark:aria-[current=page]:text-black"
        >
          {c.name}
        </LeaveLink>
      ))}
    </nav>
  );
}

/**
 * 레포 화면의 준비 과정: 레포 허용 확인 → 세션 → config → `read`. 그릴 수 없으면 화면에 보일 안내를 돌려준다.
 * 토큰이 만료됐으면 갱신 라우트로 보냈다가 `returnTo`로 돌아온다.
 */
export async function openRepoPage<T>(
  repo: string,
  searchParams: SearchParams,
  returnTo: string,
  read: (context: RepoContext) => Promise<T>,
): Promise<{ ok: true; config: EditorConfig; value: T } | { ok: false; view: ReactNode }> {
  await assertRepoAllowed(repo);
  const session = await readSession({ searchParams });
  const page = await prepareRepoPage({ repo, session, returnTo, fetchFn: fetch, read });
  switch (page.kind) {
    case "refresh":
      redirect(page.href);
    case "login":
      return { ok: false, view: <LoginLink /> };
    case "config":
      return {
        ok: false,
        view: (
          <div className="flex flex-col gap-2">
            <p className="text-red-600">{page.message}</p>
            <Link href="/" className="text-sm underline">
              처음으로
            </Link>
            {page.detail && <TechDetails items={[["오류 원문", page.detail]]} />}
          </div>
        ),
      };
    case "ok":
      return { ok: true, config: page.config, value: page.value };
  }
}
