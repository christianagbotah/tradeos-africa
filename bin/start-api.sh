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

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-4036}"

cd "$ROOT_DIR"
exec /usr/bin/env pnpm --filter @tradeos/api start
