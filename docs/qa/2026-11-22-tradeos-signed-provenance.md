# TradeOS source-light artifact — authenticated GitHub build provenance

**Scope:** secure the **nondeployable** runtime pilot built from an exact GitHub `main` push; **not** an authorization to activate or migrate the live VPS.

## The problem

A local SHA-256 checksum can identify a downloaded file, but it does not prove who produced the bytes. GitHub Actions run metadata verifies the associated run and main branch, but by itself does not cryptographically authenticate the bundle bytes. TradeOS's financial/refund/POS services demand a stronger source-supply-chain boundary before promotion.

## Implemented

1. The GitHub-hosted source-light workflow builds and smokes the isolated API and both standalone Next.js bundles, validates the archive, and then **only on `push` to `refs/heads/main`** signs the tested `.tar.gz` using `actions/attest@v4`. It requests `id-token: write` and `attestations: write` to generate GitHub-backed keyless SLSA v1 provenance. PRs and workflow-dispatch jobs are not signed for acceptance.
2. `ops/release/verify-attested-artifact-pilot.sh` invokes `gh attestation verify` for the **exact archive bytes** and rejects anything without a valid cryptographic signature, SLSA provenance, approved source repository (`christianagbotah/tradeos-africa`), exact signer (`christianagbotah/tradeos-africa/.github/workflows/runtime-artifact-pilot.yml`), `refs/heads/main` and full requested Git commit. Even an unexpected empty successful result is rejected. Files must be nonempty regular files with an exact full-SHA pilot archive name; symlinked archives are rejected.
3. `ops/release/audit-github-artifact-pilot.sh` still requires the exact live GitHub main SHA and a completed successful **push** run, unique unexpired matching artifact, size ceiling, central VPS artifact-capacity gate and authenticated GitHub download. **After download, before archive inspection or optional quarantine extraction**, it now runs the cryptographic verifier. No extraction is permitted if signature/source/branch/signer verification fails.
4. Test coverage: no-network fake-`gh` negative tests for invalid signature, absent/empty results, mismatched SHA, wrong archive name, symlink, missing file and malformed JSON, plus CI deployment-contract assertions that prevent dropping the exact workflow/commit constraints. Previous archive attacks, source-light startup tests and financial authorization smoke remain in CI.

## Rollout boundaries

- The pilot manifest continues to require **`deployable:false`**. Only a separately reviewed, root-controlled deployable artifact format and promotion adapter can switch a release.
- No VPS-side build/install, service restart, migration, backup change, environment secret upload, payment action, cleanup or active release symlink mutation is part of this milestone.
- A successful GitHub signature does **not** establish financial/schema compatibility, migration reversibility, credential validity, live tenant readiness or payment/refund reconciliation. Those are independent deployment gates.
- When validating real signed artifacts on the VPS, use the exact-main script with an authenticated `gh` login: `bash ops/release/audit-github-artifact-pilot.sh <full-main-sha> <successful-main-push-run-id> [--rehearse]`. Never copy repo source files to a root-owned production adapter without reviewed installation procedures.

## Verification

```bash
python3 -m unittest discover -s test -p test_ci_signed_provenance.py -v
python3 -m unittest discover -s test -p test_ci_artifact_intake.py -v
python3 -m unittest discover -s test -p test_source_light_launchers.py -v
node --test test/ci-artifact-pilot-contract.test.mjs
```

The first trusted **main-push** run after merge will confirm that the repository permits GitHub attestations and that the actual VPS `gh attestation verify` accepts the certified GitHub output. No previously unsigned pilot is eligible for signed intake.
