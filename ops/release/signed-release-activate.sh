#!/bin/bash
set -euo pipefail
# Explicitly approved, authenticated TradeOS staging cutover.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin
repo=christianagbotah/tradeos-africa
if [[ $# != 3 || "$3" != "$1" || ! "$1" =~ ^[0-9a-f]{40}$ || ! "$2" =~ ^[0-9]{1,18}$ ]] || (( EUID != 0 )); then
  echo 'usage: root-only signed-release-activate.sh <exact-main-sha> <successful-release-run-id> <approve-same-sha>' >&2; exit 64
fi
sha="$1"; run="$2"
usage="$(df -P / | awk 'NR==2{gsub(/%/,"",$5);print $5}')"
free="$(df -Pk / | awk 'NR==2{print $4}')"
[[ "$usage" =~ ^[0-9]+$ && "$free" =~ ^[0-9]+$ ]] && (( usage < 90 && free > 6291456 )) || {
  echo 'Activation held: fresh backup/restore capacity policy' >&2; exit 65;
}
lock=/var/lock/lightworld-deploy/tradeos-africa.staging.lock
[[ -d /var/lock/lightworld-deploy && ! -L /var/lock/lightworld-deploy && "$(stat -c %u /var/lock/lightworld-deploy)" == 0 && ! -L "$lock" ]] || exit 65
mode="$(stat -c %a /var/lock/lightworld-deploy)"; (( (8#$mode & 0022)==0 )) || exit 65
[[ ! -e "$lock" || -f "$lock" ]] || exit 65
global=/var/lock/lightworld-deploy/heavy-deploy.lock
[[ ! -L "$global" && ( ! -e "$global" || -f "$global" ) ]] || exit 65
exec {global_fd}>"$global"
flock -n "$global_fd" || exit 75
exec {lock_fd}>"$lock"
flock -n "$lock_fd" || exit 75
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
[[ "$(gh api "repos/$repo/branches/main" --jq .commit.sha)" == "$sha" ]] || exit 65
gh api "repos/$repo/actions/runs/$run" | jq -e --arg sha "$sha" --arg repo "$repo" '
 .head_sha==$sha and .head_repository.full_name==$repo and
 .path==".github/workflows/runtime-release.yml" and
 .name=="TradeOS Signed Runtime Release Candidate" and .event=="push" and
 .head_branch=="main" and .status=="completed" and .conclusion=="success"' >/dev/null
name="tradeos-runtime-release-$sha"
bytes="$(gh api "repos/$repo/actions/runs/$run/artifacts" | jq -er --arg name "$name" '[.artifacts[]|select(.name==$name and .expired==false and .size_in_bytes>0)]|if length==1 then .[0].size_in_bytes else error("invalid release inventory") end')"
[[ "$bytes" =~ ^[0-9]+$ && "$bytes" -le 1073741824 ]] || exit 65
/usr/local/sbin/lightworld-vps-capacity-check artifact "$(( (bytes+1048575)/1048576 ))"
q="$(mktemp -d /tmp/tradeos-activation.XXXXXXXX)"
# Cleanup is bounded to this unique temporary directory.
cleanup(){ [[ "$q" == /tmp/tradeos-activation.* && -d "$q" && ! -L "$q" ]] && rm -rf --one-file-system -- "$q"; }; trap cleanup EXIT
gh run download "$run" --repo "$repo" --name "$name" --dir "$q"
bash "$script_dir/verify-attested-runtime-release.sh" "$sha" "$q/$name.tar.gz"
root="$q/tradeos-rehearsal-$sha"
python3 -B "$script_dir/rehearse-signed-runtime-release.py" "$sha" "$q" "$root"
registry=/etc/lightworld-deploy/apps.d/tradeos-africa.staging.conf
[[ -f "$registry" && ! -L "$registry" && "$(stat -c %u "$registry")" == 0 ]] || exit 65
mode="$(stat -c %a "$registry")"; (( (8#$mode & 0022)==0 )) || exit 65
env_file=/home/lightworld/shared/tradeos-staging/.env.staging
[[ "$(sed -nE "s/^ENV_FILE='([^']+)'$/\1/p" "$registry")" == "$env_file" ]] || exit 65
[[ -f "$env_file" && ! -L "$env_file" && "$(stat -c '%U:%a' "$env_file")" == lightworld:600 ]] || exit 65
chgrp lightworld "$q" "$root"
chmod 0750 "$q" "$root"
# The root-owned adapter verifies the live identity and runs the controlled cutover.
# The locks remain held for the entire Node child process.
/usr/bin/node "$script_dir/activate-signed-runtime.mjs" "$sha" "$root" "$3"
