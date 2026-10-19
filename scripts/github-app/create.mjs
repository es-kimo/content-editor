/**
 * github-app/manifest.json으로 GitHub App을 만드는 1회성 로컬 서버 (GitHub App Manifest 흐름).
 *
 *   node scripts/github-app/create.mjs   → http://localhost:8787/ 을 브라우저로 연다
 *
 * 1. / 가 manifest를 github.com/settings/apps/new로 POST한다. GitHub 화면에서 앱을 만든다.
 * 2. GitHub이 /callback?code= 로 돌려보내면 code를 /app-manifests/{code}/conversions로 교환한다 (1시간 안).
 * 3. 비밀값을 레포 루트의 .env.local과 github-app.private-key.pem에 권한 600으로 쓰고 종료한다.
 *    두 파일은 .gitignore 대상이다. 비밀값은 출력하지 않는다. 이미 있으면 덮어쓰지 않고 중단한다.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = 8787;
const ROOT = path.resolve(import.meta.dirname, "../..");
const ENV_PATH = path.join(ROOT, ".env.local");
const PEM_PATH = path.join(ROOT, "github-app.private-key.pem");

for (const file of [ENV_PATH, PEM_PATH]) {
  if (existsSync(file)) {
    console.error(`${path.relative(ROOT, file)}이 이미 있다. 덮어쓰지 않도록 옮기거나 지운 뒤 다시 실행한다.`);
    process.exit(1);
  }
}

const state = randomBytes(16).toString("hex");
const manifest = {
  ...JSON.parse(readFileSync(path.join(ROOT, "github-app/manifest.json"), "utf8")),
  redirect_url: `http://localhost:${PORT}/callback`,
};

const escape = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const page = `<!doctype html><meta charset="utf-8"><title>GitHub App 만들기</title>
<p>GitHub로 이동 중…</p>
<form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"></form>
<script>document.getElementById("f").submit()</script>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
    return;
  }
  if (url.pathname !== "/callback") return res.writeHead(404).end();
  if (url.searchParams.get("state") !== state) return res.writeHead(400).end("state mismatch");

  const r = await fetch(`https://api.github.com/app-manifests/${url.searchParams.get("code")}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!r.ok) {
    console.error(`code 교환 실패: HTTP ${r.status}`);
    res.writeHead(500).end(`code exchange failed: HTTP ${r.status}`);
    return server.close();
  }
  const app = await r.json();
  writeFileSync(PEM_PATH, app.pem, { mode: 0o600 });
  const env = [
    `GITHUB_APP_ID=${app.id}`,
    `GITHUB_APP_SLUG=${app.slug}`,
    `GITHUB_APP_CLIENT_ID=${app.client_id}`,
    `GITHUB_APP_CLIENT_SECRET=${app.client_secret}`,
    `GITHUB_APP_PRIVATE_KEY_PATH=${path.basename(PEM_PATH)}`,
    `SESSION_SECRET=${randomBytes(32).toString("base64url")}`,
  ];
  writeFileSync(ENV_PATH, env.join("\n") + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ id: app.id, slug: app.slug, client_id: app.client_id, html_url: app.html_url }));
  res
    .writeHead(200, { "content-type": "text/html; charset=utf-8" })
    .end(`<p>Created <b>${escape(app.slug)}</b>.</p><p><a href="${app.html_url}/installations/new">Install it</a></p>`);
  server.close();
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}/ 을 브라우저로 연다`));
