#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=runtime-env.sh
source "$SCRIPT_DIR/runtime-env.sh"
export PORT="${ADMIN_PORT:-3038}"
export HOSTNAME="${ADMIN_HOST:-127.0.0.1}"
tradeos_check_port "$PORT"
tradeos_check_loopback_host "$HOSTNAME"
entryfile="$TRADEOS_RUNTIME_ROOT/apps/system-admin/entrypoint.txt"
[[ -f "$entryfile" && ! -L "$entryfile" ]] || { echo 'Missing traced Next admin entrypoint' >&2; exit 65; }
relative="$(cat -- "$entryfile")"
case "$relative" in
  server.js|apps/system-admin/server.js) ;;
  *) echo 'Unrecognized traced Next admin entrypoint' >&2; exit 65 ;;
esac
entry="$TRADEOS_RUNTIME_ROOT/apps/system-admin/$relative"
[[ -f "$entry" && ! -L "$entry" ]] || { echo 'Missing traced Next admin server' >&2; exit 65; }
cd "$TRADEOS_RUNTIME_ROOT/apps/system-admin"
exec "$TRADEOS_RUNTIME_NODE" "$entry"
