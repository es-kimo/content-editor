# 기획자 에이전트

기획자 에이전트. 사용자와 `planning` 라벨 이슈로 대화하고, 아이디어 백로그와 버전 PRD(wiki), 작업 이슈, 릴리즈 초안을 만든다. 구현은 하지 않는다. 모드마다 맡는 모델이 다르다: 기획(대화·제안)은 Codex(`gpt-6-astra`), 코드를 읽고 이슈를 쓰는 이슈 나누기는 Claude(구현과 같은 Max 구독), 릴리즈 노트는 모델 없이 만든다. GPT 구독 사용량을 기획에만 쓰기 위해서다. `agent-ready` 이슈는 개발 에이전트([agent-implement.yml](../workflows/agent-implement.yml))가 맡는다.

## 흐름

```
기획 이슈 열기(템플릿 "기획") ─▶ 대화 ─▶ PRD 초안 (prd-draft, 제목 [vX.Y])
                                         │  "승인…" 코멘트
                                         ▼
                      마일스톤 vX.Y + 작업 이슈 (에이전트 작업은 agent-ready) ─▶ issued
                                         │  마일스톤 이슈가 모두 닫힘
                                         ▼
                      릴리즈 초안 vX.Y.0, 마일스톤·기획 이슈 닫기 ─▶ 사용자가 publish

월·목 09:00 KST: 진행 중인 작업이 없으면 제안 보고서 이슈(planner-report)를 연다. 답하면 대화로 이어지고, 필요 없으면 닫는다.
```

| 모드      | 언제                                                       | 모델   | 지시                         |
| --------- | ---------------------------------------------------------- | ------ | ---------------------------- |
| converse  | 기획 이슈의 마지막 글이 소유자 것                          | Codex  | [converse.md](converse.md)   |
| breakdown | `prd-draft` 이슈에 소유자가 `승인`으로 시작하는 글을 씀    | Claude | [breakdown.md](breakdown.md) |
| propose   | cron, 에이전트 이슈·PR과 답을 기다리는 기획 이슈가 없을 때 | Codex  | [propose.md](propose.md)     |
| release   | `vX.Y` 마일스톤의 마지막 이슈가 닫힘                       | 없음   | 이슈 제목과 PR 번호로 노트   |

- 소유자의 글에만 반응한다. 다른 사람의 코멘트는 모델 입력에서도 뺀다.
- 모델은 wiki 폴더만 쓴다. 이슈·라벨·마일스톤·릴리즈는 [scripts/planner/run.mts](../../scripts/planner/run.mts)가 반영한다.
- 실패하면 기획 이슈에 실패 코멘트를 단다. 다시 코멘트하면 다시 시도한다.

## 준비

| 이름                                          | 종류     | 내용                                                                                                                                  |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PLANNER_GH_TOKEN`                            | secret   | 기획자 봇 계정의 classic PAT(`repo`). 봇을 레포 협업자(Write)로 초대한다. 개인 계정 레포의 협업자는 fine-grained PAT로 접근할 수 없다 |
| `CODEX_AUTH_JSON`                             | secret   | CI 전용으로 로그인한 `auth.json` (`CODEX_HOME=~/.codex-ci codex login`)                                                               |
| `PLANNER_SECRETS_TOKEN`                       | secret   | `CODEX_AUTH_JSON`을 되쓰는 fine-grained PAT (Secrets: Read and write)                                                                 |
| `PLANNER_ENABLED`                             | variable | `true`일 때만 돈다                                                                                                                    |
| `PLANNER_MODEL`                               | variable | 대화·제안 모델. 기본 `gpt-6-astra`                                                                                                    |
| `PLANNER_CLAUDE_MODEL`                        | variable | 이슈 나누기 모델. 없으면 `AGENT_MODEL`, 그것도 없으면 `claude-opus-5-5`. 인증은 개발 에이전트의 `CLAUDE_CODE_OAUTH_TOKEN`을 같이 쓴다 |
| `PLANNER_SANDBOX`                             | variable | 기본 `workspace-write`. 러너에서 샌드박스가 돌지 않으면 `danger-full-access`                                                          |
| `PLANNER_EFFORT_{CONVERSE,BREAKDOWN,PROPOSE}` | variable | 기본 medium / high / medium                                                                                                           |

봇 계정을 따로 두는 이유: 소유자 토큰으로 코멘트하면 본인 활동이라 GitHub Mobile 알림이 오지 않는다.

## 로컬에서 확인

GitHub에 반영하지 않고 입력과 모델 결과만 본다. `codex`가 설치돼 있어야 한다.

```bash
export GH_TOKEN=$(gh auth token) REPO=es-kimo/content-editor OWNER=es-kimo EVENT_NAME=schedule PLANNER_DIR="$PWD/.planner"
mkdir -p .planner && git clone -q "https://github.com/$REPO.wiki.git" .planner/wiki
job=$(node scripts/planner/run.mts jobs | jq -c '.[0]') && echo "$job"
node scripts/planner/run.mts context "$job"
mode=$(jq -r .mode <<<"$job")
codex exec --cd .planner --model gpt-6-astra --config 'model_reasoning_effort="medium"' --config project_doc_max_bytes=0 \
  --sandbox workspace-write --ephemeral --output-schema ".github/planner/schema-$mode.json" --output-last-message .planner/out.json \
  "\`../.github/planner/role.md\`를 읽고 따른다. 이번 모드는 \`$mode\`이고 지시는 \`../.github/planner/$mode.md\`에 있다. 입력은 \`context.md\`에 있다." < /dev/null
jq . .planner/out.json; git -C .planner/wiki status --short
```

## 다른 레포에 옮길 때

- [project.md](project.md)를 그 레포의 제품·라벨·사람 작업 기준으로 바꾼다. [role.md](role.md)와 모드 지시는 그대로 쓴다.
- 개발 에이전트가 없는 레포는 project.md에서 모든 이슈를 `agent: false`로 하라고 적는다.
- `agent-ready`·`agent` 라벨 이름은 [run.mts](../../scripts/planner/run.mts)에 있다.
