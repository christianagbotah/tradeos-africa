# TradeOS CI artifact — safe quarantine extraction rehearsal

## Why this is necessary

The GitHub-source-light pipeline (PRs #206/#207) built and authenticated the compiled runtime bundle, but the smoke step previously unpacked via `tar -xzf`. Archives must never be trusted to choose filesystem destinations, including through parent symlinks, hardlinks, path traversal, or special files. This milestone adds a bounded unpacker that **cannot activate a production release**.

## Implementation

- `ops/release/rehearse-ci-artifact-pilot.py` invokes the existing exact-source SHA + SHA-256 + nondeployable manifest inspector before creating an output directory. It only accepts a **new** `tradeos-rehearsal-*` sandbox beneath `/tmp` or GitHub `RUNNER_TEMP`. An existing directory, symlink destination, or production release path is refused. No implicit parent directories are created.
- Paths are normalized, duplicate paths are rejected, and archive entries under a symlink/file/hardlink parent are refused. The extractor writes directories and regular files before internal hardlinks and symlinks. It opens path components using `O_DIRECTORY | O_NOFOLLOW` and creates regular files using `O_NOFOLLOW | O_EXCL`, so archive-controlled link chains cannot redirect writes. Executables retain only bounded 0755 permissions; other files are 0644; setuid/setgid and special entries are rejected by intake.
- The full SHA-256 is checked again after unpacking. Symlink resolution is verified to be within the temporary sandbox. A failed extraction removes only its self-created sandbox, and leaves any pre-existing path untouched.
- GitHub's runtime artifact workflow now runs 24 Python artifact/extractor regression tests before `pnpm install` and uses this extractor instead of `tar -xzf` for the existing isolated runtime smoke (API, Next web/admin and anonymous refund access boundary).
- `ops/release/audit-github-artifact-pilot.sh <exact-main-sha> <run-id> --rehearse` adds an explicit **opt-in** temporary VPS extraction rehearsal behind the existing authenticated GitHub main-run provenance check and shared-host capacity gate. Its temporary directory and extracted content are discarded on return.

## Verified against real approved GitHub artifact

On the authorized shared VPS, the opt-in rehearsal ran against the latest successful **main push** artifact at commit `471a570a69f587368d676f1c81e3b8a6a6df91d2`, GitHub Actions run `44950798468`:

- Compressed archive **63,980,617 bytes**, regular uncompressed content **182,091,548 bytes**, **9,673 members**.
- Main branch/run provenance, checksum, manifest and archive inspection **passed**.
- All **9,673 archive entries were unpacked safely** inside a unique `/tmp/tradeos-ci-intake.*/tradeos-rehearsal-*` directory and all checksum and symlink checks **passed**.
- Temporary quarantine count afterwards was **zero**. Website/admin/API remain healthy, active release `46ab0a6856a7214d90653a770705d8f6b5be23e7`, rollback `c5389569a7c5987791ab7dbdf6f85f7f91943d94` unchanged. No live data, payments, databases, environment file, migration, PM2 process, or release symlink was modified.
- VPS build capacity HOLD remains in place at **90% root storage**, and no heavy local compilation was undertaken.

## Next guarded milestones

This remains a **NONDEPLOYABLE** pilot (`deployable:false`); this sandbox is not a production release path. Full cutover requires an independently reviewed root-owned artifact promotion format/adapter (not an automatic elevation of the pilot), proof of GitHub provenance and checksum at promotion time, a Node 22 compatible application launcher for standalone output, migration safety, read-only financial transaction reconciliation and authenticated POS/refunds/receipt QA, then controlled atomic activation with tested rollback. Do not change the protected deploy workflow to bypass low-disk HOLD.

GitHub workflow path hardening: the smoke step changes its working directory to `$RUNNER_TEMP/tradeos-release-artifact`, so the extractor executable must be referenced from the explicit `$GITHUB_WORKSPACE` checkout. Contract tests pin that absolute checkout-root reference.
