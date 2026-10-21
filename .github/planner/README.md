# 기획자 에이전트

기획 원문 이슈를 버전 PRD(wiki)로 정리하고, 승인된 PRD를 마일스톤과 작업 이슈로 나누고, 마일스톤이 끝나면 릴리즈 초안을 만든다. 아이디어를 넓히는 대화는 이 레포 밖(ChatGPT 등)에서 하고, 그 결과를 이슈로 올린다. 구현은 하지 않는다. `agent-ready` 이슈는 밤 근무([night-shift.yml](../workflows/night-shift.yml))가 맡는다.

## 흐름

```
이슈 열기 (템플릿 "기획" → planning, 본문 = 기획 원문)
  └▶ prd.yml: PRD 초안 wiki/vX.Y-PRD.md, 제목 [vX.Y] …, prd-draft
       │  고칠 점은 코멘트 → prd.yml이 PRD를 고친다 (반복)
       │  "승인…" 코멘트
       ▼
     breakdown.yml: 마일스톤 vX.Y + 작업 이슈 (에이전트 작업은 agent-ready), prd-draft → issued
       │  밤 근무가 구현, 마일스톤 이슈가 모두 닫힘
       ▼
     release.yml: 릴리즈 초안 vX.Y.0, 마일스톤·기획 이슈 닫기 → 사용자가 publish
```

| 워크플로                                    | 언제                                                      | 모델   | 지시                         |
| ------------------------------------------- | --------------------------------------------------------- | ------ | ---------------------------- |
| [prd.yml](../workflows/prd.yml)             | 소유자가 `planning`을 닮, `planning` 이슈에 소유자 코멘트 | Codex  | [prd.md](prd.md)             |
| [breakdown.yml](../workflows/breakdown.yml) | `prd-draft` 이슈에 소유자가 `승인`으로 시작하는 글을 씀   | Claude | [breakdown.md](breakdown.md) |
| [release.yml](../workflows/release.yml)     | `vX.Y` 마일스톤의 마지막 이슈가 닫힘                      | 없음   | 이슈 제목과 PR 번호로 노트   |

| 라벨        | 뜻                                                                                      |
| ----------- | --------------------------------------------------------------------------------------- |
| `planning`  | 기획 원문. 소유자가 달면 기획자가 PRD 초안을 쓴다                                       |
| `prd-draft` | PRD 초안 검토 중. 코멘트로 고치고, `승인`으로 시작하는 코멘트를 달면 작업 이슈로 나눈다 |
| `issued`    | 작업 이슈로 나눴다. 마일스톤 vX.Y에서 진행한다. 이 뒤의 코멘트에는 답하지 않는다        |

- 소유자의 글에만 반응한다. 다른 사람의 코멘트는 모델 입력에서도 뺀다.
- 할 일은 이벤트 내용이 아니라 열린 `planning` 이슈의 상태로 고른다([plan.mts](../../scripts/planner/plan.mts)의 `nextJob`). 그래서 코멘트 하나에 prd.yml과 breakdown.yml이 함께 뜨고, 맞지 않는 쪽은 할 일 없이 끝난다. 수동 실행하면 밀린 것을 모두 처리한다.
- 모델은 wiki 폴더만 쓴다. 이슈·라벨·마일스톤·릴리즈는 [scripts/planner/run.mts](../../scripts/planner/run.mts)가 반영한다.
- 실패하면 기획 이슈에 실패 코멘트를 단다. 다시 코멘트하면 다시 시도한다.
- 이슈 나누기를 밤 근무에 넣으려면 night-shift.yml에 `uses: ./.github/workflows/breakdown.yml`, `secrets: inherit` job을 두고 plan job이 `needs`로 기다리게 한다.

## 준비

| 이름                             | 종류     | 쓰는 곳        | 내용                                                                                                                                  |
| -------------------------------- | -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PLANNER_GH_TOKEN`               | secret   | 셋 다          | 기획자 봇 계정의 classic PAT(`repo`). 봇을 레포 협업자(Write)로 초대한다. 개인 계정 레포의 협업자는 fine-grained PAT로 접근할 수 없다 |
| `CODEX_AUTH_JSON`                | secret   | prd            | CI 전용으로 로그인한 `auth.json` (`CODEX_HOME=~/.codex-ci codex login`)                                                               |
| `PLANNER_SECRETS_TOKEN`          | secret   | prd            | `CODEX_AUTH_JSON`을 되쓰는 fine-grained PAT (Secrets: Read and write)                                                                 |
| `CLAUDE_CODE_OAUTH_TOKEN`        | secret   | breakdown      | 개발 에이전트와 같이 쓴다                                                                                                             |
| `PLANNER_ENABLED`                | variable | 셋 다          | `true`일 때만 돈다                                                                                                                    |
| `PLANNER_MODEL`                  | variable | prd            | 기본 `gpt-6-astra`                                                                                                                    |
| `PLANNER_CLAUDE_MODEL`           | variable | breakdown      | 없으면 `AGENT_MODEL`, 그것도 없으면 `claude-opus-5-5`                                                                                 |
| `PLANNER_SANDBOX`                | variable | prd            | 기본 `workspace-write`. 러너에서 샌드박스가 돌지 않으면 `danger-full-access`                                                          |
| `PLANNER_EFFORT_{PRD,BREAKDOWN}` | variable | prd, breakdown | 기본 medium / high                                                                                                                    |

봇 계정을 따로 두는 이유: 소유자 토큰으로 코멘트하면 본인 활동이라 GitHub Mobile 알림이 오지 않는다.

## 로컬에서 확인

GitHub에 반영하지 않고 입력과 모델 결과만 본다. `codex`가 설치돼 있어야 한다.

```bash
export GH_TOKEN=$(gh auth token) REPO=es-kimo/content-editor OWNER=es-kimo PLANNER_DIR="$PWD/.planner"
mkdir -p .planner && git clone -q "https://github.com/$REPO.wiki.git" .planner/wiki
job=$(node scripts/planner/run.mts jobs prd | jq -c '.[0]') && echo "$job"
node scripts/planner/run.mts context "$job"
codex exec --cd .planner --model gpt-6-astra --config 'model_reasoning_effort="medium"' --config project_doc_max_bytes=0 \
  --sandbox workspace-write --ephemeral --output-schema .github/planner/schema-prd.json --output-last-message .planner/out.json \
  "\`../.github/planner/role.md\`를 읽고 따른다. 이번 모드는 \`prd\`이고 지시는 \`../.github/planner/prd.md\`에 있다. 입력은 \`context.md\`에 있다." < /dev/null
jq . .planner/out.json; git -C .planner/wiki status --short
```

## 다른 레포에 옮길 때

- [project.md](project.md)를 그 레포의 제품·라벨·사람 작업 기준으로 바꾼다. [role.md](role.md)와 모드 지시는 그대로 쓴다.
- 개발 에이전트가 없는 레포는 project.md에서 모든 이슈를 `agent: false`로 하라고 적는다.
- `agent-ready`·`agent` 라벨 이름은 [run.mts](../../scripts/planner/run.mts)에 있다.
