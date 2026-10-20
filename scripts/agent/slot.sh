#!/usr/bin/env bash
# 밤 근무 슬롯 하나. 이슈 하나를 구현 → 검사·리뷰·수정 → PR → CI → merge까지 이 실행 안에서 끝낸다.
# 단계 사이의 상태는 이 스크립트의 변수다. 라벨·코멘트 표시로 다른 실행에 넘기지 않는다.
#
# 끝나는 방법
#   0  merge했다 / 사람 차례로 넘겼다(이슈를 소유자에게 assign) / 다음 밤에 다시 시도한다(실패 표시)
#   1  사용량 한도나 예기치 못한 오류. 워크플로의 fail-fast가 남은 슬롯을 취소한다
#
# env: N(이슈 번호) BRANCH REPO OWNER GH_TOKEN(봇 PAT) ACTIONS_TOKEN RUN_URL
#      AGENT_MODEL EFFORT_IMPLEMENT EFFORT_REVIEW EFFORT_FIX MAX_FIX MAX_ATTEMPTS
set -euo pipefail

A=.agent
WIP="agent-wip/$N"
PR=""
mkdir -p "$A"
: > "$A/models.txt"
: > "$A/history.md"

# push 인증은 명령마다 헤더로 넘긴다. remote URL이나 git config에 두면 모델이 읽을 수 있다.
AUTH="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
git_push() { git -c http.extraheader="$AUTH" push --quiet "$@"; }

WORK_TOOLS="Read,Edit,Write,Glob,Grep,Skill,Bash(git grep *),Bash(pnpm *),Bash(node *),Bash(git status),Bash(git status *),Bash(git diff *),Bash(git add *),Bash(git commit *),Bash(git log *),Bash(git show *),Bash(git rm *),Bash(git restore *),Bash(rm *),Bash(ls *)"
REVIEW_TOOLS="Read,Glob,Grep,Skill,Bash(git grep *),Bash(pnpm test),Bash(pnpm test *),Bash(pnpm lint),Bash(pnpm format:check),Bash(pnpm typecheck),Bash(pnpm build),Bash(git diff *),Bash(git log *),Bash(git show *),Bash(ls *)"
NO_TOOLS="Bash(pnpm fixtures:sync),Bash(pnpm fixtures:sync *),Bash(gh *)"

# ── 끝내기 ──────────────────────────────────────────────────────────────

SAVED=""
# 커밋하지 못한 변경까지 담아 agent-wip/N에 올린다. 다음 시도가 여기서 이어 간다.
# agent/ 접두사를 쓰지 않아 CI guard가 이 브랜치에 반응하지 않는다.
save_wip() {
  if [ -n "$(git status --porcelain)" ]; then
    git add -A && git commit --quiet -m "chore: 중단 시점의 미완 변경 자동 저장 (#$N)"
  fi
  if [ "$(git rev-list --count origin/main..HEAD)" -gt 0 ] && git_push -f origin "HEAD:refs/heads/$WIP"; then
    SAVED="진행분은 \`$WIP\` 브랜치에 있어요 (커밋 $(git rev-list --count origin/main..HEAD)개)."
  fi
}
# 사용량 한도나 오류로 중간에 끝나도 진행분은 남긴다.
on_exit() {
  local code=$?
  if [ "$code" -ne 0 ]; then save_wip || true; fi
  exit "$code"
}
trap on_exit EXIT

close_pr() {
  if [ -n "$PR" ]; then gh pr close "$PR" -R "$REPO" --delete-branch > /dev/null || true; fi
}

# 사람 차례. 이슈를 소유자에게 assign하고 @멘션한다. 소유자가 답을 달고 assign을 풀면 다음 밤에 이어 간다.
hand_over() {
  save_wip
  close_pr
  gh issue comment "$N" -R "$REPO" --body "<!-- agent:human-turn -->
@$OWNER 정해 줄 것이 있어요 · [실행 로그]($RUN_URL)

$1

답을 코멘트로 남기고 assign을 풀면 다음 밤에 이어서 해요. $SAVED" > /dev/null
  gh issue edit "$N" -R "$REPO" --add-assignee "$OWNER" > /dev/null
  echo "사람 차례로 넘김"
  exit 0
}

