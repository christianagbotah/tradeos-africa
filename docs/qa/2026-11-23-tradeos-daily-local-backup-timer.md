# TradeOS staging — daily local PostgreSQL recovery with no unsafe retention

## What this adds

A dedicated systemd oneshot and timer for the already proven TradeOS PostgreSQL
18 backup and isolated 3-database restore drill. This is NOT a new financial
deployment path, a data migration, or offsite recovery. The service runs one
fixed, checksum-verified, root-private, immutable operator script and uses the
existing app-scoped backup lock. Before each invocation systemd verifies the
script and its pinned source SHA against SHA256SUMS. The script creates a local
private backup only if the dedicated PostgreSQL instance is healthy and root
usage is below 90% with over 6 GiB free; it leaves existing backups intact.

Timer: 05:20 UTC each day, randomized by up to 10 minutes, with 2-minute
accuracy. Persistent=false prevents an unplanned catch-up backup immediately
after installation or reboot. It does not use a loop or retain worktrees.
The service is a lower-priority job (nice 10, low IO priority), with a
15-minute timeout. A failed job remains visible in the systemd journal and
service result; it is NOT silently considered a successful backup.

## First-time protected installation

Only from a clean, root-owned /root checkout of exact current signed and
CI-tested GitHub main, not from an unreviewed worktree or live source path:

    bash ops/release/install-tradeos-staging-backup-timer.sh /root/EXACT_MAIN <full-main-sha> --check
    bash ops/release/install-tradeos-staging-backup-timer.sh /root/EXACT_MAIN <full-main-sha> --install

The installer never enables or starts the timer; it refuses an existing or
symlinked installation, locks out overlapping backups, verifies root ownership,
committed source paths, exact SHA, pristine git status, and GitHub main twice.
It stages a private, SHA-256 pinned script in a root-owned immutable tool
directory, installs the two fixed systemd unit files and reloads systemd.
Partial installs roll back only files newly created by that invocation.
It never touches active application releases, payment records or credentials.

After independent verification of installed checksums, service sandbox settings
and systemd unit syntax, the operator can separately enable the timer:

    systemctl enable --now lightworld-tradeos-staging-backup.timer
    systemctl list-timers --all lightworld-tradeos-staging-backup.timer
    systemctl status lightworld-tradeos-staging-backup.timer
    systemctl show lightworld-tradeos-staging-backup.service -p Result -p ExecMainStatus

Do not print backup archive bytes, PostgreSQL role globals or tenant data in
public GitHub logs. Review local private snapshots and the authenticated
restore-status.json for recovery evidence. Verify no temp restore directory
remains and no other services were restarted.

## Operational safety and blockers

The latest verified first real backup/isolated restore is from 2026-11-23,
at /home/lightworld/backups/tradeos-staging-databases/20261123T163353Z:
3/3 isolated restores, 60/60 applied migrations, 5/5 key financial tables.
Keep at least one verified backup. No automatic pruning is permitted until
encrypted offsite replication and independently tested restoration exists;
the timer's capacity gate will fail closed rather than delete history.

Offsite restic preflight currently reports NO_REMOTE_TARGET_CONFIGURED. This
timer provides same-host recovery only. No financial release cutover is
authorized by a local backup or by the timer being active. Signed source-light
release promotion, finance-state reconciliation, offsite restore and atomic
rollback are separately tracked by issue #204.
