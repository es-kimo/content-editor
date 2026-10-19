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

- `.github/`, `CLAUDE.md`, `AGENTS.md`, `fixtures.config.json`, `scripts/sync-fixtures.mts`, `scripts/agent/` 수정
- 테스트를 지우거나 `.skip`, `.only`, `skipIf`를 새로 넣어 통과시키기
- 기대값을 실제 결과에 맞춰 바꾸기 (픽스처 기대 글 수 등)
- 이슈 범위 밖의 리팩터링, 의존성 메이저 업그레이드
- `main`에 직접 push, force push

## 코드 관례

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

## 막혔을 때

사람의 결정이 필요하거나(설계 선택, 외부 계정·자격증명), 완료 기준이 모호하면 추측으로 진행하지 않는다. 멈추고 이유를 남긴다.
