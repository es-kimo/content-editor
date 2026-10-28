#!/usr/bin/env bash
# 봇 GitHub App 토큰을 GH_TOKEN, 봇 이름을 BOT_LOGIN으로 내보낸다. 워크플로 step과 slot.sh가 source한다.
#
#   source scripts/planner/token.sh && fresh_token
#
# 설치 토큰은 1시간이면 만료되므로, 오래 도는 곳은 GitHub를 부르기 전에 다시 부른다. 받은 지 30분이 안 됐으면 그대로 쓴다.
# 모델을 부를 때는 GH_TOKEN과 APP_PRIVATE_KEY를 env에서 빼야 한다.
# env: APP_ID, APP_PRIVATE_KEY, REPO

PLANNER_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOKEN_AT=""

# if 조건 안에서 불리면 set -e가 꺼지므로, 받지 못했을 때 GH_TOKEN을 빈 값으로 덮지 않고 실패만 돌려준다.
fresh_token() {
  if [ -n "$TOKEN_AT" ] && [ $((SECONDS - TOKEN_AT)) -lt 1800 ]; then return 0; fi
  local token
  token=$(node "$PLANNER_SCRIPTS/app-token.mts") || return 1
  echo "::add-mask::$token"
  export GH_TOKEN=$token
  TOKEN_AT=$SECONDS
  if [ -z "${BOT_LOGIN:-}" ]; then
    BOT_LOGIN=$(node "$PLANNER_SCRIPTS/app-token.mts" login) || return 1
    export BOT_LOGIN
  fi
}
