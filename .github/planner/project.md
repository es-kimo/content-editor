# content-editor 기획 규칙

## 제품

Git 레포의 MDX 글을 웹에서 편집하고 그 레포에 커밋하는 에디터. 대상 레포는 blog와 yjshd이고, 사이트 렌더링은 es-kimo/site에 있다. 제품 이름은 `content-editor`.

- 기준 PRD: `wiki/PRD.md`
- 작업 방식: `wiki/작업-방식.md` (이슈 크기, 라벨, 의존). 이슈를 쓰기 전에 반드시 읽는다.
- 이슈 템플릿: `../.github/ISSUE_TEMPLATE/task.md`

## 이슈

- 본문은 템플릿의 `## 배경`, `## 할 일`, `## 완료 기준`, `## 의존` 절을 그대로 쓴다. 템플릿의 주석은 지운다.
- 이슈 하나 = PR 하나. 완료 기준은 4개 이하이고, 테스트나 실행 결과로 확인할 수 있는 문장이다. 실제 모듈·함수·픽스처 이름과 기대값을 쓴다.
- 영역 라벨(`mdx-doc`, `github`, `ui`, `infra`, `site`)을 하나 단다. 둘 이상 걸치면 이슈를 나누고 `## 의존`으로 잇는다.
- 본문 끝에 `---` 다음 줄로 `[vX.Y PRD](<wiki 링크>) · [작업 방식](https://github.com/es-kimo/content-editor/wiki/작업-방식)`을 단다.

## 에이전트에게 맡기는 것과 사람이 할 것

`agent: true`면 개발 에이전트가 이슈가 만들어지는 대로 순서대로 구현해 리뷰 후 merge까지 한다. 아래에 하나라도 해당하면 `agent: false`(사람 작업)로 한다.

- 이 레포 밖의 변경: es-kimo/site, blog, yjshd 레포
- DNS, 배포 설정, GitHub App·계정·시크릿 설정
- 에이전트가 수정할 수 없는 파일: `.github/`, `CLAUDE.md`, `AGENTS.md`, `fixtures.config.json`, `scripts/sync-fixtures.mts`, `scripts/agent/`, `github-app/`, `scripts/github-app/`, `docs/review/`, `eslint.config.mjs`
- 결과가 코드가 아니라 조사·측정 기록인 것(`spike` 라벨)
- 완료 기준을 브라우저에서 사람이 봐야만 확인할 수 있는 것
- 설계 선택이 PRD에서 정해지지 않은 것

사람 작업 이슈의 할 일은 사용자가 그대로 따라 할 수 있게 쓴다.

## 코드를 읽을 곳

- `../docs/review/architecture.md`: 모듈 구조, 의존 방향, 재사용할 것, 알려진 부채
- `../docs/review/testing.md`: 모듈별 테스트 경계와 픽스처
- `../docs/review/design.md`: 화면 규칙과 문구 말투
- `../src/lib/*/index.ts`: 모듈의 공개 API
- `../fixtures.config.json`: 테스트에 쓰는 실제 글 레포. 픽스처 글은 이 실행에 받아 두지 않았으니, 글 이름은 기존 테스트(`../src/**/*.test.ts`)에서 확인한다.
