# TradeOS VPS Pull Deployer Design

Date: 2026-10-07
Status: Proposed for implementation after owner review
Repository: `christianagbotah/tradeos-africa`
Target environment: `tradeosafrica.lightworldtech.com`
Target runtime path: `/home/lightworld/webapps/tradeos-staging`

## 1. Purpose

TradeOS currently has CI but no automatic VPS deployment path. A change can merge successfully to `main` and remain absent from the live staging environment until someone manually fetches, fast-forwards, migrates, builds, and reloads PM2. The demo-account incident exposed this gap directly: GitHub `main` had the feature while the live checkout remained on an older SHA.

The goal is to give TradeOS a VPS-side pull deployer similar in operating model to the proven SchoolManager pattern, while adding stricter release safety for CI handoff, migrations, build failures, concurrent runs, and health-check rollback.

The deployer must make staging deployment routine, deterministic, observable, CI-gated, and recoverable without introducing GitHub SSH secrets on the VPS or exposing `.env.staging`.

## 2. Success criteria

A deployment is successful only when all of the following are true:

- GitHub CI has completed successfully for the candidate `main` commit;
- a CI-only handoff workflow has advanced a monotonic `deploy/staging-ready` ref to that exact tested SHA;
- the VPS detects a new `origin/deploy/staging-ready` SHA;
- the candidate SHA is a fast-forward descendant of the currently deployed SHA and is reachable from `origin/main`;
- the release is prepared outside the live runtime path;
- dependency installation succeeds;
- all pending database migrations succeed exactly once;
- the monorepo production build succeeds;
- PM2 reloads the TradeOS API and web apps using the tracked `ecosystem.config.cjs`;
- both PM2 processes run as `lightworld`;
- API health returns HTTP 200 and validates database connectivity;
- web health returns HTTP 200;
- public HTTPS returns HTTP 200;
- the deployed SHA is recorded in a manifest only after health checks pass;
- a failed candidate does not leave the previous working application unavailable.

## 3. Non-goals

This design does not introduce:

- containerization or Kubernetes;
- a new hosting provider;
- GitHub-hosted SSH deployment;
- deployment from feature branches;
- automatic production/live-customer promotion separate from the existing staging domain;
- schema down-migrations;
- database snapshot/restore automation in the first version;
- blue/green traffic routing through multiple Nginx upstreams.

The first version is intentionally VPS-native and compatible with the existing PM2/Nginx topology.

## 4. Existing deployment constraints

The current application has these important properties:

- Web runtime: `127.0.0.1:3036`.
- API runtime: `127.0.0.1:4036`.
- PostgreSQL is external to the application checkout and uses `DATABASE_URL` from `.env.staging`.
- `.env.staging` is untracked, sensitive, and must remain outside Git history.
- PM2 uses tracked `ecosystem.config.cjs` plus `bin/start-api.sh` and `bin/start-web.sh`.
- The tracked PM2 config runs both apps as `lightworld`.
- CI validates migrations by applying `packages/db/migrations/*.sql` in lexical order, then runs typecheck, tests, build, and an authenticated API smoke test.
- Current migration files are append-only SQL files named with increasing numeric prefixes.
- The repository currently has CI only; successful merge does not itself update the VPS.

The deployer must preserve these conventions rather than creating a second runtime model.

## 5. Architecture overview

The deployment subsystem will consist of seven pieces:

1. **GitHub CI** — existing code-quality and build gate.
2. **GitHub deployment-handoff workflow** — publishes only CI-approved `main` SHAs to a dedicated monotonic ref.
3. **Tracked deploy script** — performs one deterministic VPS deployment attempt.
4. **Persistent bare Git mirror** — fetch/control plane separate from the active runtime release.
5. **Migration ledger support** — distinguishes already-applied migrations from pending ones and detects checksum drift.
6. **VPS systemd service + timer** — polls the approved ref on a short interval as `lightworld`.
7. **Deployment manifest/log** — persistent operator visibility and recovery state outside releases.

Recommended names:

- handoff ref: `refs/heads/deploy/staging-ready`
- handoff workflow: `.github/workflows/deployment-handoff.yml`
- repository deploy script: `bin/deploy-staging.sh`
- migration helper: `bin/apply-migrations.sh`
- migration ledger table: `schema_migrations`
- bare control mirror: `/home/lightworld/deployments/tradeos/repo.git`
- service: `tradeos-deploy.service`
- timer: `tradeos-deploy.timer`
- persistent state directory: `/home/lightworld/deployments/tradeos`
- release root: `/home/lightworld/releases/tradeos`
- manifest: `/home/lightworld/deployments/tradeos/last_manifest.txt`
- lock: `/home/lightworld/deployments/tradeos/deploy.lock`
- deployment log: `/home/lightworld/deployments/tradeos/deploy.log`

