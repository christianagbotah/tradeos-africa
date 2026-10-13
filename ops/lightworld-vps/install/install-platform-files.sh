#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  printf 'install-platform-files.sh must run as root\n' >&2
  exit 77
fi

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LIBEXEC_ROOT='/usr/local/libexec/lightworld-deploy'
SUDOERS_TARGET='/etc/sudoers.d/lwrun_tradeos'

for required in bash install chown visudo; do
  command -v "$required" >/dev/null 2>&1 || { printf 'Missing required command: %s\n' "$required" >&2; exit 1; }
done
id lwrun_tradeos >/dev/null 2>&1 || { printf 'lwrun_tradeos does not exist; run bootstrap-host.sh --tradeos first\n' >&2; exit 1; }

bash -n \
  "$SOURCE_ROOT/lib/common.sh" \
  "$SOURCE_ROOT/libexec/lightworld-deploy" \
  "$SOURCE_ROOT/libexec/lightworld-status" \
  "$SOURCE_ROOT/libexec/lightworld-rollback" \
  "$SOURCE_ROOT/shims/tradeos-staging/lightworld-deploy-tradeos-staging" \
  "$SOURCE_ROOT/shims/tradeos-staging/lightworld-status-tradeos-staging" \
  "$SOURCE_ROOT/shims/tradeos-staging/lightworld-rollback-tradeos-staging"
visudo -cf "$SOURCE_ROOT/sudoers/lwrun_tradeos" >/dev/null

install -d -o root -g root -m 0755 "$LIBEXEC_ROOT" "$LIBEXEC_ROOT/adapters" /etc/lightworld-deploy/apps.d
install -o root -g root -m 0755 "$SOURCE_ROOT/lib/common.sh" "$LIBEXEC_ROOT/common.sh"
install -o root -g root -m 0755 "$SOURCE_ROOT/libexec/lightworld-deploy" "$LIBEXEC_ROOT/lightworld-deploy"
install -o root -g root -m 0755 "$SOURCE_ROOT/libexec/lightworld-status" "$LIBEXEC_ROOT/lightworld-status"
install -o root -g root -m 0755 "$SOURCE_ROOT/libexec/lightworld-rollback" "$LIBEXEC_ROOT/lightworld-rollback"

install -o root -g root -m 0755 "$SOURCE_ROOT/shims/tradeos-staging/lightworld-deploy-tradeos-staging" /usr/local/sbin/lightworld-deploy-tradeos-staging
install -o root -g root -m 0755 "$SOURCE_ROOT/shims/tradeos-staging/lightworld-status-tradeos-staging" /usr/local/sbin/lightworld-status-tradeos-staging
install -o root -g root -m 0755 "$SOURCE_ROOT/shims/tradeos-staging/lightworld-rollback-tradeos-staging" /usr/local/sbin/lightworld-rollback-tradeos-staging
install -o root -g root -m 0440 "$SOURCE_ROOT/sudoers/lwrun_tradeos" "$SUDOERS_TARGET"

chown -R root:root "$LIBEXEC_ROOT" /etc/lightworld-deploy/apps.d
chown root:root \
  /usr/local/sbin/lightworld-deploy-tradeos-staging \
  /usr/local/sbin/lightworld-status-tradeos-staging \
  /usr/local/sbin/lightworld-rollback-tradeos-staging \
  "$SUDOERS_TARGET"
chmod 0755 "$LIBEXEC_ROOT" "$LIBEXEC_ROOT"/* "$LIBEXEC_ROOT/adapters"
chmod 0755 /etc/lightworld-deploy/apps.d
chmod 0440 "$SUDOERS_TARGET"
visudo -cf "$SUDOERS_TARGET" >/dev/null

printf 'Lightworld deployment platform files installed\n'
