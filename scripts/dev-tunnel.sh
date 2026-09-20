#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "未找到 cloudflared：请先安装后再运行 npm run dev:tunnel" >&2
  echo "macOS: brew install cloudflared" >&2
  echo "其它系统见 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 1
fi

is_up() {
  curl -sf "http://127.0.0.1:${PORT}" >/dev/null 2>&1
}

DEV_PID=""
cleanup() {
  if [[ -n "${DEV_PID}" ]] && kill -0 "${DEV_PID}" 2>/dev/null; then
    kill "${DEV_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! is_up; then
  echo "本地 :${PORT} 未在监听，正在启动 npm run dev …"
  npm run dev -- --port "${PORT}" &
  DEV_PID=$!
  for _ in $(seq 1 60); do
    if is_up; then
      break
    fi
    sleep 0.5
  done
  if ! is_up; then
    echo "等待 Next 开发服务器超时（:${PORT}）" >&2
    exit 1
  fi
else
  echo "复用已在监听的 http://localhost:${PORT}"
fi

echo "启动 cloudflared quick tunnel → http://localhost:${PORT}"
echo "浏览器打开终端里打印的 https://*.trycloudflare.com 即可远程测 UsagePanel。"
exec cloudflared tunnel --url "http://localhost:${PORT}"
