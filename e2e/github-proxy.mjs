// 브라우저 실행 검증(`pnpm e2e`)에서 Next 서버를 띄울 때 `--import`로 먼저 읽는다.
// 서버의 GitHub API 요청을 가짜 GitHub(E2E_GITHUB_URL)로 돌린다. 다른 요청은 그대로 보낸다.
const GITHUB = "https://api.github.com";
const target = process.env.E2E_GITHUB_URL;
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!target || !url.startsWith(GITHUB)) return realFetch(input, init);
  const proxied = target + url.slice(GITHUB.length);
  return input instanceof Request ? realFetch(new Request(proxied, input), init) : realFetch(proxied, init);
};
