# content-editor

Git 레포에 있는 MDX 글을 웹에서 쓰고 고치면 그 레포에 바로 커밋해 주는 에디터.

- [PRD](https://github.com/es-kimo/content-editor/wiki/PRD)
- [작업 방식](https://github.com/es-kimo/content-editor/wiki/작업-방식)

## 개발

Node 22, pnpm 9.12.3

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

| 명령                | 내용                                    |
| ------------------- | --------------------------------------- |
| `pnpm lint`         | ESLint                                  |
| `pnpm format`       | Prettier로 전체 포맷                    |
| `pnpm format:check` | 포맷 검사 (CI)                          |
| `pnpm typecheck`    | 라우트 타입 생성(`next typegen`) 후 tsc |
| `pnpm test`         | Vitest (`src/**/*.test.ts`)             |
| `pnpm build`        | 프로덕션 빌드                           |

PR마다 GitHub Actions가 `lint`, `format:check`, `typecheck`, `fixtures:sync`, `test`, `build`를 돌린다.

## 테스트 픽스처

mdx-doc은 실제 사이트 글 전체로 테스트한다. 대상 레포·커밋·기대 글 수는 `fixtures.config.json`에 고정한다.

```bash
pnpm fixtures:sync   # fixtures/<name>/ 아래에 page.mdx를 받는다 (gitignore)
```

- 토큰은 `GITHUB_TOKEN` 환경변수, 없으면 `gh auth token`을 쓴다.
- yjshd는 private 레포라 글을 이 공개 레포에 커밋하지 않는다. 읽을 권한이 없으면 받지 않고, 그 소스의 테스트는 건너뛴다.
- CI에서 yjshd까지 테스트하려면 `es-kimo/yjshd`에 Contents read 권한이 있는 fine-grained PAT를 레포 시크릿 `FIXTURES_TOKEN`으로 등록한다.
- 기준 커밋을 올리려면 `fixtures.config.json`의 `ref`와 `expected`를 고치고 다시 받는다.

## 구조

| 경로              | 내용                                              |
| ----------------- | ------------------------------------------------- |
| `src/app`         | UI (Next.js App Router)                           |
| `src/lib/mdx-doc` | MDX 파일 분해/조립. UI와 GitHub에 의존하지 않는다 |
| `src/lib/github`  | GitHub API (로그인, 읽기, 커밋)                   |

`AGENTS.md`는 Next.js가 생성·관리하는 에이전트용 안내다. 이 버전의 Next.js API는 `node_modules/next/dist/docs/`를 기준으로 확인한다.

## 무인 에이전트 루프

밤 시간대(01:00~06:30 KST)에 에이전트가 이슈를 하나씩 구현하고, 리뷰·수정을 거쳐 merge한다.

```
Agent implement (30분마다)  다음 이슈 1개 → agent/<이슈>-<실행> 브랜치 → 구현 → PR(label: agent)
CI                           check + guard (agent/ 브랜치의 금지 변경 검사)
Agent review (CI 완료 시)   실패: 로그로 수정 / 통과: 독립 리뷰 → 승인이면 auto-merge, 아니면 수정
Agent report (07:00 KST)    지난 24시간 결과를 `agent-report` 이슈에 코멘트
```

- 고르는 이슈: 마일스톤 `AGENT_MILESTONES`에 속하고, 의존 이슈가 모두 닫혔고, `needs-human`·`blocked`·`spike`·`in progress` 라벨이 없는 것
- 동시에 열린 에이전트 PR은 1개. 수정이 `AGENT_MAX_FIX`회를 넘거나 막히면 `needs-human`을 달고 멈춘다
- 사용량 한도로 멈춘 실행은 실패로 세지 않는다. 구현은 다음 cron이 다시 고르고, 리뷰·수정은 PR에 `agent-retry`를 달아 다음 cron이 다시 돌린다 (`scripts/agent/classify.mts`가 실행 기록으로 판단)
- 규칙: `CLAUDE.md`, 역할별 지시: `.github/agent/*.md`

| 설정                                                                  | 종류     | 값                                                                                              |
| --------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN`                                             | secret   | `claude setup-token` (구독 사용)                                                                |
| `AGENT_GH_TOKEN`                                                      | secret   | fine-grained PAT, 이 레포만, Contents·Pull requests·Issues 쓰기. Workflows 권한은 주지 않는다   |
| `AGENT_ENABLED`                                                       | variable | `true`일 때만 돈다 (끄는 스위치)                                                                |
| `AGENT_MILESTONES`                                                    | variable | 기본 `M1 mdx-doc,M2 GitHub 연동,M3 편집 UI`                                                     |
| `AGENT_MAX_PRS_PER_NIGHT`                                             | variable | 기본 `4`                                                                                        |
| `AGENT_MAX_FIX` / `AGENT_MAX_ATTEMPTS`                                | variable | 기본 `2` / `2`                                                                                  |
| `AGENT_MODEL`                                                         | variable | 기본 `claude-opus-5-5`. 쓸 수 없으면 `sonnet`으로 fallback. 실제 모델은 PR·리뷰 코멘트에 남는다 |
| `AGENT_EFFORT_IMPLEMENT` / `AGENT_EFFORT_REVIEW` / `AGENT_EFFORT_FIX` | variable | 기본 `high` / `medium` / `medium`                                                               |

수동 실행: `gh workflow run agent-implement.yml -f issue=<번호>`

## GitHub App

에디터 로그인과 레포 커밋에 쓰는 앱은 [es-kimo-content-editor](https://github.com/apps/es-kimo-content-editor)다. 설정은 `github-app/manifest.json`에 있다.

- 권한: Contents 쓰기, Metadata 읽기. webhook 꺼짐
- 콜백 URL: 접속 도메인마다 `/api/auth/callback`
- 설치: `es-kimo/site`, `es-kimo/yjshd`
- 환경변수: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `SESSION_SECRET` (Vercel production·development, 로컬 `.env.local`)

GitHub 설정 화면에서 앱 권한이나 콜백 URL을 바꾸면 `manifest.json`도 같이 고친다. manifest는 앱을 만들 때만 쓰이고, 이후 변경은 자동으로 반영되지 않는다.

앱을 새로 만들 때 (다른 계정용이거나 다시 만들 때):

```bash
node scripts/github-app/create.mjs   # http://localhost:8787/ 을 열어 GitHub에서 Create → 설치할 레포 선택
```

비밀값은 레포 루트의 `.env.local`과 `github-app.private-key.pem`(둘 다 gitignore, 권한 600)에 저장되고 출력되지 않는다. 같은 파일이 이미 있으면 덮어쓰지 않고 멈춘다. 만든 뒤 Settings → Optional features에서 User-to-server token expiration이 켜져 있는지 확인한다 (버튼이 Opt-out이면 켜진 상태).
