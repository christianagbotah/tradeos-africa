#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=runtime-env.sh
source "$SCRIPT_DIR/runtime-env.sh"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-4036}"
tradeos_check_loopback_host "$HOST"
tradeos_check_port "$PORT"
# Preserve the defaults required by TradeOS password recovery. The external
# environment takes precedence. Never derive recovery origins from Host headers.
export TRADEOS_PASSWORD_RESET_FROM="${TRADEOS_PASSWORD_RESET_FROM:-mail@lightworldtech.com}"
export TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN="${TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN:-https://tradeosafrica.lightworldtech.com}"
export TRADEOS_ADMIN_RESET_PUBLIC_ORIGIN="${TRADEOS_ADMIN_RESET_PUBLIC_ORIGIN:-https://tradeosadmin.lightworldtech.com}"
entry="$TRADEOS_RUNTIME_ROOT/apps/api/dist/server.js"
[[ -f "$entry" && ! -L "$entry" ]] || { echo 'Compiled TradeOS API server is missing' >&2; exit 65; }
cd "$TRADEOS_RUNTIME_ROOT/apps/api"
exec "$TRADEOS_RUNTIME_NODE" "$entry"