# 시도 실패. 다음 밤에 다시 시도한다. 마지막 사람 차례 뒤의 실패가 MAX_ATTEMPTS에 닿으면 사람 차례로 넘긴다.
attempt_failed() {
  local failed
  # shellcheck disable=SC2016 # jq 변수다
  failed=$(gh issue view "$N" -R "$REPO" --json comments --jq '[.comments[].body]
    | ([range(length) as $i | select(.[$i] | contains("<!-- agent:human-turn -->")) | $i] | last // -1) as $h
    | [.[$h + 1:][] | select(contains("<!-- agent:attempt-failed -->"))] | length')
  failed=$((failed + 1))
  if [ "$failed" -ge "$MAX_ATTEMPTS" ]; then
    hand_over "${failed}번 시도했지만 끝내지 못했어요. 이슈를 더 작게 나누거나 완료 기준을 좁혀 주세요.

마지막 실패: $1"
  fi
  save_wip
  close_pr
  gh issue comment "$N" -R "$REPO" --body "<!-- agent:attempt-failed -->
구현 시도 실패 (${failed}/${MAX_ATTEMPTS}). 다음 밤에 다시 해요 · [실행 로그]($RUN_URL)

$1

$SAVED" > /dev/null
  echo "시도 실패: $1"
  exit 0
}

# ── Claude ─────────────────────────────────────────────────────────────

# claude_run <이름> <프롬프트> <스키마> <effort> <max-turns> <허용 도구> [금지 도구]
# 결과는 $A/<이름>.out.json(스키마를 따른 JSON 또는 null), 실행 분류는 $A/<이름>.info.json.
claude_run() {
  local name=$1 prompt=$2 schema=$3 effort=$4 turns=$5 tools=$6 deny=${7:-$NO_TOOLS}
  echo "::group::Claude $name (effort $effort)"
  env -u GH_TOKEN -u ACTIONS_TOKEN claude -p "$prompt" \
    --model "$AGENT_MODEL" --fallback-model sonnet --effort "$effort" --max-turns "$turns" \
    --output-format stream-json --verbose --json-schema "$(jq -c . "$schema")" \
    --allowedTools "$tools" --disallowedTools "$deny" \
    < /dev/null > "$A/$name.jsonl" || true
  echo "::endgroup::"
  jq -s . "$A/$name.jsonl" > "$A/$name.json" 2> /dev/null || echo null > "$A/$name.json"
  node scripts/agent/classify-run.mts "$A/$name.json" > "$A/$name.info.json"
  echo "$name: $(jq -c '{kind, models, detail}' "$A/$name.info.json")"
  jq -r '.models[]' "$A/$name.info.json" >> "$A/models.txt"
  if [ "$(jq -r .kind "$A/$name.info.json")" = limit ]; then
    echo "::error::사용량 한도로 멈춤: $(jq -r .detail "$A/$name.info.json")"
    exit 1
  fi
  jq '.structured // null' "$A/$name.info.json" > "$A/$name.out.json"
}
out() { jq -r "$2 // empty" "$A/$1.out.json"; }
why() { jq -r '"\(.kind): \(.detail)"' "$A/$1.info.json"; }

run_checks() {
  pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm e2e
}

# ── 준비 ───────────────────────────────────────────────────────────────

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
if git fetch --quiet origin "$WIP" 2> /dev/null; then
  git switch --quiet -c "$BRANCH" FETCH_HEAD
  { echo "# 이전 시도에서 이어 가기"; echo; echo "main 이후 이미 있는 커밋:"; echo; git log --format='- %h %s' origin/main..HEAD; } > "$A/resume.md"
  echo "$WIP에서 이어 감 ($(git rev-list --count origin/main..HEAD)개 커밋)"
else
  git switch --quiet -c "$BRANCH"
fi

# public 레포라 누구나 코멘트할 수 있다. 소유자와 봇의 코멘트만 모델에 넘긴다.
BOT=$(gh api user --jq .login)
export BOT OWNER
TITLE=$(gh issue view "$N" -R "$REPO" --json title --jq .title)
gh issue view "$N" -R "$REPO" --json title,body,comments --jq '"# #\(env.N) \(.title)\n\n\(.body)\n\n## 코멘트 (소유자 답은 본문보다 우선한다)\n"
  + ([.comments[] | select(.author.login == env.OWNER or .author.login == env.BOT) | "### \(.author.login)\n\n\(.body)\n"] | join("\n"))' > "$A/issue.md"
# 이슈 본문은 설계를 PRD(wiki)에 맡기므로 wiki를 같이 넘긴다. 받지 못해도 계속한다.
git clone --quiet --depth 1 "https://github.com/${REPO}.wiki.git" "$A/wiki" || echo "::warning::wiki를 받지 못했다"

# ── 구현 ───────────────────────────────────────────────────────────────

claude_run implement "\`.github/agent/implement.md\`의 지시를 따른다. 구현할 이슈는 \`.agent/issue.md\`에 있다." \
  .github/agent/schema-work.json "$EFFORT_IMPLEMENT" 150 "$WORK_TOOLS"
case "$(out implement .status)" in
  blocked) hand_over "$(out implement '.blocked_reason // .summary')" ;;
  done) ;;
  *) attempt_failed "구현 단계가 결과를 내지 못했어요 ($(why implement))" ;;
