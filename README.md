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

| 경로                    | 내용                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `src/app`               | UI (Next.js App Router)                                                                      |
| `src/lib/mdx-doc`       | MDX 파일 분해/조립. UI와 GitHub에 의존하지 않는다                                            |
| `src/lib/github`        | GitHub API (로그인, 읽기, 커밋)                                                              |
| `src/lib/editor-config` | 사이트 레포의 `editor.config.json` 스키마와 로드·검증 ([문서](docs/editor-config/README.md)) |

`AGENTS.md`는 Next.js가 생성·관리하는 에이전트용 안내다. 이 버전의 Next.js API는 `node_modules/next/dist/docs/`를 기준으로 확인한다.

## 무인 에이전트 루프

에이전트가 이슈를 하나씩 구현하고, 리뷰·수정을 거쳐 merge한다. 하나가 merge되면 바로 다음 이슈를 골라, 마일스톤의 에이전트 이슈를 사람이 돌리지 않아도 끝까지 이어 간다.

```
Agent implement             다음 이슈 1개 → agent/<이슈>-<실행> 브랜치 → 구현 → PR(label: agent)
                            에이전트 PR merge, agent-ready 달림, needs-human 떨어짐, 30분마다(cron)에 돈다
CI                           check + guard (agent/ 브랜치의 금지 변경 검사)
Agent review (CI 완료 시)   실패: 로그로 수정 / 통과: 독립 리뷰 → 승인이면 auto-merge, 아니면 수정
Agent report (07:00 KST)    지난 24시간 결과를 `agent-report` 이슈에 코멘트
```

- 동시에 열린 에이전트 PR은 1개. 수정이 `AGENT_MAX_FIX`회를 넘거나 막히면 `needs-human`을 달고 멈춘다. 멈춘 PR은 1개에 세지 않으므로, 그 이슈에 의존하지 않는 다음 이슈는 계속 진행한다
- 이 레포는 public이라 Actions 실행 시간이 무료다. private 레포에 같은 루프를 붙이면 job마다 1분 단위로 올림해 월 한도에서 빠지므로, 30분 cron만으로 하루 48분이 든다. 그때는 cron을 밤에만 돌리거나 간격을 늘린다
- 사용량 한도로 멈춘 실행은 실패로 세지 않는다. 구현은 다음 cron이 다시 고르고, 리뷰·수정은 PR에 `agent-retry`를 달아 다음 cron이 다시 돌린다 (`scripts/agent/classify.mts`가 실행 기록으로 판단)
- 규칙: `CLAUDE.md`, 역할별 지시: `.github/agent/*.md`, 리뷰 기준: `docs/review/*.md`

### 리뷰 기준

리뷰는 완료 기준·정확성에 더해 유지보수성, 테스트 품질, 화면 일관성, PR 본문을 본다. 기준은 두 곳에 나뉘어 있다.

| 기준                                                                  | 위치                                               | 고치는 사람                       |
| --------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------- |
| 레포와 상관없는 일반 기준 (무엇을 보고, 무엇이 blocking인지)          | `review-kit` 플러그인 (`AGENT_SKILLS_MARKETPLACE`) | 사람                              |
| 이 레포의 모듈 지도, 재사용할 것, 테스트 경계, 화면 토큰, 알려진 부채 | `docs/review/`                                     | 사람 (에이전트 PR은 guard가 막음) |
| 기계로 잡을 수 있는 규칙 (mdx-doc 의존, GitHub API 직접 호출)         | `eslint.config.mjs`                                | 사람 (guard가 막음)               |

- 구현·수정 에이전트는 커밋 전에 같은 스킬로 셀프 체크한다.
- 리뷰는 지적마다 `blocking`/`suggestion`을 매긴다. 판정은 워크플로가 한다: blocking 0건이고 완료 기준이 모두 충족이면 승인(auto-merge), 아니면 수정 요청이다.
- 수정 에이전트에는 blocking과 미충족 기준만 넘긴다. suggestion은 리뷰 코멘트에 접어 둔다.

