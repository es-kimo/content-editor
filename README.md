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

| 명령                | 내용                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`         | ESLint                                                                                                         |
| `pnpm format`       | Prettier로 전체 포맷                                                                                           |
| `pnpm format:check` | 포맷 검사 (CI)                                                                                                 |
| `pnpm typecheck`    | 라우트 타입 생성(`next typegen`) 후 tsc                                                                        |
| `pnpm test`         | Vitest (`src/**/*.test.ts`)                                                                                    |
| `pnpm build`        | 프로덕션 빌드                                                                                                  |
| `pnpm e2e`          | 빌드한 앱을 가짜 GitHub로 띄워 Chrome으로 검증 (`e2e/`). `pnpm build` 뒤에 돌린다. Chrome 위치는 `CHROME_PATH` |

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

## 밤 근무 (무인 에이전트)

매일 밤 실행 하나가 `agent-ready` 이슈를 하나씩 구현하고, 리뷰·수정을 거쳐 merge한다. 사람은 낮에 기획하고, 아침에 보고와 PR 본문을 읽는다.

```
Night shift (23:00 KST cron, 수동 실행)
 ├ 슬롯 1..N (차례로, 슬롯마다 새 러너)
 │   다음 이슈 고르기 → 없으면 끝
 │   구현 → 검사(lint·format·typecheck·test·build·e2e) → 리뷰 → 수정 (반복, 최대 AGENT_MAX_FIX번)
 │   승인 → PR 열기 → CI → merge
 │   사람이 정할 것 → 이슈를 소유자에게 assign + @멘션
 │   사용량 한도 → 진행분 저장 후 남은 슬롯 취소
 └ 아침 보고: agent-report 이슈에 @멘션 코멘트
CI (PR)          check + e2e + guard (agent/ 브랜치의 금지 변경 검사)
```

- 트리거는 cron과 수동 실행뿐이다. 다른 워크플로를 띄우거나 라벨·이벤트로 이어 가지 않으므로, Actions에는 밤마다 Night shift 실행 1개와 PR마다 CI 1개가 남는다
- 단계 사이 상태는 [slot.sh](scripts/agent/slot.sh)의 변수다. PR은 리뷰가 승인한 뒤에만 열리고, 리뷰 결과와 수정 이력은 PR 본문의 접힌 영역에 있다
- 사람은 코드 대신 PR 본문을 읽는다. 에이전트가 PRD·이슈에 없어서 스스로 정한 것은 `## 에이전트가 정한 것`에 적고, 아침 보고가 이것만 모아 보여 준다
- 끝내지 못한 작업은 `agent-wip/<이슈>` 브랜치에 저장하고 다음 시도가 이어 간다. 검사·CI·merge 실패는 다음 밤에 다시 시도하고, 마지막 사람 차례 뒤 `AGENT_MAX_ATTEMPTS`번 실패하면 사람 차례로 넘긴다
- 사용량 한도는 실행 기록의 `rate_limit_event`와 오류 문구로 판단한다 ([classify.mts](scripts/agent/classify.mts))
- 이 레포는 public이라 Actions 실행 시간이 무료다. 슬롯은 CI가 끝날 때까지 러너에서 기다린다
- 규칙: `CLAUDE.md`, 역할별 지시: `.github/agent/*.md`, 리뷰 기준: `docs/review/*.md`

### 사람 차례

사람 차례는 assignee 하나로 나타낸다. 소유자에게 assign된 이슈가 내 할 일이고, 에이전트는 assign된 이슈를 고르지 않는다. 알림이 오도록 코멘트·assign은 봇 계정(es-kimo-bot)이 한다.

| 언제                                                          | 무엇을                                           |
| ------------------------------------------------------------- | ------------------------------------------------ |
| 에이전트가 멈춤 (외부 계정, 금지 파일, 제품 방향이 걸린 결정) | 이슈 코멘트의 "정할 것·선택지·추천"에 답한다     |
| 수정 `AGENT_MAX_FIX`번 뒤에도 리뷰가 막음                     | 지적을 고칠 방향·범위에서 빼기·무시하기를 정한다 |
| 사람 작업 이슈(QA 등)의 의존이 모두 닫힘                      | 그 이슈를 한다 (아침 보고가 assign한다)          |
| 남은 에이전트 이슈가 없음                                     | 다음 기획을 한다 (`planning` 이슈)               |

