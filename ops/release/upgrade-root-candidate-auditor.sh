#!/bin/bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin
# Root-only, tightly scoped upgrade for the immutable nondeployable auditor.
# Keeps the previously verified root auditor as a one-time rollback. NEVER
# updates TradeOS app releases/PM2, SQL ledger, payments or payment providers.
ROOT='/usr/local/libexec/lightworld-deploy'
CURRENT="$ROOT/tradeos-candidate-audit"
BACKUP="$ROOT/tradeos-candidate-audit-rollback"
ENTRY='/usr/local/sbin/lightworld-tradeos-candidate-audit'
ENTRY_BACKUP='/usr/local/sbin/.lightworld-tradeos-candidate-audit-rollback'
FAILED="$ROOT/.tradeos-candidate-audit-failed"
ENTRY_FAILED='/usr/local/sbin/.lightworld-tradeos-candidate-audit-failed'
LOCK_DIR='/var/lock/lightworld-deploy'
LOCK="$LOCK_DIR/tradeos-africa.staging.lock"
usage() { echo 'usage: upgrade-root-candidate-auditor.sh <absolute-clean-current-main-checkout> <full-main-sha> [--check|--upgrade]' >&2; }
if [[ $# -ne 3 || "$1" != /* || ! "$2" =~ ^[0-9a-f]{40}$ ||
      ( "$3" != '--check' && "$3" != '--upgrade' ) ]]; then
  usage; exit 64
fi
checkout="$1"; sha="$2"; action="$3"
installer="$checkout/ops/release/install-root-candidate-auditor.sh"
[[ -f "$installer" && ! -L "$installer" ]] || { echo 'Missing trusted source installer' >&2; exit 65; }
# The installer itself validates canonical, clean, exact current main, plus
# root-only ownership of all sources before writing any privileged file.
/bin/bash "$installer" "$checkout" "$sha" --check
if [[ "$action" == '--check' ]]; then
  echo "auditor_upgrade_source_verified=true main_sha=$sha no_files_changed=true"
  exit 0
fi
(( EUID == 0 )) || { echo 'Root privileges required for auditor upgrade' >&2; exit 65; }
for folder in "$ROOT" "$LOCK_DIR"; do
  [[ -d "$folder" && ! -L "$folder" && "$(stat -c '%u' -- "$folder")" == '0' ]] || {
    echo 'Refusing untrusted shared root tool or lock directory' >&2; exit 65;
  }
  mode="$(stat -c '%a' -- "$folder")"
  if (( (8#$mode & 0022) != 0 )); then
    echo 'Refusing shared tool or lock directory writable by other principals' >&2
    exit 65
  fi
done
[[ -d "$CURRENT" && ! -L "$CURRENT" && "$(stat -c '%u' -- "$CURRENT")" == '0' ]] || {
  echo 'No existing trusted auditor to upgrade' >&2; exit 65;
}
[[ -f "$ENTRY" && ! -L "$ENTRY" && "$(stat -c '%u' -- "$ENTRY")" == '0' ]] || {
  echo 'No existing trusted root auditor entrypoint' >&2; exit 65;
}
for location in "$BACKUP" "$ENTRY_BACKUP" "$FAILED" "$ENTRY_FAILED"; do
  [[ ! -e "$location" && ! -L "$location" ]] || {
    echo 'Existing backup or failed candidate; refuse unbounded upgrades' >&2
    exit 65
  }
done
(cd "$CURRENT" && sha256sum -c --status SHA256SUMS) || {
  echo 'Installed auditor checksum mismatch before upgrade' >&2; exit 65;
}
[[ "$(cat "$CURRENT/entrypoint-sha256")" == "$(sha256sum "$ENTRY" | cut -d' ' -f1)" ]] || {
  echo 'Installed auditor entrypoint checksum mismatch' >&2; exit 65;
}
# Guard against upgrading while an audit or active app deployment is running.
[[ ! -L "$LOCK" ]] || { echo 'Unsafe deployment lock path' >&2; exit 65; }
exec {lock_fd}>"$LOCK"
flock -n "$lock_fd" || { echo 'TradeOS deployment or audit in progress' >&2; exit 75; }
# Check source again inside exclusive app lock.
/bin/bash "$installer" "$checkout" "$sha" --check
old_directory_moved=0
old_entry_moved=0
upgrade_complete=0
restore_old_auditor() {
  status=$?
  if (( upgrade_complete == 0 && (old_directory_moved || old_entry_moved) )); then
    echo 'Auditor upgrade interrupted; preserving failed candidate and restoring old verified auditor' >&2
    # No removal and no arbitrary path traversal. Never overwrite a backup.
    if (( old_directory_moved == 1 )) && [[ -e "$CURRENT" && ! -e "$FAILED" && ! -L "$CURRENT" ]]; then
      mv -T -- "$CURRENT" "$FAILED" || true
    fi
    if (( old_entry_moved == 1 )) && [[ -e "$ENTRY" && ! -e "$ENTRY_FAILED" && ! -L "$ENTRY" ]]; then
      mv -T -- "$ENTRY" "$ENTRY_FAILED" || true
    fi
    if (( old_directory_moved == 1 )) && [[ -e "$BACKUP" && ! -e "$CURRENT" ]]; then
      mv -T -- "$BACKUP" "$CURRENT" || true
    fi
    if (( old_entry_moved == 1 )) && [[ -e "$ENTRY_BACKUP" && ! -e "$ENTRY" ]]; then
      mv -T -- "$ENTRY_BACKUP" "$ENTRY" || true
    fi
  fi
  return 0
}
trap restore_old_auditor EXIT
mv -T -- "$CURRENT" "$BACKUP"
old_directory_moved=1
mv -T -- "$ENTRY" "$ENTRY_BACKUP"
old_entry_moved=1
# Existing installer refuses overwrites, verifies main SHA twice, checks clean
# tree/owner/modes, stages new checksummed scripts and installs atomically.
/bin/bash "$installer" "$checkout" "$sha" --install
[[ -d "$CURRENT" && ! -L "$CURRENT" && -f "$ENTRY" && ! -L "$ENTRY" ]] || {
  echo 'New auditor incomplete' >&2; exit 65;
}
(cd "$CURRENT" && sha256sum -c --status SHA256SUMS)
[[ "$(cat "$CURRENT/entrypoint-sha256")" == "$(sha256sum "$ENTRY" | cut -d' ' -f1)" ]]
[[ "$(cat "$CURRENT/installer-source-commit")" == "$sha" ]]
upgrade_complete=1
printf 'auditor_upgrade_verified=true source_sha=%s old_auditor_preserved=%s no_activation=true\n' "$sha" "$BACKUP"
