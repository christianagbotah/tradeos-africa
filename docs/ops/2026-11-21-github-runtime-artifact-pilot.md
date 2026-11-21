# TradeOS Africa — GitHub runtime artifact pilot (not a staging cutover)

The shared VPS build capacity check returned HOLD at 90% disk usage. The live staging release stays at `46ab0a6856a7214d90653a770705d8f6b5be23e7` with its verified rollback. No dependency install, compilation or app restart was performed on the VPS for this pilot.

## What this PR does

GitHub-hosted Ubuntu builds the exact commit with locked pnpm dependencies, compiles the API, and creates traced Next standalone web/admin bundles only when `TRADEOS_CI_ARTIFACT=1`. A script packages the API production runtime, web/admin bundles, and SQL migrations, excluding application development source, environment files, persistent databases, uploads, backups and transaction data. An explicit manifest contains the source commit and `deployable=false`. The tarball includes a SHA-256 checksum. CI verifies integrity after extraction and smokes all three services and the unauthenticated refund access boundary. Artifacts expire after three days.

**This is a CI artifact pilot, not live deployment migration.** The current protected staging workflow and launchers are unchanged; no VPS artifact extraction, PM2 changes, database migration or financial mutation is authorized by it.

## Required before cutover

1. Prove zipped artifact size, runtime symlinks, Node 22 and font/static asset compatibility; run authenticated POS, refunds, receipt/PDF and administrator UAT on extracted build.
2. Create a separate root-owned exact SHA and checksum verifying artifact fetch/extraction adapter. Use the shared VPS capacity check with `artifact <compressed-MiB>` before extraction. Do not bypass staging deployment source and role authorization.
3. Demonstrate backward-compatible database migration and exact-once payment/stock/refund reconciliation across rollback before a controlled atomic switch.
4. Implement safe app-scoped pruning of only obsolete TradeOS releases after checking current and previous release, running processes and symlinks. Never delete user data, other project files, pending jobs, backups or unpushed source.
5. Keep GitHub issue #204 open until artifact cutover and retention are verified.

## Baseline

VPS root: 313 GB total, 277 GB used, 34 GB available, 90% usage. Protected deployed source SHA: `46ab0a6856a7214d90653a770705d8f6b5be23e7`. No VPS build was attempted under the capacity HOLD.
