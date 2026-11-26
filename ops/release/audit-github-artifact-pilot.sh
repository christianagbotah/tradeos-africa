#!/usr/bin/env bash
set -euo pipefail
# Read-only provenance and archive safety audit. No extraction, deploy, migrations,
# service restart or persistent artifact cache; safe under shared-host build HOLD.
if [[ "$#" -lt 2 || "$#" -gt 5 || ! "$1" =~ ^[0-9a-f]{40}$ || ! "$2" =~ ^[0-9]+$ ||
      ( "$#" -ge 3 && "$3" != '--rehearse' ) ||
      ( "$#" -ge 4 && "$4" != '--ledger-readonly' ) ||
      ( "$#" -eq 5 && "$5" != '--seal-candidate' ) ]]; then
  echo 'usage: audit-github-artifact-pilot.sh <exact-main-sha> <GitHub-workflow-run-id> [--rehearse [--ledger-readonly [--seal-candidate]]]' >&2
  exit 64
fi
sha="$1"; run_id="$2"
repo='christianagbotah/tradeos-africa'
for tool in gh jq python3 mktemp; do
  command -v "$tool" >/dev/null || { echo "Missing required utility: $tool" >&2; exit 65; }
done
main_sha="$(gh api "repos/$repo/branches/main" --jq '.commit.sha')"
[[ "$main_sha" == "$sha" ]] || { echo 'Rejected: requested artifact is not exact current main' >&2; exit 65; }
run_json="$(gh api "repos/$repo/actions/runs/$run_id")"
if ! jq -e --arg sha "$sha" --arg repo "$repo" '
  .head_sha == $sha and
  .head_repository.full_name == $repo and
  .name == "TradeOS Source-Light Runtime Artifact Pilot" and
  .path == ".github/workflows/runtime-artifact-pilot.yml" and
  .event == "push" and .head_branch == "main" and
  .status == "completed" and .conclusion == "success"' <<< "$run_json" >/dev/null; then
  echo 'Rejected: GitHub Actions workflow provenance or completion mismatch' >&2
  exit 65
fi
artifact_name="tradeos-runtime-pilot-$sha"
artifact_json="$(gh api "repos/$repo/actions/runs/$run_id/artifacts")"
artifact_bytes="$(jq -er --arg name "$artifact_name" '
  [.artifacts[] | select(.name==$name and .expired==false and .size_in_bytes>0)] |
  if length == 1 then .[0].size_in_bytes else error("missing, duplicate or expired artifact") end
' <<< "$artifact_json")"
if [[ ! "$artifact_bytes" =~ ^[0-9]+$ || "$artifact_bytes" -gt 1073741824 ]]; then
  echo 'Rejected: uploaded artifact exceeds 1 GiB safety cap' >&2
  exit 65
fi
compressed_mib="$(( (artifact_bytes + 1048575) / 1048576 ))"
# Central policy: temporary 4x extraction headroom, although this audit never
# extracts or activates bundles. Honor HOLD rather than removing shared data.
/usr/local/sbin/lightworld-vps-capacity-check artifact "$compressed_mib"
quarantine="$(mktemp -d /tmp/tradeos-ci-intake.XXXXXXXXXX)"
cleanup() {
  if [[ -n "${quarantine:-}" && "$quarantine" == /tmp/tradeos-ci-intake.* && -d "$quarantine" ]]; then
    rm -rf --one-file-system -- "$quarantine"
  fi
}
trap cleanup EXIT
# Authenticated GitHub CLI fetch. Untrusted arguments never become file names.
gh run download "$run_id" --repo "$repo" --name "$artifact_name" --dir "$quarantine"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# Now require cryptographically signed provenance (not just the uploaded
# checksum and GitHub API run metadata). An unsigned/PR/foreign artifact fails
# before any extraction or attempt to read a private deployment environment.
bash "$script_dir/verify-attested-artifact-pilot.sh" \
  "$sha" "$quarantine/tradeos-runtime-pilot-$sha.tar.gz"
