#!/bin/bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin
# One-time upgrade of the root-owned coordinator only; never activate the
# application, modify databases, restart services or remove a runtime release.
ROOT=/usr/local/libexec/lightworld-deploy
CURRENT="$ROOT/tradeos-signed-activate"
BACKUP="$ROOT/tradeos-signed-activate-rollback"
ENTRY=/usr/local/sbin/lightworld-tradeos-signed-activate
ENTRY_BACKUP=/usr/local/sbin/.lightworld-tradeos-signed-activate-rollback
FAILED="$ROOT/.tradeos-signed-activate-failed"
ENTRY_FAILED=/usr/local/sbin/.lightworld-tradeos-signed-activate-failed
LOCK_DIR=/var/lock/lightworld-deploy
APP_LOCK="$LOCK_DIR/tradeos-africa.staging.lock"
GLOBAL_LOCK="$LOCK_DIR/heavy-deploy.lock"
fail(){ printf 'Coordinator upgrade held: %s\n' "$1" >&2; exit 65; }
if [[ $# != 3 || "$1" != /* || ! "$2" =~ ^[a-f0-9]{40}$ || ( "$3" != --check && "$3" != --upgrade ) ]]; then
  echo 'usage: upgrade-root-signed-activate.sh <absolute-clean-main-checkout> <full-main-sha> <--check|--upgrade>' >&2
  exit 64
fi
checkout="$1"; sha="$2"; action="$3"
(( EUID == 0 )) || fail 'root-only operator'
trusted(){
  local p="$1" type="$2" mode
  [[ ! -L "$p" && "$(stat -c '%u' -- "$p")" == 0 ]] || fail 'untrusted ownership or symlink'
  if [[ "$type" == dir ]]; then [[ -d "$p" ]] || fail 'expected real directory'; else [[ -f "$p" ]] || fail 'expected regular file'; fi
  mode="$(stat -c '%a' -- "$p")"
  (( (8#$mode & 0022) == 0 )) || fail 'untrusted writable path'
}
[[ "$(realpath -e -- "$checkout")" == "$checkout" ]] || fail 'noncanonical source checkout'
for p in "$checkout" "$checkout/ops" "$checkout/ops/release" "$ROOT" "$LOCK_DIR" /usr/local/sbin; do trusted "$p" dir; done
installer="$checkout/ops/release/install-root-signed-activate.sh"
trusted "$installer" file
[[ "$(git -C "$checkout" rev-parse --show-toplevel)" == "$checkout" && "$(git -C "$checkout" rev-parse HEAD)" == "$sha" ]] || fail 'wrong checkout identity'
[[ -z "$(git -C "$checkout" status --porcelain --untracked-files=all)" ]] || fail 'dirty source checkout'
git -C "$checkout" ls-files --error-unmatch ops/release/install-root-signed-activate.sh >/dev/null
[[ "$(gh api repos/christianagbotah/tradeos-africa/branches/main --jq .commit.sha)" == "$sha" ]] || fail 'source is not current GitHub main'
verify_install(){
  trusted "$CURRENT" dir
  trusted "$ENTRY" file
  for item in "$CURRENT"/*; do trusted "$item" file; done
  (cd "$CURRENT" && sha256sum -c --status SHA256SUMS) || fail 'installed checksum mismatch'
  [[ "$(cat "$CURRENT/entrypoint-sha256")" == "$(sha256sum "$ENTRY" | cut -d' ' -f1)" ]] || fail 'installed entrypoint mismatch'
}
check_unused(){
  for item in "$BACKUP" "$ENTRY_BACKUP" "$FAILED" "$ENTRY_FAILED"; do
    [[ ! -e "$item" && ! -L "$item" ]] || fail 'existing rollback or interrupted upgrade requires review'
  done
}
verify_install
check_unused
/bin/bash "$installer" "$checkout" "$sha" --check
if [[ "$action" == --check ]]; then
  printf 'coordinator_upgrade_preflight=true source_sha=%s no_files_changed=true\n' "$sha"
  exit 0
fi
# Match the activation wrapper's global-then-app lock order.
for item in "$GLOBAL_LOCK" "$APP_LOCK"; do
  [[ ! -L "$item" ]] || fail 'unsafe lock path'
  if [[ -e "$item" ]]; then trusted "$item" file; fi
done
exec {global_fd}>"$GLOBAL_LOCK"
flock -n "$global_fd" || exit 75
exec {app_fd}>"$APP_LOCK"
flock -n "$app_fd" || exit 75
verify_install
check_unused
/bin/bash "$installer" "$checkout" "$sha" --check
moved_dir=0; moved_entry=0; complete=0
restore_old(){
  local status=$?
  trap - EXIT
  if (( !complete && (moved_dir || moved_entry) )); then
    set +e
    echo 'Coordinator upgrade interrupted: retaining failed candidate and restoring previous tools' >&2
    if (( moved_dir )) && [[ -e "$CURRENT" && ! -L "$CURRENT" && ! -e "$FAILED" && ! -L "$FAILED" ]]; then mv -T -- "$CURRENT" "$FAILED" || status=65; fi
    if (( moved_entry )) && [[ -e "$ENTRY" && ! -L "$ENTRY" && ! -e "$ENTRY_FAILED" && ! -L "$ENTRY_FAILED" ]]; then mv -T -- "$ENTRY" "$ENTRY_FAILED" || status=65; fi
    if (( moved_dir )) && [[ -d "$BACKUP" && ! -e "$CURRENT" && ! -L "$CURRENT" ]]; then mv -T -- "$BACKUP" "$CURRENT" || status=65; fi
    if (( moved_entry )) && [[ -f "$ENTRY_BACKUP" && ! -e "$ENTRY" && ! -L "$ENTRY" ]]; then mv -T -- "$ENTRY_BACKUP" "$ENTRY" || status=65; fi
    (cd "$CURRENT" && sha256sum -c --status SHA256SUMS) && [[ "$(cat "$CURRENT/entrypoint-sha256")" == "$(sha256sum "$ENTRY" | cut -d' ' -f1)" ]] || { echo 'Coordinator recovery requires operator inspection' >&2; status=65; }
  fi
  exit "$status"
}
trap restore_old EXIT
mv -T -- "$CURRENT" "$BACKUP"; moved_dir=1
mv -T -- "$ENTRY" "$ENTRY_BACKUP"; moved_entry=1
/bin/bash "$installer" "$checkout" "$sha" --install
verify_install
[[ "$(cat "$CURRENT/installer-source-commit")" == "$sha" ]] || fail 'new coordinator has incorrect source identity'
[[ -f "$CURRENT/release-retention-plan.mjs" && -f "$CURRENT/verify-runtime-tree.mjs" ]] || fail 'retention or runtime integrity safeguard missing'
complete=1
printf 'coordinator_upgrade_verified=true source_sha=%s old_tools_preserved=true no_activation=true\n' "$sha"
