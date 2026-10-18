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

PR마다 GitHub Actions가 `lint`, `format:check`, `typecheck`, `test`, `build`를 돌린다.

## 구조

| 경로              | 내용                                              |
| ----------------- | ------------------------------------------------- |
| `src/app`         | UI (Next.js App Router)                           |
| `src/lib/mdx-doc` | MDX 파일 분해/조립. UI와 GitHub에 의존하지 않는다 |
| `src/lib/github`  | GitHub API (로그인, 읽기, 커밋)                   |

`AGENTS.md`는 Next.js가 생성·관리하는 에이전트용 안내다. 이 버전의 Next.js API는 `node_modules/next/dist/docs/`를 기준으로 확인한다.
