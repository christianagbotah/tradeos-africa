# TradeOS staging PostgreSQL 18 — dedicated backup and isolated restore

## Safety scope
The reviewed root-only operator script is fixed to the TradeOS staging PostgreSQL
18 Unix socket (port 56380) and three databases: tradeos_staging,
tradeos_account_ctrl_test, and tradeos_settings_v2_test. It does not access
other VPS projects or change a running application.

The script accepts ONLY --check and --backup-restore. Unknown paths and
untrusted symlinks fail closed. Root filesystem utilization >=90 percent,
or <=6 GiB available, blocks new backup operations. An app-scoped flock
prevents concurrent backups. Backups are private root-owned 0700 directories
under /home/lightworld/backups/tradeos-staging-databases/<UTC timestamp>
with files 0600. No automatic pruning of prior verified backups.

Each database uses an MVCC-consistent PostgreSQL custom archive; cluster roles
are separately dumped as globals.sql (this includes sensitive role information
and must NEVER be published). SHA-256 digests are verified. An independently
initialized PostgreSQL 18 test cluster listens ONLY through its private
Unix socket (listen_addresses disabled); all three dumps are restored and
verified. The staging migration ledger must be fully APPLIED and the
restored database must contain payments, refunds, sync, outbox and Hubtel
checkout tables. The test cluster is stopped before the verified archives
are moved atomically to their final root-private directory.

## Manual operator commands — only after protected review/CI

bash ops/release/tradeos-staging-backup-restore.sh --check
bash ops/release/tradeos-staging-backup-restore.sh --backup-restore

The second command creates real local backup files and executes an isolated
restore only. There is no automatic timer, no SQL writes in source databases,
no PM2 change, no API restart, no user transaction modification, no deployment
and no release symlink switch. Never publish backups, globals, credentials,
SQL error logs, tenant rows or financial data in GitHub.

## Unresolved disaster recovery
A same-host backup is not sufficient disaster recovery. The script always
reports offsiteVerified:false and cutoverAuthorized:false. Independently
verify encrypted offsite replication, recovery-key escrow, role reconstitution,
external object/media backups, finance queue reconciliation, and a reversible
release cutover before enabling deployment. The GitHub signed artifact pilot
remains deployable:false and issue #204 stays open.
