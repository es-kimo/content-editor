import { describe, expect, test, vi } from "vitest";

import { REFRESH_PATH, type PageSession } from "@/lib/auth";
import { createGitHubClient, GitHubApiError } from "@/lib/github";
import { json, mockFetch, type Route } from "@/test/mock-fetch";

import { prepareRepoPage, sessionLogin, type RepoContext } from "./repo-page";

const REPO = "es-kimo/yjshd";
const RETURN_TO = "/repos/es-kimo/yjshd?collection=게시판";

const signedIn: PageSession = {
  kind: "ok",
  session: { accessToken: "token", accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null },
};

const CONFIG = JSON.stringify({
  branch: "main",
  collections: [{ name: "게시판", path: "content/4.게시판/{slug}/page.mdx", editor: "wysiwyg" }],
});

const configRoute =
  (res: () => Response): Route =>
  (url) =>
    url.pathname === `/repos/${REPO}/contents/editor.config.json` ? res() : undefined;

const prepare = (
  session: PageSession,
  routes: Route[],
  read: (context: RepoContext) => Promise<unknown> = async () => "읽음",
) => prepareRepoPage({ repo: REPO, session, returnTo: RETURN_TO, fetchFn: mockFetch(...routes), read });

describe("prepareRepoPage", () => {
  test("로그인했고 config가 있으면 config와 read 결과를 돌려준다", async () => {
    const read = vi.fn(async ({ config }: RepoContext) => config.collections[0].name);
    const page = await prepare(signedIn, [configRoute(() => new Response(CONFIG))], read);
    expect(page).toMatchObject({ kind: "ok", value: "게시판", config: { branch: "main" } });
  });

  test("로그인하지 않았으면 GitHub를 부르지 않고 로그인 링크를 보인다", async () => {
    expect(await prepare({ kind: "anonymous" }, [])).toEqual({ kind: "login" });
  });

  test("토큰이 만료됐으면 갱신 라우트를 거쳐 이 화면으로 돌아오게 한다", async () => {
    const page = await prepare({ kind: "refresh" }, []);
    if (page.kind !== "refresh") throw new Error(`refresh가 아니다: ${page.kind}`);
    const href = new URL(page.href, "https://editor.test");
    expect(href.pathname).toBe(REFRESH_PATH);
    expect(href.searchParams.get("return_to")).toBe(RETURN_TO);
  });

  test("config를 읽다가 401이면 로그인 링크를 보인다", async () => {
    const page = await prepare(signedIn, [configRoute(() => json({ message: "Bad credentials" }, 401))]);
    expect(page).toEqual({ kind: "login" });
  });

  test("글을 읽다가 401이면 로그인 링크를 보인다", async () => {
    const page = await prepare(signedIn, [configRoute(() => new Response(CONFIG))], async () => {
      throw new GitHubApiError("Bad credentials", 401);
    });
    expect(page).toEqual({ kind: "login" });
  });

  test("config가 없으면 레포 루트에 설정 파일을 추가하라고 안내한다", async () => {
    const page = await prepare(signedIn, [configRoute(() => json({ message: "Not Found" }, 404))]);
    expect(page).toEqual({
      kind: "config",
      message: `${REPO}에 편집 설정 파일(editor.config.json)이 없어요. 레포 루트에 파일을 추가해 주세요.`,
    });
  });

  test("config가 스키마에 맞지 않으면 오류 건수를 안내하고 글을 읽지 않는다", async () => {
    const read = vi.fn(async () => "읽음");
    const page = await prepare(signedIn, [configRoute(() => new Response(JSON.stringify({ branch: 1 })))], read);
    expect(page.kind).toBe("config");
    expect(read).not.toHaveBeenCalled();
  });

  test("config를 읽다가 401 말고 HTTP 오류가 나면 다시 열라고 안내하고 오류 원문은 기술 상세로 돌려준다", async () => {
    const page = await prepare(signedIn, [configRoute(() => json({ message: "Server Error" }, 500))]);
    if (page.kind !== "config") throw new Error(`config가 아니다: ${page.kind}`);
    expect(page.message).toBe("레포의 편집 설정을 읽지 못했어요. 잠시 뒤 다시 열어 주세요.");
    expect(page.detail).toContain("HTTP 500");
  });

  test("글을 읽다가 401 말고 오류가 나면 그대로 던진다", async () => {
    const failure = new GitHubApiError("Server Error", 500);
    const page = prepare(signedIn, [configRoute(() => new Response(CONFIG))], async () => {
      throw failure;
    });
    await expect(page).rejects.toBe(failure);
  });
});

describe("sessionLogin", () => {
  const login = (res: () => Response) =>
    sessionLogin(
      createGitHubClient(
        "token",
        mockFetch((url) => (url.pathname === "/user" ? res() : undefined)),
      ),
    );

  test("세션의 토큰으로 읽은 GitHub 사용자 login을 돌려준다", async () => {
    expect(await login(() => json({ login: "alice", name: null, avatar_url: "", html_url: "" }))).toBe("alice");
  });

  test("사용자를 읽다가 401 말고 오류가 나면 화면을 막지 않고 null을 돌려준다", async () => {
    expect(await login(() => json({ message: "Server Error" }, 500))).toBeNull();
  });

  test("토큰이 거부되면 다시 로그인하게 던진다", async () => {
    await expect(login(() => json({ message: "Bad credentials" }, 401))).rejects.toBeInstanceOf(GitHubApiError);
  });
});
