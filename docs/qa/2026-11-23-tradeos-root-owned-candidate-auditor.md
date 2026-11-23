# TradeOS — root-owned signed-artifact candidate auditor

## Intent and boundary

This is a **root-owned nondeployable candidate acceptance service**, not an activated source-light deployment. After the signed GitHub runtime, 60/60 read-only migration-ledger compatibility and ephemeral read-only candidate sealing milestones, the remaining supply-chain gap was that the VPS verification script was executed directly from a mutable Git worktree. This change provides an independently installable and checksum-pinned copy of that reviewed code in the existing Lightworld root tool directory.

## Review and installation

After an exact-main GitHub push **succeeds**, first verify the matching commit's complete protected CI, SLSA signed artifact and candidate safety. From a **clean exact-main checkout**, run:

```bash
# Read-only, safe source check. No installation or service impact.
bash ops/release/install-root-candidate-auditor.sh /absolute/clean/checkout <full-current-main-sha> --check

# Root-only, one-time installation into the fixed trusted tool paths.
bash ops/release/install-root-candidate-auditor.sh /absolute/clean/checkout <full-current-main-sha> --install

# Each invocation audits an independently authenticated, signed exact-main build.
/usr/local/sbin/lightworld-tradeos-candidate-audit <full-current-main-sha> <successful-main-push-run-id>
```

Installation requires `root`, the **exact current GitHub `main` SHA**, a canonical no-symlink working tree, a clean Git index/worktree, and every script tracked by that commit. Before the installer creates anything privileged, it verifies the deployment tool root is owned by root and that there is **no existing install**. It copies only six audited source-light verification scripts into a private root-owned staging directory, generates SHA-256 sums and a source-commit record, independently pins the executable launcher SHA, verifies its own manifest, rechecks GitHub main for a race, then atomically renames the fixed installed auditor directory and fixed `/usr/local/sbin` entrypoint. It intentionally has **no upgrade or overwrite path**. A later change to any auditor script must go through a separate reviewed, safe upgrade design.

## Execution contracts

The installed command is root-only, accepts **exactly** a 40-character lowercase GitHub commit SHA and numeric GitHub Actions run ID, requires its own root-owned install directory and lock directory with safe modes, verifies every installed script checksum **before executing it**, and acquires the existing app-scoped `tradeos-africa.staging.lock` so it cannot collide with the Lightworld protected deployment command. It clears inherited shell environment, including `DATABASE_URL`, token and custom executable paths, then runs only the signed pilot audit with all three compulsory flags: `--rehearse --ledger-readonly --seal-candidate`.

That audited flow independently checks GitHub repository, exact current main commit, successful main-push workflow, authenticated SLSA GitHub signature, archive digest and bounded size, safe no-follow extraction, and staging migration history in a PostgreSQL **READ ONLY** transaction as the application user. On compatibility it fingerprints and seals the extracted runtime as a root-owned read-only candidate. All temporary data are removed on completion or error. It never copies candidate files into persistent releases.

## No change to production

- This code introduces **no deployable artifact schema**, root-owned promotion/activation command, PM2 restart, migration execution, payment/refund update, secret upload, user data access or symlink switch.
- The GitHub pilot is still explicitly `deployable:false`; its manifest is rejected if someone merely changes the boolean to true.
- The root tool may be installed after successful protected tests, but that **is not deployment**. Rehearsing the root-owned command touches only temporary quarantine and a read-only ledger transaction.
- Current active + rollback TradeOS releases under `/home/lightworld/releases/tradeos-staging` remain untouched; keep independent finance reconciliation and backup/restore gates before a future separately reviewed activation phase.

## Test strategy

`node --test test/root-candidate-auditor.test.mjs test/ci-artifact-pilot-contract.test.mjs` checks malformed CLI arguments, symlink source rejection, immutable installed paths, exact-main enforcement, checksum and launcher integrity, root ownership, app lock, absence of deployment/migration commands, and explicit no-overwrite policy. Existing PostgreSQL-ledger, malicious archive, signed provenance, sealed-candidate and launcher tests run in the GitHub workflow. The source-check mode is also verified against actual `main` on its push run. The production tool should only be installed after that GitHub run succeeds.
