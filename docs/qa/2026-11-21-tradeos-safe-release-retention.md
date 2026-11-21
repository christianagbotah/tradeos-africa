# TradeOS staging — opt-in release retention

## Goal

Keep GitHub as immutable source history and keep only the **active deployment** and **one tested rollback** under `/home/lightworld/releases/tradeos-staging`. This avoids staging releases endlessly accumulating on the shared VPS. It does **not** clean private or shared data, PostgreSQL, environment configuration, package caches, backups, or other applications.

## Safety contract

- Retention is **off by default** for every application. Only an explicit `RELEASE_RETENTION=active-and-rollback` in a root-owned app registry enables it. The canonical TradeOS staging example opts in; do not enable it blindly for another project.
- `lightworld-deploy` prunes only **after** successful build, release-source identity validation, database migrations, process startup, healthy local/public probes, and durable active + rollback metadata updates. A failed build, migration, health check or rollback cannot initiate pruning.
- A mismatch between the active symlink, verified commit and recorded metadata aborts pruning. If the rollback release is absent or malformed, cleanup aborts rather than deleting possible recovery material. A first deployment without a recorded previous version does not prune.
- The release root must be an actual directory, not a symlink. Remove only direct children named exactly a **40-character hexadecimal SHA**, and exclude the current and recorded previous SHA. Symlinks, hidden directories, arbitrary names and other projects are never candidates.
- Refuse to prune a candidate if any `/proc` process references it in its command line, executable, root or current working directory. Refuse mounted paths, including bind mounts. Deletion is constrained to the current filesystem. Any ambiguity preserves data.
- Initial implementation handles `workspace-archive` source mode. Git-managed canonical worktrees are deliberately left untouched pending separate Git-aware cleanup.
- Cleanup is best-effort; failure logs a warning but does not falsely mark the already-healthy app as failed. The active and rollback releases always remain intact.

## Validation and rollout

1. Run `node --test test/lightworld-vps-platform.test.mjs` as a non-root account, plus deployment configuration tests.
2. Test 3–4 canonical commits and verify an opt-in third successful deployment keeps only the last two, while default-disabled retains history.
3. Verify the prior release survives failed health, and that process-pinned historical directories remain until no longer in use. Verify unrelated files and SHA-named symlinks survive and the recorded previous version still rolls back.
4. Check GitHub CI domain, visual QA and Linux desktop-native build.
5. After merging, install the exact reviewed runtime scripts via existing privileged `install-platform-files.sh` from the verified main, and add the opt-in to the root-owned TradeOS registry. Do **not** bypass the protected staging deploy workflow. Verify SHA, website and API health, authenticated boundaries, retention inventory and free disk space.

All tests use isolated temporary repository fixtures; **never** truncate TradeOS staging business data.