답을 코멘트로 남기고 assign을 풀면 다음 밤에 이어 간다. 소유자 답은 구현·리뷰·수정 모두 이슈 본문보다 우선한다.

### 리뷰 기준

리뷰는 완료 기준·정확성에 더해 유지보수성, 테스트 품질, 화면 일관성, PR 본문을 본다. 기준은 두 곳에 나뉘어 있다.

| 기준                                                                  | 위치                                               | 고치는 사람                                |
| --------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| 레포와 상관없는 일반 기준 (무엇을 보고, 무엇이 blocking인지)          | `review-kit` 플러그인 (`AGENT_SKILLS_MARKETPLACE`) | 사람                                       |
| 이 레포의 모듈 지도, 재사용할 것, 테스트 경계, 화면 토큰, 알려진 부채 | `docs/review/`                                     | 사람, 에이전트 (리뷰가 기준을 낮췄는지 봄) |
| 기계로 잡을 수 있는 규칙 (mdx-doc 의존, GitHub API 직접 호출)         | `eslint.config.mjs`                                | 사람 (guard가 막음)                        |

- 구현·수정 에이전트는 커밋 전에 같은 스킬로 셀프 체크한다.
- 리뷰는 지적마다 `blocking`/`suggestion`을 매긴다. 판정은 슬롯이 한다: blocking 0건이고 완료 기준이 모두 충족이면 승인, 아니면 수정 요청이다.
- 수정 에이전트에는 blocking과 미충족 기준만 넘긴다. suggestion은 PR 본문의 접힌 리뷰 영역에 남긴다.

### 이슈를 고르는 조건

슬롯마다 아래를 모두 만족하는 이슈 중 번호가 가장 작은 것을 고른다 ([select.mts](scripts/agent/select.mts)). 마일스톤은 보지 않는다.

- 열려 있다.
- `agent-ready` 라벨이 있고, `blocked`·`spike` 라벨이 없다.
- assignee가 없다.
- 본문 `## 의존` 절에 적힌 이슈(`#번호`)가 모두 닫혔다. 절이 없거나 "없음"이면 의존이 없는 것으로 본다.
- 이번 밤에 이미 실패하지 않았다.

누가 할지는 `agent-ready` 라벨로 나눈다. 에이전트 몫이면 단다(완료 기준을 테스트나 실행 결과로 확인할 수 있고 이 레포 밖의 작업이 없어야 한다). 사람 작업이면 달지 않는다. 잠시 빼 두려면 `blocked`를 단다.

| 설정                                                                  | 종류     | 값                                                                                             |
| --------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN`                                             | secret   | `claude setup-token` (구독 사용)                                                               |
| `PLANNER_GH_TOKEN`                                                    | secret   | 봇 계정 classic PAT. 기획자와 같이 쓴다 ([기획자 준비](.github/planner/README.md#준비))        |
| `AGENT_ENABLED`                                                       | variable | `true`일 때만 돈다 (끄는 스위치)                                                               |
| `AGENT_NIGHT_SLOTS`                                                   | variable | 기본 `10`. 하룻밤 슬롯 수 (= 최대 merge 수)                                                    |
| `AGENT_MAX_FIX` / `AGENT_MAX_ATTEMPTS`                                | variable | 기본 `3` / `2`                                                                                 |
| `AGENT_MODEL`                                                         | variable | 기본 `claude-opus-5-5`. 쓸 수 없으면 `sonnet`으로 fallback. 실제 모델은 PR 본문 끝에 남는다    |
| `AGENT_EFFORT_IMPLEMENT` / `AGENT_EFFORT_REVIEW` / `AGENT_EFFORT_FIX` | variable | 기본 `medium` / `high` / `medium`                                                              |
| `AGENT_SKILLS_MARKETPLACE`                                            | variable | 기본 `https://github.com/es-kimo/claude-skills.git`. `review-kit` 플러그인이 있는 마켓플레이스 |

수동 실행: `gh workflow run night-shift.yml -f issue=<번호>` (이슈 하나), `gh workflow run night-shift.yml -f slots=3` (자동 선택 3개)

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
