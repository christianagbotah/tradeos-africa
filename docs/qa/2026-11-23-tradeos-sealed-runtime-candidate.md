# TradeOS — temporary sealed runtime candidate (nondeployable)

## Purpose

The GitHub-signed exact-main source-light pilot has passed cryptographic verification, safe archive inspection, isolated extraction, and live-staging PostgreSQL migration-ledger reconciliation (60/60 migrations applied in the previous verified run). This milestone adds a content-fingerprinted, root-read-only **temporary candidate**. It is not an activation mechanism and it is not installed as the root-owned production deployment adapter.

## Candidate gate

`audit-github-artifact-pilot.sh <full-current-main-sha> <successful-main-push-run-id> --rehearse --ledger-readonly --seal-candidate`

The flags are positional and `--seal-candidate` is accepted *only* after `--ledger-readonly`, which in turn requires safe `--rehearse`. The wrapper verifies GitHub source and the completed exact-main workflow, applies the central VPS artifact-capacity gate, downloads a unique published artifact, authenticates its signed SLSA attestation bound to the exact file digest/workflow/branch/commit, checks its checksum and nondeployable manifest, and extracts it in a new root-owned `/tmp/tradeos-ci-intake.*/tradeos-rehearsal-<SHA>` quarantine.

The app-principal read-only ledger check must report fully applied matching migrations before sealing. No payments, orders, refunds, transactions or receipt records are queried or written. The staging environment file remains external, restricted to the application owner, and is never embedded in the runtime archive.

`seal-ci-artifact-candidate.py` is a **root-only** CLI and validates the exact temporary candidate path, owner and manifest (`deployable:false`); recursively inspects each file, directory, internal symlink and hardlink, detects external links, special files, oversize and unexpected ownership, and hashes file bytes and executable modes into an overall SHA-256 fingerprint. It makes all regular files and directories read-only (executables `0555`, files `0444`, directories `0555`) and re-verifies the content fingerprint. The attestation and archive integrity must already have been authenticated by the wrapper; the sealer alone does **not** prove origin.

**The wrapper's trap deletes the entire candidate and downloaded archive on success or failure.** No release directory, `CURRENT_LINK`, PM2 process, trusted deployment registry, SQL migration or private transaction data is changed. `authorizedToDeploy:false` remains an explicit result. This prototype intentionally does not retain more than the two existing active/rollback TradeOS releases on the shared VPS.

## Tests

`python3 -B -m unittest discover -s test -p test_ci_candidate_seal.py -v` (11 tests) exercises sealed modes/fingerprint, internal links, escaped/symlinked parents, hardlinks to external files, special FIFOs, wrong SHA/path, tampering, and explicit rejection of a deployable manifest. Existing signed-provenance, archive, launcher and read-only migration tests are preserved; the GitHub artifact workflow includes candidate tests before dependency installation.

## Next step after this milestone

A separate root-owned **installed** deployment adapter, with independent approvals, protected finance reconciliation/backups, genuine deployable release schema and acceptance gates, is required before any persistent runtime promotion. Temporary root-run verification from a reviewed exact-main checkout is not a substitute for a root-installed trust boundary. Do not call this a source-light deployment cutover or production release.
