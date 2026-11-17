#!/usr/bin/env bash
# 生产 SMTP 诊断（不打印密钥）。退出码：0 配置看起来可真发；1 缺配置；2 可能出网问题（若探测失败）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then set -a; # shellcheck disable=SC1091
  source .env
  set +a
fi

echo "=== 研企通 SMTP 医生 ==="
mask() { local v="${1:-}"; [[ -z "$v" ]] && { echo "(空)"; return; }; echo "${v:0:2}***${#v}"; }

HOST="${SMTP_HOST:-${CHANNEL_EMAIL_HOST:-}}"
PORT="${SMTP_PORT:-${CHANNEL_EMAIL_PORT:-587}}"
USER="${SMTP_USER:-${CHANNEL_EMAIL_USER:-}}"
PASS="${SMTP_PASS:-${CHANNEL_EMAIL_PASS:-}}"
FROM="${SMTP_FROM:-${CHANNEL_EMAIL_FROM:-}}"
MODE="${SMTP_MODE:-draft_only}"
CONF="${CONFIRM_LIVE_SEND:-0}"
NAME="${MAIL_FROM_NAME:-${CHANNEL_EMAIL_FROM_NAME:-小蚁}}"

echo "主机: ${HOST:-未配}  端口: $PORT"
echo "用户: $(mask "$USER")  授权码: $(mask "$PASS")"
echo "发件人: ${FROM:-未配}  显示名: $NAME"
echo "SMTP_MODE=$MODE  CONFIRM_LIVE_SEND=$CONF"

miss=0
[[ -z "$HOST" ]] && { echo "· 缺 SMTP_HOST"; miss=1; }
[[ -z "$USER" ]] && { echo "· 缺 SMTP_USER"; miss=1; }
[[ -z "$PASS" ]] && { echo "· 缺 SMTP_PASS（QQ 要用授权码）"; miss=1; }
[[ -z "$FROM" ]] && { echo "· 缺 SMTP_FROM"; miss=1; }

if [[ "$MODE" != "live" || "$CONF" != "1" ]]; then
  echo "· 尚未打开双确认真发（需要 SMTP_MODE=live 且 CONFIRM_LIVE_SEND=1）"
fi

if [[ "$miss" -eq 1 ]]; then
  echo "结论：配置不齐，只能干跑。"
  exit 1
fi

echo "· 探测 TCP ${HOST}:${PORT} …"
if command -v nc >/dev/null 2>&1; then
  if nc -z -w 5 "$HOST" "$PORT" 2>/dev/null; then
    echo "· 端口可达。真发仍取决于授权码与双确认；请在运维台用 confirmLive 试一封。"
    exit 0
  else
    echo "· 连不上端口。常见原因：本机/沙箱出网拦住 587/465。换能出网的 VPS 或放行安全组。"
    exit 2
  fi
else
  echo "· 无 nc，跳过端口探测。配置字段已齐。"
  exit 0
fi
