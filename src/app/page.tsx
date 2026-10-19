import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment, Suspense } from "react";

import { LoginLink, repoHref } from "@/app/_lib/repo";
import {
  GitHubAuthError,
  loadAccount,
  readAuthConfig,
  REFRESH_ATTEMPTED_PARAM,
  REFRESH_PATH,
  resolvePageSession,
  SESSION_COOKIE,
  type Account,
} from "@/lib/auth";
import { CONFIG_FILE, ConfigLoadError, loadEditorConfig, type LoadedConfig } from "@/lib/editor-config";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

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

async function readPageSession(searchParams: SearchParams) {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const refreshAttempted = (await searchParams)[REFRESH_ATTEMPTED_PARAM] !== undefined;
  return resolvePageSession(cookie, readAuthConfig().sessionKey, Date.now(), refreshAttempted);
}

async function AccountSection({ searchParams }: { searchParams: SearchParams }) {
  const page = await readPageSession(searchParams);
  if (page.kind === "anonymous") return <LoginLink />;
  if (page.kind === "refresh") redirect(`${REFRESH_PATH}?return_to=/`);

  let account: Account;
  try {
    account = await loadAccount(page.session.accessToken, fetch);
  } catch (e) {
    // 토큰이 폐기됐거나 앱 권한이 해제된 경우다. 다시 로그인하게 한다.
    if (e instanceof GitHubAuthError && e.status === 401) return <LoginLink />;
    throw e;
  }
  return <AccountView account={account} accessToken={page.session.accessToken} />;
}

function AccountView({ account, accessToken }: { account: Account; accessToken: string }) {
  const { user, installations } = account;
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
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">접근 가능한 레포</h2>
        {installations.length === 0 ? (
          <p className="text-zinc-500">이 앱이 설치된 레포 중 접근할 수 있는 것이 없다.</p>
        ) : (
          <ul className="list-disc pl-5">
            {installations.flatMap((i) =>
              i.repositories.map((r) => (
                <li key={r.id}>
                  <a href={r.html_url}>{r.full_name}</a>
                  {r.private && <span className="ml-2 text-xs text-zinc-500">private</span>}
                  <Suspense fallback={<p className="text-sm text-zinc-500">{CONFIG_FILE} 확인 중…</p>}>
                    <ConfigStatus repo={r.full_name} accessToken={accessToken} />
                  </Suspense>
                </li>
              )),
            )}
          </ul>
        )}
      </section>
    </>
  );
}

async function ConfigStatus({ repo, accessToken }: { repo: string; accessToken: string }) {
  let loaded: LoadedConfig;
  try {
    loaded = await loadEditorConfig(repo, accessToken, fetch);
  } catch (e) {
    if (e instanceof ConfigLoadError) return <p className="text-sm text-red-600">{e.message}</p>;
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
