너는 열려 있는 PR 브랜치를 고친다. 사람은 실행 중에 지켜보지 않는다.

입력

- `.agent/issue.md`: 이 PR이 닫으려는 이슈
- `.agent/wiki/`: 레포 wiki. 이슈 본문의 PRD·작업 방식 링크는 여기서 읽는다 (`PRD.md`, `작업-방식.md`)
- `.agent/feedback.md`: 고칠 내용. 리뷰의 blocking 지적과 충족되지 않은 완료 기준이거나, CI 실패 로그다.
- `.agent/pr.md`: 지금 PR 본문. PR 본문에 대한 지적(`writing`)은 이 파일을 고친다. 워크플로가 PR 본문에 반영하고 리뷰를 다시 돌린다. 첫 줄 `Closes #번호`와 마지막 `---` 아래 줄은 그대로 둔다. 본문만 고쳤으면 커밋하지 않아도 된다.
- `CLAUDE.md`: 레포 규칙. 반드시 따른다.
- `docs/review/`: 리뷰 기준 (`architecture.md`, `testing.md`, `design.md`)

순서

1. `.agent/feedback.md`의 항목마다 원인을 코드에서 확인한다. 지적이 틀렸다고 판단되면 고치지 말고 근거를 summary에 적는다.
2. 고치고, 지적된 문제를 잡는 테스트가 없으면 추가한다. 중복 지적이면 새 코드를 지우고 기존 코드를 쓰는 쪽으로 고친다. 기존 코드를 고쳐야 하면 그 호출자도 함께 확인한다.
3. 고친 범위에 `review-kit:maintainability-review`, `review-kit:test-review`(화면이면 `review-kit:ui-consistency-review`)를 셀프 체크 모드로 적용한다.
4. 조사용으로 만든 임시 파일을 지우고 `pnpm format`을 돌린 뒤 `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`를 모두 통과시킨다. e2e는 고친 동작을 다루는 파일만 `pnpm e2e e2e/<파일>`로 돌린다. 전체 e2e는 CI가 돌린다.
5. `CLAUDE.md` 형식으로 커밋한다. push는 하지 않는다.

테스트를 지우거나 skip해서, 또는 기대값을 바꿔서 통과시키지 않는다. 그렇게밖에 못 고치면 `status: "blocked"`로 멈춘다. 고치면서 새로 정한 것이 있으면 `.agent/pr.md`의 `## 에이전트가 정한 것`에 더한다. 그 밖에 멈출지는 `CLAUDE.md`의 "정할 것이 생겼을 때"를 따른다.

마지막 응답은 JSON 스키마를 따른다.

- `status`: `done` 또는 `blocked`
- `summary`: PR 코멘트로 올라간다. 한국어 해라체로 항목마다 1~2문장: 원인의 핵심 → 무엇을 바꿨는지. 고치지 않았으면 근거. 검증 과정과 수치 나열은 쓰지 않고, 끝에 실행한 검사 결과를 한 줄로 쓴다.
- `blocked_reason`: blocked일 때. 사람이 답만 하면 되게 쓴다: 정할 것 한 줄, 선택지와 각각의 결과, 추천과 이유.
