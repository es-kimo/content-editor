/**
 * 봇 GitHub App의 설치 토큰을 출력한다. 이 레포에만 쓸 수 있고 1시간 뒤 만료된다.
 * `login`을 주면 토큰 대신 앱이 코멘트·커밋할 때 쓰는 이름(<slug>[bot])을 출력한다.
 *
 *   node scripts/planner/app-token.mts [login]
 *
 * env: APP_ID, APP_PRIVATE_KEY(PEM), REPO
 */
import { appJwt, createGitHub } from "./github.mts";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`env ${name}가 없다`);
  return value;
};

const repo = env("REPO");
const app = createGitHub(appJwt(env("APP_ID"), env("APP_PRIVATE_KEY")));

if (process.argv[2] === "login") {
  const { slug } = await app.request<{ slug: string }>("/app");
  console.log(`${slug}[bot]`);
} else {
  const installation = await app.request<{ id: number }>(`/repos/${repo}/installation`);
  const { token } = await app.request<{ token: string }>(`/app/installations/${installation.id}/access_tokens`, {
    method: "POST",
    body: { repositories: [repo.split("/")[1]] },
  });
  console.log(token);
}
