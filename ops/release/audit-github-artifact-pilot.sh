#!/usr/bin/env bash
set -euo pipefail
# Read-only provenance and archive safety audit. No extraction, deploy, migrations,
# service restart or persistent artifact cache; safe under shared-host build HOLD.
if [[ "$#" -ne 2 || ! "$1" =~ ^[0-9a-f]{40}$ || ! "$2" =~ ^[0-9]+$ ]]; then
  echo 'usage: audit-github-artifact-pilot.sh <exact-main-sha> <GitHub-workflow-run-id>' >&2
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
python3 "$script_dir/inspect-ci-artifact-pilot.py" "$sha" "$quarantine"
echo 'VPS intake: verified nondeployable pilot; no switch, migration, restart or extraction.'