esac
if [ "$(git rev-list --count origin/main..HEAD)" -eq 0 ]; then attempt_failed "구현을 끝냈다고 했지만 커밋이 없어요"; fi
{ echo "Closes #$N"; echo; out implement .summary; } > "$A/pr.md"

# ── 검사 → 리뷰 → 수정 ─────────────────────────────────────────────────
# 리뷰는 검사를 모두 통과한 커밋에서만 돈다. 검사 실패 수정과 리뷰 지적 수정은 따로 세어 각각 MAX_FIX번까지 한다.
# 같은 지적(분류·파일·제목)이 세 번 연달아 나오면, 두 번 고쳐도 안 되는 것이라 상한 전이라도 사람에게 넘긴다.

check_fixes=0
review_fixes=0
fixes=0
echo '{}' > "$A/seen.json"
: > "$A/review-history.md"
while true; do
  if ! run_checks > "$A/checks.log" 2>&1; then
    echo "::group::검사 실패 (마지막 100줄)"; tail -n 100 "$A/checks.log"; echo "::endgroup::"
    { echo "# 검사 실패 로그 (마지막 300줄)"; echo; echo '```'; tail -n 300 "$A/checks.log"; echo '```'; } > "$A/feedback.md"
    what="검사 실패"
    # 검사 실패는 사람이 정할 것이 아니다. 다음 밤에 진행분에서 다시 시도한다.
    if [ "$check_fixes" -ge "$MAX_FIX" ]; then attempt_failed "검사 실패를 ${check_fixes}번 고쳤지만 검사가 통과하지 않았어요"; fi
    check_fixes=$((check_fixes + 1))
  else
    git diff origin/main...HEAD > "$A/diff.patch"
    claude_run review "\`.github/agent/review.md\`의 지시를 따른다. 이슈는 \`.agent/issue.md\`, PR 본문은 \`.agent/pr.md\`, 변경은 \`.agent/diff.patch\`, 지난 리뷰 지적과 수정은 \`.agent/review-history.md\`에 있다." \
      .github/agent/schema-review.json "$EFFORT_REVIEW" 60 "$REVIEW_TOOLS" "Edit,Write,$NO_TOOLS"
    if ! jq -e '(.criteria | length) > 0 and (.findings | type) == "array"' "$A/review.out.json" > /dev/null 2>&1; then
      attempt_failed "리뷰 단계가 결과를 내지 못했어요 ($(why review))"
    fi
    # 판정은 모델이 아니라 여기서 정한다. blocking이 하나라도 있거나 완료 기준 하나라도 미충족이면 수정 요청이다.
    blocking=$(jq '[.findings[] | select(.severity == "blocking")] | length' "$A/review.out.json")
    unmet=$(jq '[.criteria[] | select(.met | not)] | length' "$A/review.out.json")
    if [ "$blocking" -eq 0 ] && [ "$unmet" -eq 0 ]; then break; fi
    findings=$(jq -r '.findings[] | select(.severity == "blocking") | "- [\(.category)] \(.file)\(if .line then ":\(.line)" else "" end): \(.title)\n  \(.problem)\n  수정: \(.fix)"' "$A/review.out.json")
    criteria=$(jq -r '.criteria[] | select(.met | not) | "- \(.criterion): \(.evidence)"' "$A/review.out.json")
    {
      if [ -n "$findings" ]; then printf '# 리뷰 지적 (blocking)\n\n%s\n\n' "$findings"; fi
      if [ -n "$criteria" ]; then printf '# 충족되지 않은 완료 기준\n\n%s\n' "$criteria"; fi
    } > "$A/feedback.md"
    what="리뷰 지적 (blocking ${blocking} · 미충족 기준 ${unmet})"
    asked="고칠 방향, 이번 범위에서 빼기, 무시하기 중에 정해 주세요.

