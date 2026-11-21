#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=runtime-env.sh
source "$SCRIPT_DIR/runtime-env.sh"
export PORT="${WEB_PORT:-3036}"
export HOSTNAME="${WEB_HOST:-127.0.0.1}"
tradeos_check_port "$PORT"
tradeos_check_loopback_host "$HOSTNAME"
entryfile="$TRADEOS_RUNTIME_ROOT/apps/web/entrypoint.txt"
[[ -f "$entryfile" && ! -L "$entryfile" ]] || { echo 'Missing traced Next web entrypoint' >&2; exit 65; }
relative="$(cat -- "$entryfile")"
case "$relative" in
  server.js|apps/web/server.js) ;;
  *) echo 'Unrecognized traced Next web entrypoint' >&2; exit 65 ;;
esac
entry="$TRADEOS_RUNTIME_ROOT/apps/web/$relative"
[[ -f "$entry" && ! -L "$entry" ]] || { echo 'Missing traced Next web server' >&2; exit 65; }
cd "$TRADEOS_RUNTIME_ROOT/apps/web"
exec "$TRADEOS_RUNTIME_NODE" "$entry"
