import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type BrowserContext } from "playwright-core";

import { parseKey } from "@/lib/auth/crypto";
import { encodeSession, SESSION_COOKIE } from "@/lib/auth/session";
import { fakeGitRepo } from "@/test/fake-git";
import { fakeGitHub, type FakeFile } from "@/test/fake-github";

const ROOT = path.resolve(import.meta.dirname, "..");
const GITHUB = "https://api.github.com";

/** 가짜 GitHub 서버. 쓰기와 브랜치 상태는 `fakeGitRepo`, 글 목록이 읽는 GraphQL은 처음 파일로 `fakeGitHub`가 답한다. */
async function startGitHub(repo: string, files: FakeFile[]) {
  const git = fakeGitRepo(repo, "main", files);
  const graphql = fakeGitHub(repo, "main", files);
  const config = String(files.find((f) => f.path === "editor.config.json")!.content);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = new URL(req.url ?? "/", GITHUB);
    const init = { method: req.method, body: chunks.length > 0 ? Buffer.concat(chunks).toString() : undefined };
    let response: Response;
    try {
      if (url.pathname === "/graphql") response = await graphql(url, init);
      else if (url.pathname === `/repos/${repo}/contents/editor.config.json`) response = new Response(config);
      else response = await git.fetch(url, init);
    } catch (error) {
      response = Response.json({ message: String(error) }, { status: 500 });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { git, server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** 빌드한 앱(`next start`)을 띄운다. 서버의 GitHub 요청은 `e2e/github-proxy.mjs`가 가짜 GitHub로 돌린다. */
async function startNext(github: string, sessionSecret: string) {
  const port = 3100 + Math.floor(Math.random() * 800);
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", `${port}`],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_OPTIONS: `--import ${pathToFileURL(path.join(ROOT, "e2e/github-proxy.mjs"))}`,
        E2E_GITHUB_URL: github,
        SESSION_SECRET: sessionSecret,
        GITHUB_APP_CLIENT_ID: "e2e",
        GITHUB_APP_CLIENT_SECRET: "e2e",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout?.on("data", (chunk) => (log += chunk));
  child.stderr?.on("data", (chunk) => (log += chunk));
  const origin = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`next start가 끝났다:\n${log}`);
    try {
      await fetch(origin);
      return { child, origin, log: () => log };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`next start가 뜨지 않았다:\n${log}`);
}

export type App = {
  origin: string;
  browser: Browser;
  /** 로그인한 브라우저 창 묶음. 테스트마다 새로 만든다. */
  context(): Promise<BrowserContext>;
  /** 가짜 레포의 브랜치 커밋 수. 처음 커밋을 포함한다. */
  commits(): number;
  /** 가짜 레포 브랜치 끝의 파일 내용. 없으면 undefined. */
  file(path: string): string | undefined;
  /** 앱 밖에서 파일을 고친 커밋을 브랜치에 더한다. 글을 연 뒤 다른 곳에서 고친 충돌을 만든다. */
  pushElsewhere(path: string, content: string): void;
  close(): Promise<void>;
};

/** 가짜 GitHub 레포 `repo`를 연 앱과 Chrome을 띄운다. Chrome 위치는 `CHROME_PATH`로 바꿀 수 있다. */
export async function startApp(repo: string, files: FakeFile[]): Promise<App> {
  if (!existsSync(path.join(ROOT, ".next/BUILD_ID"))) throw new Error("먼저 pnpm build로 앱을 빌드한다.");
  const secret = randomBytes(32).toString("base64url");
  const github = await startGitHub(repo, files);
  let next: { child: ChildProcess; origin: string } | null = null;
  let browser: Browser | null = null;
  const close = async () => {
    await browser?.close();
    next?.child.kill();
    await new Promise((resolve) => (github.server as Server).close(resolve));
  };
  try {
    next = await startNext(github.url, secret);
    browser = await chromium.launch(
      process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
    );
  } catch (error) {
    await close();
    throw error;
  }
  const { origin } = next;
  const session = encodeSession(
    { accessToken: "ghu_e2e", accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null },
    parseKey(secret),
  );
  const opened = browser;
  return {
    origin,
    browser: opened,
    async context() {
      const context = await opened.newContext();
      await context.addCookies([{ name: SESSION_COOKIE, value: session, url: origin }]);
      return context;
    },
    commits: () => github.git.log().length,
    file(path) {
      const content = github.git.file(path);
      return content && new TextDecoder().decode(content);
    },
    pushElsewhere(path, content) {
      github.git.pushElsewhere([{ path, content }]);
    },
    close,
  };
}
