#!/usr/bin/env bash
# 기획자 워크플로(prd.yml, breakdown.yml)가 wiki를 받고 올린다. 모델은 $PLANNER_DIR/wiki만 고친다.
#
#   bash scripts/planner/wiki.sh clone          # 받고 봇 이름으로 커밋하게 한다
#   bash scripts/planner/wiki.sh reset          # 앞 할 일이 남긴 변경을 지운다
#   bash scripts/planner/wiki.sh push <메시지>  # 바뀐 것이 있으면 커밋하고 올린다
#
# env: GH_TOKEN(봇 앱 설치 토큰), BOT_LOGIN, WIKI_TOKEN(있으면 push에 쓴다), REPO, PLANNER_DIR
set -euo pipefail

wiki="$PLANNER_DIR/wiki"

case "$1" in
  clone)
    git clone --quiet "https://github.com/${REPO}.wiki.git" "$wiki"
    id=$(gh api "users/${BOT_LOGIN}" --jq .id)
    git -C "$wiki" config user.name "$BOT_LOGIN"
    git -C "$wiki" config user.email "${id}+${BOT_LOGIN}@users.noreply.github.com"
    ;;
  reset)
    git -C "$wiki" reset --quiet --hard
    git -C "$wiki" clean -fdq
    ;;
  push)
    if [ -z "$(git -C "$wiki" status --porcelain)" ]; then exit 0; fi
    git -C "$wiki" add -A
    git -C "$wiki" commit --quiet -m "$2"
    # 인증은 명령마다 헤더로 넘긴다. remote URL이나 git config에 두면 모델이 읽을 수 있다.
    # 앱 설치 토큰으로 wiki에 push할 수 없으면 WIKI_TOKEN(소유자 PAT)을 쓴다. wiki 커밋은 워크플로를 띄우지 않는다.
    auth="AUTHORIZATION: basic $(printf 'x-access-token:%s' "${WIKI_TOKEN:-$GH_TOKEN}" | base64 -w0)"
    git -C "$wiki" -c http.extraheader="$auth" push --quiet
    ;;
  *)
    echo "알 수 없는 명령: $1" >&2
    exit 1
    ;;
esac