python3 "$script_dir/inspect-ci-artifact-pilot.py" "$sha" "$quarantine"
if [[ "$#" -ge 3 ]]; then
  # This is a temporary rehearsal of a NONDEPLOYABLE artifact. It creates no
  # production release, migration, service or persistent sandbox.
  rehearsal="$quarantine/tradeos-rehearsal-$sha"
  PYTHONDONTWRITEBYTECODE=1 python3 -B "$script_dir/rehearse-ci-artifact-pilot.py" "$sha" "$quarantine" "$rehearsal"
  if [[ "$#" -ge 4 ]]; then
    # Root explicitly opts into a live-ledger READ-ONLY comparison. The app
    # principal, not the root deployer, connects to PostgreSQL. The command
    # only issues BEGIN READ ONLY, SELECT and ROLLBACK; no schema changes.
    if (( EUID != 0 )); then
      echo 'Ledger read-only mode requires the trusted root operator' >&2
      exit 65
    fi
    registry='/etc/lightworld-deploy/apps.d/tradeos-africa.staging.conf'
    if [[ ! -f "$registry" || -L "$registry" || "$(stat -c '%u' -- "$registry")" != 0 ]]; then
      echo 'Missing trusted root-owned TradeOS staging registry' >&2
      exit 65
    fi
    registry_mode="$(stat -c '%a' -- "$registry")"
    if (( (8#$registry_mode & 0022) != 0 )); then
      echo 'TradeOS staging registry must not be group/other writable' >&2
      exit 65
    fi
    env_file="$(sed -nE "s/^ENV_FILE='([^']+)'$/\1/p" "$registry")"
    if [[ "$env_file" != /* || ! -f "$env_file" || -L "$env_file" ]]; then
      echo 'Missing trusted external TradeOS environment file' >&2
      exit 65
    fi
    if [[ "$(stat -c '%u' -- "$env_file")" != 0 &&
          "$(stat -c '%U' -- "$env_file")" != 'lightworld' ]]; then
      echo 'Untrusted external environment file owner' >&2
      exit 65
    fi
    env_mode="$(stat -c '%a' -- "$env_file")"
    if (( (8#$env_mode & 0077) != 0 )); then
      echo 'TradeOS external financial credentials must be owner-only readable' >&2
      exit 65
    fi
    # mktemp directories default 0700. Open the *already authenticated*
    # sandbox read-only to the app user without exposing it to other tenants.
    app_group="$(id -gn lightworld)"
    chgrp -- "$app_group" "$quarantine" "$rehearsal"
    chmod 0750 -- "$quarantine" "$rehearsal"
    # Clear inherited operator/environment values (especially DATABASE_URL),
    # forcing the trusted 0600 external file to be the ONLY source of DB credentials.
    # runuser belongs to /usr/sbin on supported RHEL-family VPS images.
    # Use the absolute trusted path, independent of the root command PATH.
    [[ -x /usr/sbin/runuser ]] || { echo 'Missing trusted runuser binary' >&2; exit 65; }
    /usr/sbin/runuser -u lightworld -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/home/lightworld \
      /usr/bin/node "--env-file=$env_file" \
      "$script_dir/check-promotion-migrations.mjs" "$rehearsal" "$sha"
    if [[ "$#" -eq 5 ]]; then
      # Root-operated prototype only: the exact signed pilot is still NOT
      # deployable. Seal an ephemeral, root-owned, read-only content snapshot
      # after cryptographic provenance, safe unpack, and ledger compatibility.
      # It cannot create anything under RELEASE_ROOT or change PM2/symlinks.
      PYTHONDONTWRITEBYTECODE=1 python3 -B \
        "$script_dir/seal-ci-artifact-candidate.py" "$sha" "$rehearsal"
    fi
  fi
  echo 'VPS rehearsal: safely unpacked in isolated quarantine; automatic temp cleanup follows.'
else
  echo 'VPS intake: verified nondeployable pilot; no switch, migration, restart or extraction.'
fi
