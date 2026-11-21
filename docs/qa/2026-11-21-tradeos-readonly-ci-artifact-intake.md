# TradeOS — read-only CI artifact acceptance gate

This milestone **does not deploy the CI artifact**. It establishes reproducible checks required before a future GitHub-built runtime cutover, without compiling on a shared VPS at 90% disk usage.

## Verified artifact

- GitHub workflow **TradeOS Source-Light Runtime Artifact Pilot**, successful main push run `44946058732`, commit `eac887fd0f3d599e6c1d123d2dfd69e49b26833c`.
- Authenticated `gh api` verifies the exact repository, workflow path, success state, push event, main branch, commit and a unique unexpired SHA-named artifact.
- The shared capacity gate permits an audit of the 61 MiB GitHub artifact. The intake accepts only the matching SHA/checksum/manifest and validates the compressed archive in a **streaming, read-only scan**. No filesystem extraction is performed.
- Baseline audit: **63,983,872 bytes** compressed archive; **182,099,644 bytes** summed regular members; **9,681 entries**. Source SHA, required Node 22, and `deployable:false` verified. Production files needed for the API, web/admin standalone entrypoints and migrations present.
- Archive scanner rejects path traversal, control-character paths, duplicates, special devices/FIFOs, privileged file modes, oversized archives, external/broken/cyclic symlinks, external/missing hardlinks, source/credential directories, bad checksum, missing runtime files and mismatched manifest. Legitimate internal package hardlinks remain supported.
- CI runs the pure-stdlib malicious archive regression suite **before any dependency installation**, then audits the actual generated artifact before the existing standalone runtime smoke test. The original pilot remains GitHub-hosted; no self-hosted deployment job was added.

## Re-run on authorized VPS (audit only)

Run from a **verified checkout** of the exact GitHub main version:

```bash
bash ops/release/audit-github-artifact-pilot.sh \
  eac887fd0f3d599e6c1d123d2dfd69e49b26833c 44946058732
```

The shell wrapper requires the requested SHA to be **current GitHub main**, so historical runs are rejected after later commits. It retrieves the short-lived artifact from GitHub into a uniquely named temp directory, checks current shared-VPS capacity, scans the archive without extraction, and destroys only its own temporary download. No PM2 restart, schema migration, receipt/payment modification, environment-file copy, live symlink switch, or use of merchant credentials.

## Still blocked from cutover

The archived manifest explicitly declares `deployable:false`; no deploy command will ever activate it. A separate, reviewed, root-owned release adapter must produce an approved deployable artifact format, validate signing/provenance and package root, extract safely with strict disk headroom, rehearse an isolated runtime with read-only database fixtures, verify payments and refund reconciliation, then atomically switch under the app deployment lock with rollback. Retention currently preserves the active and previous release. Do not bypass `/usr/local/sbin/lightworld-vps-capacity-check build` while the shared disk is at 90%.
