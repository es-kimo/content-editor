import Link from "next/link";
import { Fragment, Suspense } from "react";

import { LoginLink, repoHref } from "@/app/_lib/repo";
import { pageAccessToken, type SearchParams } from "@/app/_lib/session";
import { pageSiteScope } from "@/app/_lib/site";
import { loadAccount, type Account } from "@/lib/auth";
import { CONFIG_FILE, loadEditorConfig, type LoadedConfig } from "@/lib/editor-config";
import { GitHubApiError, isUnauthorized } from "@/lib/github";
import { resolveRepoAccess, type RepoAccess } from "@/lib/sites";

type Repository = Account["installations"][number]["repositories"][number];

export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16 font-sans">
      <h1 className="text-2xl font-semibold">content-editor</h1>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <AccountSection searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function AccountSection({ searchParams }: { searchParams: SearchParams }) {
  const accessToken = await pageAccessToken(searchParams, "/");
  if (!accessToken) return <LoginLink />;

  let account: Account;
  try {
    account = await loadAccount(accessToken, fetch);
  } catch (e) {
    if (isUnauthorized(e)) return <LoginLink />;
    throw e;
  }
  const access = resolveRepoAccess(
    await pageSiteScope(),
    account.installations.flatMap((i) => i.repositories),
  );
  return <AccountView user={account.user} access={access} accessToken={accessToken} />;
}

function AccountView({
  user,
  access,
  accessToken,
}: {
  user: Account["user"];
  access: RepoAccess<Repository>;
  accessToken: string;
}) {
  return (
    <>
      <section className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- GitHub 아바타 도메인을 이미지 최적화에 등록하지 않았다 */}
        <img src={user.avatar_url} alt="" width={40} height={40} className="rounded-full" />
        <div className="flex flex-col">
          <a href={user.html_url} className="font-medium">
            {user.name ?? user.login}
          </a>
          <span className="text-sm text-zinc-500">@{user.login}</span>
        </div>
        <form action="/api/auth/logout" method="post" className="ml-auto">
          <button type="submit" className="text-sm text-zinc-500 underline">
            로그아웃
          </button>
        </form>
      </section>
      <RepoSection access={access} accessToken={accessToken} />
    </>
  );
}

function RepoSection({ access, accessToken }: { access: RepoAccess<Repository>; accessToken: string }) {
  switch (access.kind) {
    case "forbidden":
      return (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">{access.repo}</h2>
          <p className="text-red-600">
            이 계정은 {access.repo}에 접근할 권한이 없다. 레포 관리자에게 권한을 요청하거나 다른 계정으로 로그인한다.
          </p>
        </section>
      );
    case "pinned":
      // 도메인에 레포가 고정돼 있으므로 레포 목록 없이 그 레포만 보인다.
      return (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">{access.repo.full_name}</h2>
          <RepoItem repo={access.repo} accessToken={accessToken} />
        </section>
      );
    case "all":
      return (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">접근 가능한 레포</h2>
          {access.repos.length === 0 ? (
            <p className="text-zinc-500">이 앱이 설치된 레포 중 접근할 수 있는 것이 없다.</p>
          ) : (
            <ul className="list-disc pl-5">
              {access.repos.map((r) => (
                <li key={r.id}>
                  <a href={r.html_url}>{r.full_name}</a>
                  {r.private && <span className="ml-2 text-xs text-zinc-500">private</span>}
                  <RepoItem repo={r} accessToken={accessToken} />
                </li>
              ))}
            </ul>
          )}
        </section>
      );
  }
}

function RepoItem({ repo, accessToken }: { repo: Repository; accessToken: string }) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">{CONFIG_FILE} 확인 중…</p>}>
      <ConfigStatus repo={repo.full_name} accessToken={accessToken} />
    </Suspense>
  );
}

async function ConfigStatus({ repo, accessToken }: { repo: string; accessToken: string }) {
  let loaded: LoadedConfig;
  try {
    loaded = await loadEditorConfig(repo, accessToken, fetch);
  } catch (e) {
    if (e instanceof GitHubApiError) return <p className="text-sm text-red-600">{e.message}</p>;
    throw e;
  }
  switch (loaded.kind) {
    case "missing":
      return <p className="text-sm text-zinc-500">레포 루트에 {CONFIG_FILE}이 없다.</p>;
    case "ok":
      return (
        <p className="text-sm text-zinc-500">
          브랜치 {loaded.config.branch} · 컬렉션{" "}
          {loaded.config.collections.map((c, i) => (
            <Fragment key={c.name}>
              {i > 0 && ", "}
              <Link href={repoHref(repo, c.name)} className="underline">
                {c.name}
              </Link>
            </Fragment>
          ))}
        </p>
      );
    case "invalid":
      return (
        <div className="text-sm text-red-600">
          <p>
            {CONFIG_FILE} 오류 {loaded.issues.length}건
          </p>
          <ul className="list-disc pl-5">
            {loaded.issues.map((issue, i) => (
              <li key={i}>
                {issue.path && <code className="mr-2">{issue.path}</code>}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      );
  }
}
