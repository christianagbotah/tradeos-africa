#!/bin/bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin
umask 077
# Upgrade ONLY the reviewed extractor in one root-owned installed toolset.
# Do not run this from a user-controlled checkout. No application activation.
ROOT=/usr/local/libexec/lightworld-deploy
LOCK_DIR=/var/lock/lightworld-deploy
GLOBAL_LOCK="$LOCK_DIR/heavy-deploy.lock"
APP_LOCK="$LOCK_DIR/tradeos-africa.staging.lock"
EXTRACTOR=rehearse-ci-artifact-pilot.py
fail(){ echo "Extractor upgrade held: $1" >&2; exit 65; }
if [[ $# != 4 || ( "$1" != intake && "$1" != activate ) || "$2" != /* ||
      ! "$3" =~ ^[a-f0-9]{40}$ || ( "$4" != --check && "$4" != --upgrade ) ]]; then
  echo 'usage: upgrade-root-signed-extractor.sh <intake|activate> <absolute-root-owned-main-checkout> <exact-current-main-sha> <--check|--upgrade>' >&2
  exit 64
fi
kind="$1"; checkout="$2"; sha="$3"; action="$4"
(( EUID == 0 )) || fail 'root-only operator'
CURRENT="$ROOT/tradeos-signed-$kind"
BACKUP="$ROOT/tradeos-signed-$kind-extractor-rollback"
FAILED="$ROOT/.tradeos-signed-$kind-extractor-failed"
ENTRY="/usr/local/sbin/lightworld-tradeos-signed-$kind"
files=(verify-attested-runtime-release.sh inspect-ci-artifact-pilot.py
  rehearse-ci-artifact-pilot.py rehearse-signed-runtime-release.py
  check-promotion-migrations.mjs check-promotion-finance.mjs
  check-signed-release-readiness.mjs check-root-backup-evidence.py)
if [[ "$kind" == intake ]]; then
  files+=(signed-release-intake.sh)
else
  files+=(signed-release-activate.sh activate-signed-runtime.mjs controlled-cutover.mjs
    release-retention-plan.mjs verify-runtime-tree.mjs)