## 6. CI-approved deployment handoff

The VPS must not poll `main` as its deployment authority because a new `main` commit can exist while its CI run is still executing.

A separate GitHub Actions workflow will run on `workflow_run` after the existing `CI` workflow completes. It will have narrowly scoped `contents: write` permission and will proceed only when:

- the completed workflow is `CI`;
- `conclusion == success`;
- `head_branch == main`;
- the tested SHA is still reachable from the repository's current `main` history.

The workflow advances `refs/heads/deploy/staging-ready` to `workflow_run.head_sha` using a normal fast-forward push. It must never force-push the handoff ref.

This makes the handoff ref monotonic. If CI runs complete out of order, a stale earlier SHA cannot move the ref backward because GitHub rejects a non-fast-forward update. A later successful SHA can advance it normally.

The VPS needs no GitHub token for this mechanism: it only fetches the public repository's `main` and `deploy/staging-ready` refs over the existing HTTPS remote.

## 7. Release preparation and Git control model

The deployer must never build directly over the currently running application tree.

The deployment control plane is a persistent bare mirror:

`/home/lightworld/deployments/tradeos/repo.git`

Each timer run fetches at least:

- `refs/heads/main` -> `refs/remotes/origin/main`
- `refs/heads/deploy/staging-ready` -> `refs/remotes/origin/deploy/staging-ready`

For each approved candidate SHA the deployer creates a clean release directory:

`/home/lightworld/releases/tradeos/<full-sha>`

The release is materialized from the bare mirror at the exact candidate commit. It contains application files but does not act as the Git fetch/control checkout.

The release receives a symlink to the persistent environment file rather than a copied secret:

`<release>/.env.staging -> /home/lightworld/shared/tradeos-staging/.env.staging`

If the environment file is currently located in the live checkout, bootstrap will first move it into the shared persistent path with the same restrictive ownership and permissions. Secret values must never be logged.

A candidate release remains disposable until all pre-activation gates pass.

## 8. Deployment flow

Each timer invocation performs the following sequence under an exclusive file lock:

1. Acquire the deployment lock with non-blocking `flock`.
2. Fetch `origin/main` and `origin/deploy/staging-ready` into the persistent bare mirror.
3. Read the current deployed SHA from the manifest; if absent, derive it once during bootstrap.
4. Set the candidate SHA to `origin/deploy/staging-ready`.
5. If candidate SHA equals deployed SHA, exit successfully without work.
6. Verify deployed SHA is an ancestor of candidate SHA. If not, reject automatic deployment and log a non-fast-forward condition.
7. Verify candidate SHA is reachable from fetched `origin/main`.
8. Create or safely recreate the candidate release directory from the bare mirror.
9. Attach the persistent `.env.staging` symlink.
10. Install dependencies with the repository-declared pnpm version under `lightworld`.
11. Run deployment-specific tests, typecheck, and production build before activation.
12. Apply pending database migrations using the migration ledger.
13. Atomically switch the stable runtime path to the prepared release.
14. Reload `tradeos-staging-api` and `tradeos-staging-web` from the tracked `ecosystem.config.cjs`.
15. Wait for service readiness with bounded retries.
16. Verify API `/health` returns 200 and includes database time.
17. Verify local web root returns 200.
18. Verify public HTTPS root returns 200.
19. Verify PM2 reports both TradeOS processes online and owned by UID/GID for `lightworld`.
20. Write the successful candidate SHA, previous SHA, and timestamp to the manifest atomically.
21. Run `pm2 save` only after a successful activation.
22. Prune old release directories conservatively, keeping the current release plus at least the two previous releases.

## 9. Database migration ledger

Automatic deployment cannot safely re-run arbitrary historical SQL on every release, even if current migrations happen to be idempotent. The VPS needs an explicit ledger.

The first implementation will create a table similar to:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

For every `packages/db/migrations/*.sql` file in lexical order:

- compute a SHA-256 checksum;
- if filename is absent from `schema_migrations`, apply the file with `psql -v ON_ERROR_STOP=1` and then record filename/checksum;
- if filename exists with the same checksum, skip it;
- if filename exists with a different checksum, abort deployment because an already-applied migration was edited in place.

Bootstrap behavior must account for the existing database where migrations 0001-0013 have already been applied without a ledger. During installation, the bootstrap command will explicitly baseline the currently known migration set by recording checksums only after validating expected schema markers for the existing database. This baseline step is one-time and must be logged distinctly from normal migration application.

