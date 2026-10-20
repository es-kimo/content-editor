@AGENTS.md

# content-editor 작업 규칙

Git 레포의 MDX 글을 웹에서 편집하고 그 레포에 커밋하는 에디터. 설계와 결정은 [PRD](https://github.com/es-kimo/content-editor/wiki/PRD)에 있고, 이슈 본문에 필요한 결정이 요약돼 있다.

## 명령

```bash
pnpm install
pnpm fixtures:sync   # 실제 글 171편을 fixtures/에 받는다 (테스트 정답지). 에이전트 실행에서는 워크플로가 이미 받아 두므로 다시 실행하지 않는다
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm format          # 포맷 자동 수정
```

## 완료의 정의

- 이슈의 **완료 기준**을 하나씩 테스트나 실행 결과로 확인했다.
- 새 동작마다 테스트가 있고, 그 테스트는 구현을 망가뜨리면 실패한다.
- mdx-doc 변경은 픽스처 171편 전체 테스트를 통과한다.
- `lint`, `format:check`, `typecheck`, `test`, `build`가 모두 통과한다.

## 금지

- `.github/`, `CLAUDE.md`, `AGENTS.md`, `fixtures.config.json`, `scripts/sync-fixtures.mts`, `scripts/agent/`, `github-app/`, `scripts/github-app/`, `eslint.config.mjs` 수정
- 테스트를 지우거나 `.skip`, `.only`, `skipIf`를 새로 넣어 통과시키기
- 기대값을 실제 결과에 맞춰 바꾸기 (픽스처 기대 글 수 등)
- 이슈와 상관없는 정리, 의존성 메이저 업그레이드
- `main`에 직접 push, force push

이슈를 하는 데 필요한 리팩터링은 한다. `docs/review/`는 이슈가 요구하거나 구현에 맞춰 기준을 고쳐야 할 때 고치되, 기준을 낮춰 통과시키지 않는다. 둘 다 PR 본문 `## 에이전트가 정한 것`에 무엇을 왜 바꿨는지 적는다.

## 코드 관례

구조·테스트·화면의 기준은 [docs/review/](docs/review/)에 있다. 구현 전에 읽고, 리뷰도 이 기준으로 한다.

- [architecture.md](docs/review/architecture.md): 모듈 의존 방향, 새로 만들기 전에 재사용할 것, 알려진 부채
- [testing.md](docs/review/testing.md): 모듈별 테스트 경계와 도우미
- [design.md](docs/review/design.md): 화면 토큰, 상태 표현, 문구 말투

- TypeScript strict. `any` 대신 정확한 타입. 외부 라이브러리 타입은 그 패키지의 export에서 가져온다 (pnpm은 선언하지 않은 패키지를 import할 수 없다).
- 주석과 테스트 이름은 한국어. 주석은 코드만 봐서는 알 수 없는 이유만 적는다.
- `src/lib/mdx-doc`은 UI와 GitHub에 의존하지 않는다.
- Prettier `printWidth: 120`.

## 커밋

```
<type>(<영역>): <한국어 요약> (#<이슈번호>)

- 무엇을 왜 바꿨는지
```

type: `feat`, `fix`, `test`, `refactor`, `chore`, `docs`.

## 정할 것이 생겼을 때

되돌릴 수 있는 결정은 스스로 정하고 진행한다. PRD·이슈·`docs/review/`에 비추어 가장 맞는 쪽을 고르고, PR 본문 `## 에이전트가 정한 것`에 고른 것·다른 선택지·이유를 적는다. 완료 기준이 여러 뜻으로 읽히면 PRD에 가장 가까운 해석을 고르고 같은 곳에 적는다. 사람은 코드보다 PR 본문을 읽는다.

아래일 때만 멈춘다.

- 외부 계정·자격증명, 다른 레포, 배포 설정이 필요하다.
- 위 금지 파일을 바꿔야만 할 수 있다.
- PRD와 부딪쳐서 어느 쪽을 골라도 제품 방향이 바뀐다.
- 기존 글 원문이나 사용자 데이터를 되돌릴 수 없게 바꾸는 결정이다.

멈출 때는 사람이 답만 하면 되게 쓴다: 정할 것 한 줄, 선택지와 각각의 결과, 추천과 이유.