### 이슈를 고르는 조건

실행될 때마다 아래 순서로 확인하고, 하나라도 걸리면 그 회차는 아무것도 하지 않는다.

1. `AGENT_ENABLED`가 `true`다.
2. `agent-retry` 라벨이 붙은 열린 PR이 없다. 있으면 새 이슈 대신 그 PR의 마지막 리뷰 실행을 다시 돌린다.
3. `agent` 라벨이 붙은 열린 PR이 없다. `needs-human`이 붙은 PR은 세지 않는다.
4. (자동 실행만) 최근 12시간 동안 만든 `agent` PR이 `AGENT_MAX_PRS_PER_NIGHT`개 미만이다. 이벤트로 이어 가다 무언가 잘못돼 PR을 계속 만드는 일을 막는다.
5. 아래 조건을 모두 만족하는 이슈가 있다 (`scripts/agent/select.mts`).
   - 열려 있다.
   - `agent-ready` 라벨이 있다.
   - `needs-human`, `blocked`, `spike`, `in progress` 라벨이 없다.
   - 본문 `## 의존` 절에 적힌 이슈(`#번호`)가 모두 닫혔다. 절이 없거나 "없음"이면 의존이 없는 것으로 본다.

후보가 여럿이면 이슈 번호가 가장 작은 것을 고른다. 마일스톤은 보지 않는다.

누가 할지는 `agent-ready` 라벨 하나로 나눈다.

- 에이전트에게 맡길 이슈: `agent-ready`를 단다. 완료 기준을 테스트나 실행 결과로 확인할 수 있고, 이 레포 밖의 작업(다른 레포, DNS, 계정 설정)이 없어야 한다. 의존 이슈가 아직 열려 있어도 미리 달아 두면 순서가 되었을 때 고른다.
- 사람이 할 이슈: 라벨을 달지 않는다. 사람 작업과 코드 작업이 섞이면 이슈를 나눈다.
- 에이전트가 막히거나 수정 한도를 넘으면 워크플로가 `needs-human`을 단다. 확인하고 다시 맡기려면 `needs-human`만 뗀다.
- 잠시 빼 두려면 `blocked`를 단다.

수동 실행(`gh workflow run agent-implement.yml -f issue=<번호>`)은 4번을 적용하지 않는다. 이슈 번호를 주면 5번도 건너뛰고 그 이슈를 구현하고, 비우면 5번으로 고른다. 1~3번은 수동 실행에도 똑같이 적용된다.

| 설정                                                                  | 종류     | 값                                                                                              |
| --------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN`                                             | secret   | `claude setup-token` (구독 사용)                                                                |
| `AGENT_GH_TOKEN`                                                      | secret   | fine-grained PAT, 이 레포만, Contents·Pull requests·Issues 쓰기. Workflows 권한은 주지 않는다   |
| `AGENT_ENABLED`                                                       | variable | `true`일 때만 돈다 (끄는 스위치)                                                                |
| `AGENT_MAX_PRS_PER_NIGHT`                                             | variable | 기본 `6`. 최근 12시간 PR 상한. 자동 실행(cron·이벤트)에만 적용                                  |
| `AGENT_MAX_FIX` / `AGENT_MAX_ATTEMPTS`                                | variable | 기본 `2` / `2`                                                                                  |
| `AGENT_MODEL`                                                         | variable | 기본 `claude-opus-5-5`. 쓸 수 없으면 `sonnet`으로 fallback. 실제 모델은 PR·리뷰 코멘트에 남는다 |
| `AGENT_EFFORT_IMPLEMENT` / `AGENT_EFFORT_REVIEW` / `AGENT_EFFORT_FIX` | variable | 기본 `medium` / `high` / `medium`                                                               |
| `AGENT_SKILLS_MARKETPLACE`                                            | variable | 기본 `https://github.com/es-kimo/claude-skills.git`. `review-kit` 플러그인이 있는 마켓플레이스  |

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
