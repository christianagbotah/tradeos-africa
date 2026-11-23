# TradeOS installed candidate auditor — absolute runuser path and controlled upgrade

## Observed root-installed failure, 2026-11-23

From the reviewed and merged `main` SHA `43c31354335eeb467d3b84e81d2d585e4eec7d91`, installed root-only auditor `/usr/local/sbin/lightworld-tradeos-candidate-audit` proved **GitHub main push provenance, cryptographic SLSA attestation, archive SHA-256, and quarantine extraction (9,677 entries)**. The subsequent live read-only migration-ledger step failed safely before any DB query because the sanitized execution path lacked `/usr/sbin/runuser` on the Red Hat-family Lightworld VPS. The audit aborted (`127`), automatically deleted the downloaded archive and quarantine, and did **not** change active/rollback releases, financial records or services. Existing root-installed scripts and their SHA256SUMS were verified intact after failure. Staging API, web, admin and public health remained green.

## Correction

- The audited ledger script now requires the **absolute trusted `/usr/sbin/runuser`** and rejects it if absent.
- The clean root-owned entrypoint PATH includes `/usr/sbin` and `/usr/local/sbin` alongside `/usr/bin` and `/bin`, while preserving `env -i` so caller tokens, `DATABASE_URL` or PATH cannot choose a different database or executable.
- `ops/release/upgrade-root-candidate-auditor.sh` adds an explicitly reviewed, **one-time upgrade** of the fixed root-owned, nondeploying auditor. It never updates apps/PM2/services, builds/installs dependencies, reads transaction data or executes migrations.

## Upgrade command contract

After this fix has passed protected CI and landed on the GitHub `main` commit that built a successfully signed archive, use a clean canonical exact-main root-owned worktree:

```bash
bash ops/release/upgrade-root-candidate-auditor.sh /absolute/clean/checkout <full-current-main-sha> --check
bash ops/release/upgrade-root-candidate-auditor.sh /absolute/clean/checkout <full-current-main-sha> --upgrade
/usr/local/sbin/lightworld-tradeos-candidate-audit <full-current-main-sha> <successful-main-push-run-id>
```

The upgrade refuses to run without root, a current-main source identity check, an existing checksum-verified root-owned auditor/launcher, the app-scoped `tradeos-africa.staging.lock` and **no preexisting backup or failed-upgrade directory**. It moves only its own old root tool directory and launcher into fixed rollback locations, invokes the one-time installer to atomically install and verify the new signed-main reviewed code, and checks the new manifest/entrypoint/source identity. An interrupted or failed upgrade preserves failed new files separately and restores only the old files that were actually moved. No auto-deletion of backup and no second upgrade until independently reviewed housekeeping.

The installed tool itself remains **nondeployable**. A successful signed-candidate rehearsal only authenticates the release, checks the live migration ledger through `BEGIN READ ONLY` and `ROLLBACK`, then fingerprints/seals and deletes temporary runtime bytes. It never changes the live API, web/admin deployment or its rollback.

## Verification

`node --test test/root-candidate-auditor-upgrade.test.mjs test/root-candidate-auditor.test.mjs test/ci-artifact-pilot-contract.test.mjs` adds root upgrade negative tests, one-backup/lock/rollback contracts and absolute `runuser` regression. CI still runs archive/signature/sealing/migration/launcher tests and protected domain/desktop/visual checks. After merge, rerun the **actual root-installed** signed main push audit, verify `60/60` migration ledger, root-owned sealed candidate, zero /tmp leftovers, unmodified active/rollback releases and site health. Record real results in issue #204.
