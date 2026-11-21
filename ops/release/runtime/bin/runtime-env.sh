#!/usr/bin/env bash
# Shared source-light runtime environment loader. Source only from trusted,
# GitHub-built runtime launchers; never evaluate contents as shell commands.
set -euo pipefail

TRADEOS_RUNTIME_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TRADEOS_RUNTIME_NODE="$(command -v node || true)"
if [[ -z "$TRADEOS_RUNTIME_NODE" || "$TRADEOS_RUNTIME_NODE" != /* || ! -x "$TRADEOS_RUNTIME_NODE" ]]; then
  echo 'TradeOS runtime: trusted Node executable is missing' >&2
  exit 65
fi
if [[ "$("$TRADEOS_RUNTIME_NODE" -p 'process.versions.node.split(".")[0]')" != '22' ]]; then
  echo 'TradeOS runtime requires Node 22' >&2
  exit 65
fi

# The root-owned deploy registry supplies TRADEOS_ENV_FILE pointing to an
# external env file. GitHub smoke injects its own empty CI test env file.
TRADEOS_RUNTIME_ENV="${TRADEOS_ENV_FILE:-$TRADEOS_RUNTIME_ROOT/.env.staging}"
if [[ ! -f "$TRADEOS_RUNTIME_ENV" || ! -r "$TRADEOS_RUNTIME_ENV" ]]; then
  echo 'TradeOS runtime environment file is missing or unreadable' >&2
  exit 65
fi
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ "$line" != *=* ]]; then
    echo 'Invalid TradeOS environment: expected KEY=VALUE' >&2
    exit 65
  fi
  key="${line%%=*}"
  value="${line#*=}"
  if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo 'Invalid TradeOS environment variable name' >&2
    exit 65
  fi
  export "$key=$value"
done < "$TRADEOS_RUNTIME_ENV"

# Prevent an external environment from forcing a development runtime.
export NODE_ENV=production

tradeos_check_port() {
  local value="$1"
  if [[ ! "$value" =~ ^[0-9]{1,5}$ ]] || (( 10#$value < 1 || 10#$value > 65535 )); then
    echo 'Invalid TradeOS runtime TCP port' >&2
    exit 65
  fi
}

tradeos_check_loopback_host() {
  # All three services are reverse-proxied through the trusted Nginx layer.
  # Do not allow accidentally binding sensitive APIs to all interfaces.
  case "$1" in
    127.0.0.1|::1|localhost) ;;
    *) echo 'TradeOS source-light runtime must bind to loopback' >&2; exit 65 ;;
  esac
}