After the ledger exists, migration files are immutable. Schema changes require new numbered files.

## 10. Migration compatibility rule

Database migrations are forward-only. No automatic down-migration is attempted.

All future schema changes used by automatic deployment must follow expand/contract compatibility:

1. add new schema in a backward-compatible way;
2. deploy code that can use the expanded schema;
3. migrate data if required;
4. remove obsolete schema only in a later release after the old code path is no longer a rollback target.

This rule is required because an application rollback may occur after a migration has already succeeded.

## 11. Failure and rollback behavior

### CI failure

If GitHub CI fails, `deploy/staging-ready` does not move. The VPS sees no candidate and performs no deployment.

### Validation or build failure before activation

If dependency installation, deployment tests, typecheck, or build fails:

- do not touch PM2;
- do not change the runtime pointer;
- do not update the manifest;
- retain logs for diagnosis;
- optionally remove the failed release directory after logging.

### Migration failure

If a pending migration fails:

- abort before activation;
- do not update the manifest;
- do not reload PM2;
- keep the previous application release running.

### Health-check failure after activation

If PM2 reload succeeds but API/web/public health fails:

- atomically restore the previous runtime pointer;
- reload the same PM2 apps against the previous release;
- re-run local health checks;
- leave the manifest pointing to the previous successful SHA;
- log the candidate as failed.

No automatic schema rollback is attempted.

## 12. Runtime pointer

The preferred runtime layout is:

`/home/lightworld/webapps/tradeos-staging -> /home/lightworld/releases/tradeos/<active-sha>`

This preserves the existing absolute TradeOS path while making release activation an atomic symlink replacement.

Before bootstrap converts the current physical directory into this symlink, implementation must inspect current Nginx, PM2, service, cron, and operator references to ensure no external component requires that path to remain a physical Git checkout. Any discovered dependency must be migrated to either the stable symlink path or the persistent bare mirror.

## 13. Concurrency and idempotency

The timer can fire while a prior deployment is still running. The deployer therefore uses `flock` on the persistent lock file. If the lock is held, the new invocation exits cleanly without waiting.

Release directory creation, migration checks, manifest writes, fetches, and symlink switches must all be idempotent. Re-running the same candidate SHA after an interrupted attempt must either continue safely or rebuild the candidate without affecting the active release.

## 14. Security model

- `tradeos-deploy.service` runs as `lightworld`, not root.
- The VPS fetches the public GitHub repository over HTTPS; no GitHub SSH private key or PAT is introduced on the VPS.
- Only the GitHub handoff workflow receives `contents: write`, through the repository-scoped `GITHUB_TOKEN`.
- The handoff workflow can update only repository contents/refs and does not receive VPS credentials.
- `.env.staging` remains mode 600 or equivalently restrictive and is never printed.
- The deployment script must never use `set -x` while secrets are in scope.
- Commands must pass environment values without shell re-evaluation.
- No database credentials are stored in systemd unit files.
- The deployer may read the environment file but must not echo its contents.
- PM2 applications continue to run as `lightworld`.

## 15. Observability

Every deployment attempt logs:

- start timestamp;
- currently deployed SHA;
- CI-approved candidate SHA;
- each gate started/completed;
- migration filenames applied or skipped, but never secret data;
- activation and rollback events;
- health-check results;
- final outcome and elapsed time.

The manifest will use a simple operator-readable format, for example:

```text
sha=cd994ace2bea0aed1b279dd0035eea0f33edef6e
status=success
deployed_at=2026-10-07T12:30:00Z
previous_sha=989746e3b0aba5e9d25992bb58dd4c0fc140be8f
source_ref=deploy/staging-ready
```

The service journal remains available through `journalctl -u tradeos-deploy.service`.

## 16. Systemd scheduling

`tradeos-deploy.timer` will use approximately a one-minute cadence, matching the proven operational expectation from SchoolManager while avoiding continuous polling.

The timer must be persistent so a missed interval after reboot is picked up. The service is `Type=oneshot` and cannot overlap because of the deployment lock.

The unit will set a bounded start timeout so a broken build cannot hang indefinitely.

## 17. CI relationship

GitHub Actions remains the primary code-quality gate. The VPS deployer does not replace CI.

The handoff workflow converts CI success into a deployment-safe ref. The VPS does not deploy `origin/main` directly and does not independently guess whether CI is complete.

The VPS still runs a smaller set of deployment-specific validations and the production build because CI success alone cannot prove the target server's Node/pnpm/runtime environment can prepare the release.

