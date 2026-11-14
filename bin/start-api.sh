#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${TRADEOS_ENV_FILE:-$ROOT_DIR/.env.staging}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing TradeOS environment file: $ENV_FILE" >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ "$line" != *=* ]]; then
    echo "Invalid TradeOS environment entry: expected KEY=VALUE" >&2
    exit 1
  fi
  key="${line%%=*}"
  value="${line#*=}"
  if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "Invalid TradeOS environment key: $key" >&2
    exit 1
  fi
  export "$key=$value"
done < "$ENV_FILE"

# Explicit, non-secret canonical origins for THIS TradeOS staging launcher.
# The external environment file always takes precedence. Do not derive recovery
# destinations from request Host headers or customer-supplied inputs.
export TRADEOS_PASSWORD_RESET_FROM="${TRADEOS_PASSWORD_RESET_FROM:-mail@lightworldtech.com}"
export TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN="${TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN:-https://tradeosafrica.lightworldtech.com}"
export TRADEOS_ADMIN_RESET_PUBLIC_ORIGIN="${TRADEOS_ADMIN_RESET_PUBLIC_ORIGIN:-https://tradeosadmin.lightworldtech.com}"

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-4036}"

cd "$ROOT_DIR"
exec /usr/bin/env node "$ROOT_DIR/apps/api/dist/server.js"
