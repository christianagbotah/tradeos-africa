#!/bin/bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin
# Root-installed, read-only TradeOS signed release intake. DOES NOT DEPLOY.
# Installation directory is fixed and root-owned, never a user worktree.
INSTALL_DIR='/usr/local/libexec/lightworld-deploy/tradeos-signed-intake'
LOCK_FILE='/var/lock/lightworld-deploy/tradeos-africa.staging.lock'
if [[ $# -ne 2 || ! "$1" =~ ^[a-f0-9]{40}$ || ! "$2" =~ ^[0-9]{1,18}$ ]]; then
  echo 'usage: lightworld-tradeos-signed-intake <exact-current-main-sha> <successful-push-run-id>' >&2
  exit 64
fi
if (( EUID != 0 )); then
  echo 'This root-owned auditor requires root' >&2
  exit 65
fi
if [[ ! -d "$INSTALL_DIR" || -L "$INSTALL_DIR" ||
      "$(stat -c '%u' "$INSTALL_DIR")" != '0' ||
      "$(stat -c '%a' "$INSTALL_DIR")" != '755' ]]; then
  echo 'No trusted root-installed TradeOS auditor directory' >&2
  exit 65
fi
# Nothing inside the root-installed directory may be group/other writable or
# redirect through a symlink, even when the checksum manifest has been updated.
for entry in "$INSTALL_DIR"/*; do
  [[ -f "$entry" && ! -L "$entry" && "$(stat -c '%u' "$entry")" == '0' ]] || {
    echo 'Invalid trusted TradeOS audit installation' >&2; exit 65;
  }
  mode="$(stat -c '%a' "$entry")"
  if (( (8#$mode & 0022) != 0 )); then
    echo 'TradeOS audit installation has writable or untrusted file mode' >&2; exit 65
  fi
done
[[ -f "$INSTALL_DIR/SHA256SUMS" && ! -L "$INSTALL_DIR/SHA256SUMS" ]] || exit 65
[[ -f "$INSTALL_DIR/entrypoint-sha256" && ! -L "$INSTALL_DIR/entrypoint-sha256" ]] || exit 65
entrypoint_actual="$(sha256sum -- "$0" | cut -d' ' -f1)"
entrypoint_expected="$(cat -- "$INSTALL_DIR/entrypoint-sha256")"
if [[ ! "$entrypoint_expected" =~ ^[0-9a-f]{64}$ || "$entrypoint_actual" != "$entrypoint_expected" ]]; then
  echo 'TradeOS auditor entrypoint is not the installed trusted revision' >&2
  exit 65
fi
(
  cd "$INSTALL_DIR"
  sha256sum -c --status SHA256SUMS
) || { echo 'TradeOS installed auditor checksum mismatch' >&2; exit 65; }
# Do not inherit an operator-provided DATABASE_URL, PATH, GH_TOKEN or other
# credentials/variables. GH uses the authenticated root config by default;
# the staging DB env is loaded only by the reviewed read-only auditor itself.
/usr/bin/env -i HOME=/root USER=root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin \
  PYTHONDONTWRITEBYTECODE=1 \
  /bin/bash "$INSTALL_DIR/signed-release-intake.sh" "$1" "$2"