## 18. Bootstrap plan

Installation is a one-time operator action and is separate from normal timer deployments.

Bootstrap will:

1. create `/home/lightworld/deployments/tradeos`, `/home/lightworld/releases/tradeos`, and `/home/lightworld/shared/tradeos-staging` with `lightworld` ownership;
2. create the persistent bare mirror at `/home/lightworld/deployments/tradeos/repo.git`;
3. place/preserve `.env.staging` in the shared path with restrictive permissions;
4. baseline the existing migration ledger safely;
5. create an initial release directory from the currently verified successful SHA;
6. replace the current runtime directory with the stable symlink only after the release has been prepared and health-checked;
7. install the systemd service and timer;
8. enable/start the timer;
9. trigger one manual service run;
10. verify the service detects a no-op when already current;
11. verify a controlled future CI-approved commit can deploy end to end.

Bootstrap must be idempotent enough that re-running it does not destroy an existing healthy deployment.

## 19. Repository changes expected during implementation

Likely tracked files:

- `.github/workflows/deployment-handoff.yml`
- `bin/deploy-staging.sh`
- `bin/apply-migrations.sh`
- `ops/systemd/tradeos-deploy.service`
- `ops/systemd/tradeos-deploy.timer`
- `test/deployment-config.test.mjs` additions for deployer invariants
- migration-ledger bootstrap helper under `packages/db/` or `bin/`
- deployment documentation under `docs/` and/or `README.md`

VPS-only persistent state is intentionally not committed.

## 20. Test strategy

Implementation will use test-driven development for tracked scripts/configuration.

Automated tests must cover at minimum:

- handoff workflow triggers only after successful CI for `main`;
- handoff ref update is fast-forward only and cannot move backward on stale/out-of-order workflow completion;
- service runs as `lightworld`;
- timer points to the correct service;
- deploy script reads candidate from `deploy/staging-ready`, not directly from `main`;
- deploy script refuses candidate not reachable from `main`;
- deploy script refuses non-fast-forward candidate relative to deployed SHA;
- deploy script exits cleanly on no-op SHA;
- lock prevents concurrent deployment;
- `.env.staging` is never sourced with unsafe shell evaluation;
- migration helper applies an unseen migration and records checksum;
- migration helper skips an identical applied migration;
- migration helper aborts on checksum drift;
- manifest updates only after successful health checks;
- rollback path restores the previous release pointer on post-activation health failure;
- tracked startup commands remain `bin/start-api.sh` and `bin/start-web.sh`;
- full repository typecheck/tests/build remain green.

A VPS installation verification must then prove:

- timer enabled and active;
- one no-op cycle exits successfully;
- PM2 apps are online under `lightworld`;
- API local health 200;
- web local health 200;
- public HTTPS 200;
- manifest SHA equals the active release SHA;
- active release SHA equals the fetched `deploy/staging-ready` SHA.

## 21. Acceptance criteria

The architecture is complete when this scenario succeeds without manual Git deployment commands:

1. a reviewed change is merged to `main`;
2. CI passes for that exact SHA;
3. the handoff workflow advances `deploy/staging-ready` to the tested SHA;
4. within the polling interval, the VPS detects the new approved SHA;
5. the release is prepared, validated, migrated, built, and activated;
6. health checks pass;
7. the manifest records the new SHA;
8. the public TradeOS site serves the new release;
9. a second timer invocation is a clean no-op;
10. an intentionally failed CI run proves the handoff ref does not move;
11. an intentionally broken local candidate validation proves the currently working release stays live.

## 22. Design decisions

The following choices are deliberate:

- **CI-approved handoff ref instead of polling `main`:** prevents deployment before CI completion and requires no VPS GitHub credential.
- **Fast-forward-only handoff:** prevents stale/out-of-order CI completions from rolling the deployable ref backward.
- **Pull from VPS instead of GitHub SSH push:** keeps deployment authority on the server and avoids deployment SSH secrets.
- **Persistent bare Git mirror:** separates Git control state from disposable runtime releases.
- **Prepare releases outside the live path:** a failed build cannot corrupt the running application directory.
- **Forward-only migrations with checksum ledger:** prevents accidental re-execution or mutation of historical schema changes.
- **Atomic release symlink plus PM2 reload:** minimizes downtime and provides a practical application rollback point without replacing the existing runtime stack.
- **Systemd timer instead of cron:** gives explicit service state, journald logs, startup ordering, retry visibility, and easier operator diagnostics.
- **`lightworld` execution:** preserves least privilege and matches the intended application ownership model.
