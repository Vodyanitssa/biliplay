#!/usr/bin/env bash
#
# 起一个临时 Firefox（headless + Marionette），跑完测试自动关掉。
#
#   tests/run.sh            # 人看的 PASS/FAIL 报告
#   tests/run.sh --json     # 原始 JSON，排查用
#   FIREFOX=firefox-esr tests/run.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIREFOX="${FIREFOX:-firefox}"
PORT="${MARIONETTE_PORT:-2828}"
WAIT_SECONDS="${WAIT_SECONDS:-60}"

PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/biliplay-ff-XXXXXX")"

cleanup() {
  # 用 profile 路径匹配，避免误伤别的 Firefox；pkill 不会匹配到本脚本自己
  pkill -f "$PROFILE" 2>/dev/null
  [[ -n "${FF_PID:-}" ]] && kill "$FF_PID" 2>/dev/null
  rm -rf "$PROFILE"
}
trap cleanup EXIT INT TERM

if ! command -v "$FIREFOX" >/dev/null 2>&1; then
  echo "找不到 $FIREFOX，请先安装 Firefox，或用 FIREFOX=... tests/run.sh 指定路径" >&2
  exit 1
fi

"$FIREFOX" --headless --no-remote --marionette --profile "$PROFILE" \
  about:blank >"$PROFILE/firefox.log" 2>&1 &
FF_PID=$!

# 等 Marionette 端口就绪
ready=0
for _ in $(seq 1 $((WAIT_SECONDS * 2))); do
  if python3 -c "
import socket, sys
s = socket.socket(); s.settimeout(0.5)
try: s.connect(('127.0.0.1', $PORT))
except OSError: sys.exit(1)
sys.exit(0)
" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.5
done

if [[ "$ready" != "1" ]]; then
  echo "等 ${WAIT_SECONDS}s 也没等到 Marionette 端口 $PORT。Firefox 日志：" >&2
  cat "$PROFILE/firefox.log" >&2 || true
  exit 1
fi

MARIONETTE_PORT="$PORT" python3 "$HERE/validate.py" "$@"
