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