fi
trusted(){
  local p="$1" mode
  [[ ! -L "$p" && "$(stat -c '%u' -- "$p")" == 0 ]] || fail 'untrusted ownership or symlink'
  if [[ "$2" == dir ]]; then [[ -d "$p" ]] || fail 'expected directory'
  else [[ -f "$p" && "$(stat -c '%h' -- "$p")" == 1 ]] || fail 'expected single-link regular file'; fi
  mode="$(stat -c '%a' -- "$p")"
  (( (8#$mode & 0022) == 0 )) || fail 'group/other writable path'
}
trusted_chain(){
  local p="$1"
  [[ "$(realpath -e -- "$p")" == "$p" ]] || fail 'noncanonical path'
  while :; do
    trusted "$p" dir
    [[ "$p" == / ]] && break
    p="$(dirname -- "$p")"
  done
}
current_main(){
  [[ "$(gh api repos/christianagbotah/tradeos-africa/branches/main --jq .commit.sha)" == "$sha" ]] ||
    fail 'source is not current GitHub main'
}
trusted_chain "$checkout"
trusted_chain "$checkout/ops/release"
trusted_chain "$ROOT"
trusted_chain "$LOCK_DIR"
trusted_chain /usr/local/sbin
# Never accept user-controlled Git config or an external .git indirection.
trusted_chain "$checkout/.git"
[[ "$(git -C "$checkout" rev-parse --show-toplevel)" == "$checkout" &&
   "$(git -C "$checkout" rev-parse HEAD)" == "$sha" ]] || fail 'wrong source identity'
[[ -z "$(git -C "$checkout" status --porcelain --untracked-files=all)" ]] || fail 'dirty source checkout'
current_main
validate_install(){
  local dir="$1" name count expected
  trusted "$dir" dir
  [[ "$(stat -c '%a' -- "$dir")" == 755 ]] || fail 'unexpected tool directory mode'
  trusted "$ENTRY" file
  for name in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
    [[ -e "$name" || -L "$name" ]] || continue
    trusted "$name" file
  done
  count="$(find "$dir" -mindepth 1 -maxdepth 1 -printf x | wc -c)"
  expected=$(("${#files[@]}"+3))
  [[ "$count" == "$expected" ]] || fail 'unexpected installed file inventory'
  for name in "${files[@]}" installer-source-commit entrypoint-sha256 SHA256SUMS; do
    trusted "$dir/$name" file
  done
  # Restrict the checksum manifest to exactly the known local basenames.
  diff -u <(printf '%s\n' "${files[@]}" installer-source-commit entrypoint-sha256 | sort) \
    <(awk 'NF!=2 || length($1)!=64 || $1~/[^a-f0-9]/ {exit 65} {print $2}' "$dir/SHA256SUMS" | sort) >/dev/null ||
    fail 'unexpected checksum manifest entries'
  (cd "$dir" && sha256sum -c --strict --status SHA256SUMS) || fail 'installed checksum mismatch'
  [[ "$(cat "$dir/entrypoint-sha256")" == "$(sha256sum "$ENTRY" | cut -d' ' -f1)" ]] ||
    fail 'entrypoint checksum mismatch'
}
verify_source(){
  local name old
  validate_install "$CURRENT"
  old="$(cat "$CURRENT/installer-source-commit")"
  [[ "$old" =~ ^[a-f0-9]{40}$ ]] || fail 'invalid installed source identity'
  [[ "$old" != "$sha" ]] || fail 'already at requested source'
  git -C "$checkout" merge-base --is-ancestor "$old" "$sha" || fail 'installed source is not an ancestor'
  for name in "${files[@]}" "root-signed-$kind-entrypoint.sh"; do
    trusted "$checkout/ops/release/$name" file
    git -C "$checkout" show "$sha:ops/release/$name" | cmp -s - "$checkout/ops/release/$name" ||
      fail 'source bytes do not match reviewed Git object'
    if [[ "$name" == "$EXTRACTOR" ]]; then
      git -C "$checkout" show "$old:ops/release/$name" | cmp -s - "$CURRENT/$name" ||
        fail 'installed extractor does not match recorded source'
    elif [[ "$name" == "root-signed-$kind-entrypoint.sh" ]]; then
      cmp -s "$ENTRY" "$checkout/ops/release/$name" || fail 'entrypoint requires a different reviewed upgrade'
    else
      cmp -s "$CURRENT/$name" "$checkout/ops/release/$name" ||
        fail 'non-extractor change requires a different reviewed upgrade'
    fi
  done
  if cmp -s "$CURRENT/$EXTRACTOR" "$checkout/ops/release/$EXTRACTOR"; then
    fail 'extractor is already identical'
  fi
  [[ ! -e "$BACKUP" && ! -L "$BACKUP" && ! -e "$FAILED" && ! -L "$FAILED" ]] ||
    fail 'existing rollback or interrupted upgrade requires review'
}
verify_source
if [[ "$action" == --check ]]; then
  echo "extractor_upgrade_preflight=true tool=$kind source_sha=$sha no_files_changed=true"
  exit 0
fi
for lock in "$GLOBAL_LOCK" "$APP_LOCK"; do
  [[ ! -L "$lock" ]] || fail 'unsafe lock path'
  if [[ -e "$lock" ]]; then trusted "$lock" file; fi
done
exec {global_fd}>"$GLOBAL_LOCK"
flock -n "$global_fd" || exit 75
exec {app_fd}>"$APP_LOCK"
flock -n "$app_fd" || exit 75
verify_source
current_main
stage="$(mktemp -d "$ROOT/.tradeos-signed-$kind-extractor.XXXXXXXX")"
moved=0; complete=0
restore(){
  local status=$?
  trap - EXIT
  if (( moved && !complete )); then
    set +e
    if [[ -d "$CURRENT" && ! -L "$CURRENT" && ! -e "$FAILED" && ! -L "$FAILED" ]]; then
      mv -T -- "$CURRENT" "$FAILED" || status=65
    fi
    if [[ ! -e "$CURRENT" && ! -L "$CURRENT" && -d "$BACKUP" && ! -L "$BACKUP" ]]; then
      mv -T -- "$BACKUP" "$CURRENT" || status=65
    fi
    (validate_install "$CURRENT") || status=65
    echo 'Extractor upgrade interrupted; previous toolset retained or restored' >&2
  fi
  # An incomplete staged tool directory is retained for operator review.
  exit "$status"
}
trap restore EXIT
chmod 0755 "$stage"
for name in "${files[@]}"; do
  if [[ "$name" == "$EXTRACTOR" ]]; then
    install -o root -g root -m 0755 "$checkout/ops/release/$name" "$stage/$name"
  else
    install -o root -g root -m "$(stat -c '%a' -- "$CURRENT/$name")" "$CURRENT/$name" "$stage/$name"
  fi
done
printf '%s\n' "$sha" > "$stage/installer-source-commit"
install -o root -g root -m 0444 "$CURRENT/entrypoint-sha256" "$stage/entrypoint-sha256"
chmod 0444 "$stage/installer-source-commit"
(cd "$stage" && sha256sum "${files[@]}" installer-source-commit entrypoint-sha256 > SHA256SUMS && chmod 0444 SHA256SUMS)
validate_install "$stage"
current_main
mv -T -- "$CURRENT" "$BACKUP"; moved=1
mv -T -- "$stage" "$CURRENT"
validate_install "$CURRENT"
[[ "$(cat "$CURRENT/installer-source-commit")" == "$sha" ]] || fail 'incorrect new source identity'
cmp -s "$CURRENT/$EXTRACTOR" "$checkout/ops/release/$EXTRACTOR" || fail 'extractor mismatch'
complete=1
echo "extractor_upgrade_verified=true tool=$kind source_sha=$sha old_tools_preserved=true no_activation=true"
