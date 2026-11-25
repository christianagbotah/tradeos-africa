#!/bin/bash
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
# Install the explicit-approval activation command; installation alone never activates a release.
# Must be invoked against a verified, clean checkout of exact GitHub main.
# Deliberately one-time install: upgrades require independent reviewed code.
INSTALL_ROOT='/usr/local/libexec/lightworld-deploy'
INSTALL_DIR="$INSTALL_ROOT/tradeos-signed-activate"
ENTRYPOINT='/usr/local/sbin/lightworld-tradeos-signed-activate'
SCRIPT_FILES=(
  signed-release-activate.sh
  activate-signed-runtime.mjs
  controlled-cutover.mjs
  release-retention-plan.mjs
  verify-attested-runtime-release.sh
  inspect-ci-artifact-pilot.py
  rehearse-ci-artifact-pilot.py
  rehearse-signed-runtime-release.py
  check-promotion-migrations.mjs
  check-promotion-finance.mjs
  check-signed-release-readiness.mjs
  check-root-backup-evidence.py
)
usage() { echo 'usage: install-root-signed-activate.sh <absolute-clean-repo-checkout> <exact-current-main-sha> [--check|--install]' >&2; }
if [[ $# -ne 3 || ! "$2" =~ ^[0-9a-f]{40}$ ||
      ( "$3" != '--check' && "$3" != '--install' ) || "$1" != /* ]]; then
  usage; exit 64
fi
checkout="$1"; sha="$2"; action="$3"
[[ -d "$checkout" && ! -L "$checkout" && "$(realpath -e "$checkout")" == "$checkout" ]] || {
  echo 'Source must be an existing absolute canonical non-symlink directory' >&2; exit 65;
}
[[ "$(git -C "$checkout" rev-parse --show-toplevel)" == "$checkout" ]] || exit 65
[[ "$(git -C "$checkout" rev-parse HEAD)" == "$sha" ]] || {
  echo 'Source checkout does not match requested SHA' >&2; exit 65;
}
[[ -z "$(git -C "$checkout" status --porcelain --untracked-files=all)" ]] || {
  echo 'Source checkout is dirty or contains untracked files' >&2; exit 65;
}
[[ "$(gh api repos/christianagbotah/tradeos-africa/branches/main --jq '.commit.sha')" == "$sha" ]] || {
  echo 'Refuse to install anything other than exact current GitHub main' >&2; exit 65;
}
for name in "${SCRIPT_FILES[@]}" root-signed-activate-entrypoint.sh; do
  path="$checkout/ops/release/$name"
  [[ -f "$path" && ! -L "$path" && "$(stat -c '%F' "$path")" == 'regular file' ]] || exit 65
  git -C "$checkout" ls-files --error-unmatch -- "ops/release/$name" >/dev/null || {
    echo 'Installer requires every source script committed in Git' >&2; exit 65;
  }
done
if [[ "$action" == '--check' ]]; then
  echo "auditor_source_verified=true source_sha=$sha installation_performed=false"
  exit 0
fi
(( EUID == 0 )) || { echo 'Auditor install requires root' >&2; exit 65; }
# A reviewed commit is not enough if another local principal can replace the
# checkout between Git identity checks and privileged file installation.
for item in "$checkout" "$checkout/ops" "$checkout/ops/release"; do
  [[ -d "$item" && ! -L "$item" && "$(stat -c '%u' -- "$item")" == 0 ]] || {
    echo 'Root installation requires a root-owned source path' >&2; exit 65;
  }
  item_mode="$(stat -c '%a' -- "$item")"
  if (( (8#$item_mode & 0022) != 0 )); then
    echo 'Refusing writable install source directory' >&2; exit 65;
  fi
done
for name in "${SCRIPT_FILES[@]}" root-signed-activate-entrypoint.sh; do
  item="$checkout/ops/release/$name"
  [[ "$(stat -c '%u' -- "$item")" == 0 ]] || {
    echo 'Refusing unowned candidate auditor source file' >&2; exit 65;
  }
  item_mode="$(stat -c '%a' -- "$item")"
  if (( (8#$item_mode & 0022) != 0 )); then
    echo 'Refusing writable candidate auditor source file' >&2; exit 65;
  fi
done
[[ -d "$INSTALL_ROOT" && ! -L "$INSTALL_ROOT" && "$(stat -c '%u' "$INSTALL_ROOT")" == '0' ]] || {
  echo 'Lightworld deployment tool directory is not trusted' >&2; exit 65;
}
[[ ! -e "$INSTALL_DIR" && ! -L "$INSTALL_DIR" && ! -e "$ENTRYPOINT" && ! -L "$ENTRYPOINT" ]] || {
  echo 'Auditor already installed; no overwrite or auto-upgrade allowed' >&2; exit 65;
}
# Atomic within existing trusted root directory; do not build or install any
# runtime/dependencies, and do not touch tradeos-staging release/credentials.
staged="$(mktemp -d "$INSTALL_ROOT/.tradeos-signed-activate.XXXXXXXX")"
cleanup_installer() {
  if [[ -n "${staged:-}" && "$staged" == "$INSTALL_ROOT"/.tradeos-signed-activate.* && -d "$staged" ]]; then
    rm -rf --one-file-system -- "$staged" || true
  fi
  if [[ -n "${entry_temp:-}" && "$entry_temp" == /usr/local/sbin/.lightworld-tradeos-signed-activate.* && -f "$entry_temp" ]]; then
    rm -f -- "$entry_temp" || true
  fi
  return 0
}
trap cleanup_installer EXIT
chmod 0755 "$staged"
for name in "${SCRIPT_FILES[@]}"; do
  case "$name" in
    *.sh|*.py) mode=0755;;
    *.mjs) mode=0644;;
  esac
  install -o root -g root -m "$mode" "$checkout/ops/release/$name" "$staged/$name"
done
printf '%s\n' "$sha" > "$staged/installer-source-commit"
# Pin the immutable launcher too, not only its sibling verification scripts.
sha256sum "$checkout/ops/release/root-signed-activate-entrypoint.sh" | cut -d' ' -f1 > "$staged/entrypoint-sha256"
chmod 0444 "$staged/entrypoint-sha256"
chmod 0444 "$staged/installer-source-commit"
(
  cd "$staged"
  sha256sum "${SCRIPT_FILES[@]}" installer-source-commit entrypoint-sha256 > SHA256SUMS
  chmod 0444 SHA256SUMS
  sha256sum -c --status SHA256SUMS
)
entry_temp="$(mktemp /usr/local/sbin/.lightworld-tradeos-signed-activate.XXXXXXXX)"
install -o root -g root -m 0755 "$checkout/ops/release/root-signed-activate-entrypoint.sh" "$entry_temp"
# Recheck current main immediately before moving a privileged installation
# into place. A new main commit must cause this exact-SHA installation to stop.
[[ "$(gh api repos/christianagbotah/tradeos-africa/branches/main --jq '.commit.sha')" == "$sha" ]] || {
  echo 'Main advanced during installation; refusing to install' >&2
  exit 65
}
mv -T -- "$staged" "$INSTALL_DIR"
staged=''
mv -T -- "$entry_temp" "$ENTRYPOINT"
entry_temp=''
echo "auditor_installed=true source_sha=$sha installation_only=true no_database_writes=true"