$(sed 's/^# 리뷰 지적 (blocking)$/**리뷰 지적**/; s/^# 충족되지 않은 완료 기준$/**충족되지 않은 완료 기준**/' "$A/feedback.md")"
    # 지적마다 연달아 나온 횟수. 이번 리뷰에 없는 지적은 센 것을 버린다.
    jq --slurpfile seen "$A/seen.json" '[.findings[] | select(.severity == "blocking") | "\(.category)|\(.file)|\(.title)"]
      | unique | map({key: ., value: (($seen[0][.] // 0) + 1)}) | from_entries' "$A/review.out.json" > "$A/seen.next.json"
    mv "$A/seen.next.json" "$A/seen.json"
    # 고쳐도 리뷰가 계속 막으면 방향을 사람이 정한다. 답은 issue.md로 구현과 리뷰에 같이 들어간다.
    if jq -e 'any(.[]; . >= 3)' "$A/seen.json" > /dev/null; then
      hand_over "같은 지적이 두 번 고친 뒤에도 다시 나왔어요. $asked"
    fi
    if [ "$review_fixes" -ge "$MAX_FIX" ]; then hand_over "리뷰 지적을 ${review_fixes}번 고쳤지만 리뷰가 아래를 막고 있어요. $asked"; fi
    review_fixes=$((review_fixes + 1))
  fi

  fixes=$((fixes + 1))
  before=$(git rev-parse HEAD)
  cp "$A/pr.md" "$A/pr.before.md"
  claude_run "fix-$fixes" "\`.github/agent/fix.md\`의 지시를 따른다. 이슈는 \`.agent/issue.md\`, 고칠 내용은 \`.agent/feedback.md\`에 있다." \
    .github/agent/schema-work.json "$EFFORT_FIX" 60 "$WORK_TOOLS"
  case "$(out "fix-$fixes" .status)" in
    blocked) hand_over "$(out "fix-$fixes" '.blocked_reason // .summary')" ;;
    done) ;;
    *) attempt_failed "수정 단계가 결과를 내지 못했어요 ($(why "fix-$fixes"))" ;;
  esac
  # 이슈를 닫는 첫 줄을 지웠으면 본문 수정을 버린다.
  if [ "$(head -1 "$A/pr.md")" != "Closes #$N" ]; then cp "$A/pr.before.md" "$A/pr.md"; fi
  # 리뷰 지적이 틀렸다고 근거만 남긴 수정은 다음 리뷰가 그 근거를 본다. 검사 실패는 바꾸지 않으면 그대로 실패한다.
  if [ "$what" = "검사 실패" ] && [ "$(git rev-parse HEAD)" = "$before" ] && cmp -s "$A/pr.md" "$A/pr.before.md"; then
    attempt_failed "검사 실패를 고치는 단계가 아무것도 바꾸지 않았어요"
  fi
  { echo "**수정 ${fixes}** · ${what}"; echo; out "fix-$fixes" .summary; echo; } >> "$A/history.md"
  if [ "$what" != "검사 실패" ]; then
    { echo "## 수정 ${review_fixes}의 리뷰 지적"; echo; sed '/^# /d' "$A/feedback.md" | awk 'NF { if (gap && seen) print ""; print; seen = 1; gap = 0; next } { gap = 1 }'; echo; echo "## 수정 ${review_fixes}의 수정 요약"; echo; out "fix-$fixes" .summary; echo; } >> "$A/review-history.md"
  fi
done

# ── PR → CI → merge ────────────────────────────────────────────────────

suggestions=$(jq '[.findings[] | select(.severity == "suggestion")] | length' "$A/review.out.json")
{
  cat "$A/pr.md"
  echo
  echo "<details><summary>에이전트 리뷰: 승인 · 수정 ${fixes}회 (검사 ${check_fixes} · 리뷰 ${review_fixes}) · 제안 ${suggestions}건</summary>"
  echo
  jq -r '
    {correctness: "정확성", maintainability: "유지보수", test: "테스트", design: "화면", scope: "범위", writing: "글"} as $label
    | (.summary), "",
      "**완료 기준**",
      (.criteria[] | "- [x] \(.criterion) — \(.evidence)"),
      (if ([.findings[] | select(.severity == "suggestion")] | length) > 0 then
        "", "**제안** (merge를 막지 않음)",
        (.findings[] | select(.severity == "suggestion")
          | "- [\($label[.category])] \(.title) · `\(.file)\(if .line then ":\(.line)" else "" end)` — \(.problem) → \(.fix)")
      else empty end)' "$A/review.out.json"
  if [ -s "$A/history.md" ]; then echo; cat "$A/history.md"; fi
  echo "</details>"
  echo
  echo "---"
  echo "밤 근무 자동 생성 · 모델: $(sort -u "$A/models.txt" | paste -sd, - | sed 's/,/, /g') · [실행 로그]($RUN_URL)"
} > "$A/pr-body.md"

git_push origin "HEAD:refs/heads/$BRANCH"
url=$(gh pr create -R "$REPO" --base main --head "$BRANCH" --title "$TITLE" --body-file "$A/pr-body.md" --label agent) \
  || attempt_failed "PR을 만들지 못했어요"
PR=${url##*/}
echo "PR #$PR"

# CI 워크플로의 체크가 모두 끝날 때까지 기다린다. 0: 모두 통과, 1: 실패가 있거나 45분 안에 끝나지 않음.
wait_ci() {
  local deadline=$((SECONDS + 45 * 60)) checks state
  while [ $SECONDS -lt $deadline ]; do
    sleep 30
    checks=$(gh pr checks "$PR" -R "$REPO" --json workflow,bucket 2> /dev/null) || true
    state=$(jq -r '[.[]? | select(.workflow == "CI") | .bucket]
      | if length == 0 then "pending"
        elif any(. == "fail" or . == "cancel") then "fail"
        elif all(. == "pass" or . == "skipping") then "pass"
        else "pending" end' <<< "${checks:-[]}")
    case $state in
      pass) return 0 ;;
      fail) return 1 ;;
    esac
  done
  return 1
}

if ! wait_ci; then
  # 같은 검사를 이미 통과했으므로 먼저 일시적 실패로 보고 한 번만 다시 돌린다.
  run=$(gh pr checks "$PR" -R "$REPO" --json workflow,bucket,link \
    --jq '[.[] | select(.workflow == "CI" and .bucket == "fail") | .link][0] // empty' | grep -oE 'runs/[0-9]+' | cut -d/ -f2 || true)
  if [ -z "$run" ] || ! GH_TOKEN="$ACTIONS_TOKEN" gh run rerun "$run" -R "$REPO" --failed || ! wait_ci; then
    attempt_failed "슬롯 안의 검사는 통과했지만 CI가 실패했어요 (PR #$PR)"
  fi
fi

gh pr merge "$PR" -R "$REPO" --merge || attempt_failed "PR #$PR을 merge하지 못했어요 (main과 충돌 등)"
gh api -X DELETE "repos/$REPO/git/refs/heads/$BRANCH" > /dev/null || true
gh api -X DELETE "repos/$REPO/git/refs/heads/$WIP" > /dev/null 2>&1 || true
echo "PR #$PR merge"
