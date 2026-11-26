#!/bin/bash
set -euo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin

# One-time exact-main, root-owned installer. Does not enable or start the timer.
REPO='christianagbotah/tradeos-africa'
TOOL_DIR='/usr/local/libexec/lightworld-deploy/tradeos-staging-backup'
UNIT_DIR='/etc/systemd/system'
SERVICE='lightworld-tradeos-staging-backup.service'
TIMER='lightworld-tradeos-staging-backup.timer'
SOURCE_SCRIPT='ops/release/tradeos-staging-backup-restore.sh'
SOURCE_SERVICE="ops/release/systemd/$SERVICE"
SOURCE_TIMER="ops/release/systemd/$TIMER"
error() { echo "tradeos-backup-timer-install-blocked: $1" >&2; exit 65; }

if [[ $# -ne 3 || "$1" != /* || ! "$2" =~ ^[0-9a-f]{40}$ ||
      ( "$3" != '--check' && "$3" != '--install' ) ]]; then
  echo "usage: install-tradeos-staging-backup-timer.sh <absolute-root-owned-main-checkout> <full-main-sha> --check|--install" >&2
  exit 64
fi
source_dir="$1"; sha="$2"; operation="$3"
(( EUID == 0 )) || error 'root privileges required'
[[ -d "$source_dir" && ! -L "$source_dir" ]] || error 'source must be ordinary directory'
canonical="$(realpath -e -- "$source_dir")"
[[ "$canonical" == "$source_dir" && "$canonical" == /root/* ]] ||
  error 'source must be a canonical path under root home'
for directory in /root "$source_dir" /usr/local/libexec /usr/local/libexec/lightworld-deploy "$UNIT_DIR"; do
  [[ -d "$directory" && ! -L "$directory" &&
    "$(stat -c '%u' "$directory")" == 0 ]] ||
    error 'untrusted source or system install parent'
  mode="$(stat -c '%a' "$directory")"
  (( (8#$mode & 0022) == 0 )) || error 'untrusted group writable directory'
done
[[ "$(git -C "$source_dir" rev-parse --verify HEAD)" == "$sha" ]] ||
  error 'source commit not requested SHA'
[[ "$(git -C "$source_dir" branch --show-current)" == main ]] ||
  error 'source must be on main'
[[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=all)" ]] ||
  error 'review source worktree not pristine'
[[ "$(gh api "repos/$REPO/branches/main" --jq '.commit.sha')" == "$sha" ]] ||
  error 'requested source not current GitHub main'
[[ "$(git -C "$source_dir" remote get-url origin)" == https://github.com/christianagbotah/tradeos-africa.git ]] ||
  error 'remote source repository not trusted'
for file in "$SOURCE_SCRIPT" "$SOURCE_SERVICE" "$SOURCE_TIMER"; do
  full="$source_dir/$file"
  [[ -f "$full" && ! -L "$full" &&
    "$(stat -c '%u' "$full")" == 0 ]] || error 'missing root-owned source file'
  mode="$(stat -c '%a' "$full")"
  (( (8#$mode & 0022) == 0 )) || error 'untrusted source file writable mode'
  git -C "$source_dir" ls-files --error-unmatch -- "$file" >/dev/null ||
    error 'source file is untracked'
done
bash -n "$source_dir/$SOURCE_SCRIPT"
grep -Fq 'ROOT=/home/lightworld/backups/tradeos-staging-databases' "$source_dir/$SOURCE_SCRIPT" ||
  error 'reviewed backup root missing'
grep -Fq "Unit=$SERVICE" "$source_dir/$SOURCE_TIMER" ||
  error 'unexpected timer target'
grep -Fq "ExecStart=$TOOL_DIR/run.sh --backup-restore" "$source_dir/$SOURCE_SERVICE" ||
  error 'unexpected service script'
for target in "$TOOL_DIR" "$UNIT_DIR/$SERVICE" "$UNIT_DIR/$TIMER"; do
  [[ ! -e "$target" && ! -L "$target" ]] ||
    error 'protected install destination already exists'
done
if [[ "$operation" == --check ]]; then
  printf 'tradeos_timer_install_preflight=true source_sha=%s no_files_changed=true\n' "$sha"
  exit 0
fi
LOCK='/var/lock/lightworld-deploy/tradeos-staging-backup.lock'
[[ -d /var/lock/lightworld-deploy && ! -L /var/lock/lightworld-deploy &&
   "$(stat -c '%u' /var/lock/lightworld-deploy)" == 0 &&
   ! -L "$LOCK" && ( ! -e "$LOCK" || -f "$LOCK" ) ]] ||
  error 'untrusted backup lock'
exec {lock_fd}>"$LOCK"
flock -n "$lock_fd" || { echo 'backup-install-locked' >&2; exit 75; }
[[ "$(gh api "repos/$REPO/branches/main" --jq '.commit.sha')" == "$sha" ]] ||
  error 'main changed after acquiring lock'
[[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=all)" ]] ||
  error 'source changed during install'
for target in "$TOOL_DIR" "$UNIT_DIR/$SERVICE" "$UNIT_DIR/$TIMER"; do
  [[ ! -e "$target" && ! -L "$target" ]] || error 'installed files appeared during install'
done
STAGING="$(mktemp -d /usr/local/libexec/lightworld-deploy/.tradeos-backup-stage.XXXXXXXX)"
installed_tool=0
installed_service=0
installed_timer=0
complete=0
cleanup_install() {
  exit_code=$?
  trap - EXIT
  if (( complete == 0 )); then
    if (( installed_timer )); then rm -f -- "$UNIT_DIR/$TIMER"; fi
    if (( installed_service )); then rm -f -- "$UNIT_DIR/$SERVICE"; fi
    if (( installed_tool )); then rm -rf --one-file-system -- "$TOOL_DIR"; fi
    /usr/bin/systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  if [[ -d "$STAGING" && ! -L "$STAGING" ]]; then
    rm -rf --one-file-system -- "$STAGING"
  fi
  exit "$exit_code"
}
trap cleanup_install EXIT
install -m 0700 -- "$source_dir/$SOURCE_SCRIPT" "$STAGING/run.sh"
printf '%s\n' "$sha" > "$STAGING/source-sha"
(cd "$STAGING"; sha256sum run.sh source-sha > SHA256SUMS; sha256sum -c --status SHA256SUMS)
chmod 0600 "$STAGING/source-sha" "$STAGING/SHA256SUMS"
chmod 0700 "$STAGING"
mv -T -- "$STAGING" "$TOOL_DIR"
installed_tool=1
install -m 0644 -- "$source_dir/$SOURCE_SERVICE" "$UNIT_DIR/$SERVICE"
installed_service=1
install -m 0644 -- "$source_dir/$SOURCE_TIMER" "$UNIT_DIR/$TIMER"
installed_timer=1
(cd "$TOOL_DIR"; sha256sum -c --status SHA256SUMS)
[[ "$(cat "$TOOL_DIR/source-sha")" == "$sha" ]] ||
  error 'installed tool not sourced from approved main'
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl cat "$SERVICE" >/dev/null
/usr/bin/systemctl cat "$TIMER" >/dev/null
complete=1
printf 'tradeos_backup_timer_installed=true source_sha=%s timer_enabled=false no_backup_started=true offsite_verified=false\n' "$sha"
