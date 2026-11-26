#!/usr/bin/env bash
set -euo pipefail
# Verify a GitHub-signed SLSA provenance statement bound to this exact archive
# and main source commit. This script is read-only and cannot deploy anything.
if [[ "$#" -ne 2 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'usage: verify-attested-runtime-release.sh <full-main-sha> <archive-path>' >&2
  exit 64
fi
sha="$1"
archive="$2"
repo='christianagbotah/tradeos-africa'
signer="$repo/.github/workflows/runtime-release.yml"
name="tradeos-runtime-release-$sha.tar.gz"
if [[ "$archive" != /* || "$(basename -- "$archive")" != "$name" ||
      ! -f "$archive" || -L "$archive" || ! -s "$archive" ]]; then
  echo 'Attestation rejected: expected regular, nonempty, exact-SHA release archive' >&2
  exit 65
fi
for tool in gh jq mktemp; do
  command -v "$tool" >/dev/null || { echo "Required verifier not found: $tool" >&2; exit 65; }
done
# GitHub CLI checks the cryptographic signature, signed certificate identity,
# source commit, branch, workflow signer and digest of the exact local bytes.
# A SHA-256 .sha256 file alone is not trusted provenance.
result_file="$(mktemp -p /tmp tradeos-provenance.XXXXXXXXXX)"
trap 'rm -f -- "$result_file"' EXIT
if ! gh attestation verify "$archive" \
  --repo "$repo" \
  --signer-workflow "$signer" \
  --source-ref 'refs/heads/main' \
  --source-digest "$sha" \
  --predicate-type 'https://slsa.dev/provenance/v1' \
  --format json > "$result_file"; then
  echo 'Attestation rejected: signature, archive digest, signer, branch or source does not verify' >&2
  exit 65
fi
# Fail closed even if the CLI ever returns exit 0 with an empty result array.
if ! jq -e 'type == "array" and length > 0' "$result_file" >/dev/null; then
  echo 'Attestation rejected: no verified SLSA provenance results' >&2
  exit 65
fi
printf 'attestationVerified=true sourceCommit=%s signer=%s\n' "$sha" "$signer"
