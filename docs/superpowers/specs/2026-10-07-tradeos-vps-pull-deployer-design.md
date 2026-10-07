# TradeOS VPS Pull Deployer Design

Date: 2026-10-07
Status: Proposed for implementation after owner review
Repository: `christianagbotah/tradeos-africa`
Target environment: `tradeosafrica.lightworldtech.com`
Target checkout: `/home/lightworld/webapps/tradeos-staging`

## 1. Purpose

TradeOS currently has CI but no automatic VPS deployment path. A change can merge successfully to `main` and remain absent from the live staging environment until someone manually fetches, fast-forwards, migrates, builds, and reloads PM2. The demo-account incident exposed this gap directly: GitHub `main` had the feature while the live checkout remained on an older SHA.

The goal is to give TradeOS a VPS-side pull deployer similar in operating model to the proven SchoolManager pattern, while adding stricter release safety for migrations, build failures, concurrent runs, and health-check rollback.

The deployer must make `main` deployment routine, deterministic, observable, and recoverable without introducing GitHub SSH secrets or exposing `.env.staging`.

## 2. Success criteria

A deployment is successful only when all of the following are true:

- the VPS detects a new `origin/main` SHA;
- the candidate SHA is a fast-forward descendant of the currently deployed SHA;
- the release is prepared outside the live runtime path;
- dependency installation succeeds;
- all pending database migrations succeed exactly once;
- the monorepo production build succeeds;
- PM2 reloads the TradeOS API and web apps using the tracked `ecosystem.config.cjs`;
- both PM2 processes run as `lightworld`;
- API health returns HTTP 200 and validates database connectivity;
- web health returns HTTP 200;
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
- Public Nginx domain points to the TradeOS staging runtime.
- PostgreSQL is external to the application checkout and uses `DATABASE_URL` from `.env.staging`.
- `.env.staging` is untracked, sensitive, and must remain outside Git history.
- PM2 uses tracked `ecosystem.config.cjs` plus `bin/start-api.sh` and `bin/start-web.sh`.
- The tracked PM2 config runs both apps as `lightworld`.
- CI validates migrations by applying `packages/db/migrations/*.sql` in lexical order, then runs typecheck, tests, build, and an authenticated API smoke test.
- Current migration files are append-only SQL files named with increasing numeric prefixes.

The deployer must preserve these conventions rather than creating a second deployment model.

## 5. Architecture overview

The deployment subsystem will consist of five pieces:

1. **Tracked deploy script** in the repository, responsible for one deterministic deployment attempt.
2. **Migration ledger support** so the VPS can distinguish already-applied migrations from pending ones.
3. **VPS systemd service** running the tracked deploy script as `lightworld`.
4. **VPS systemd timer** triggering the service on a short interval.
5. **Deployment manifest/log** stored outside the Git checkout for operator visibility and recovery.

Recommended names:

- repository script: `bin/deploy-staging.sh`
- migration helper: `bin/apply-migrations.sh`
- migration ledger table: `schema_migrations`
- service: `tradeos-deploy.service`
- timer: `tradeos-deploy.timer`
- persistent state directory: `/home/lightworld/deployments/tradeos`
- manifest: `/home/lightworld/deployments/tradeos/last_manifest.txt`
- lock: `/home/lightworld/deployments/tradeos/deploy.lock`
- deployment log: `/home/lightworld/deployments/tradeos/deploy.log`

## 6. Release preparation model

The deployer must never build directly over the currently running checkout.

For each candidate SHA it will create a release directory under:

`/home/lightworld/releases/tradeos/<full-sha>`

The release directory is created from Git using the candidate commit, without copying `.git` internals into runtime data. The release receives a symlink to the persistent environment file rather than a copied secret:

`<release>/.env.staging -> /home/lightworld/shared/tradeos-staging/.env.staging`

If the environment file is currently located in the live checkout, installation will first move it into the shared persistent path with the same restrictive ownership and permissions, then replace the live path with a symlink. Secret values must never be logged.

A candidate release remains disposable until all pre-activation gates pass.

## 7. Deployment flow

Each timer invocation performs the following sequence under an exclusive file lock:

1. Acquire the deployment lock with non-blocking `flock`.
2. Fetch `origin/main` from GitHub.
3. Read current deployed SHA from the manifest; if absent, derive it from the current runtime checkout once during bootstrap.
4. If remote SHA equals deployed SHA, exit successfully without work.
5. Verify deployed SHA is an ancestor of candidate SHA. If not, reject automatic deployment and log a non-fast-forward condition.
6. Verify the candidate commit is reachable from `origin/main` exactly as fetched.
7. Create or reuse the candidate release directory.
8. Attach the persistent `.env.staging` symlink.
9. Install dependencies with the repository-declared pnpm version through Corepack/pnpm under `lightworld`.
10. Run repository validation that is safe and useful on the VPS before activation: deployment-config test, typecheck, and production build. Full test-suite execution may remain CI-owned if runtime duration becomes excessive, but the first implementation will keep at least the deployment-specific tests and build gate locally.
11. Apply pending database migrations using the migration ledger.
12. Atomically switch `/home/lightworld/webapps/tradeos-staging` to the prepared release, or update a stable `current` symlink used by PM2/Nginx-facing startup paths.
13. Reload `tradeos-staging-api` and `tradeos-staging-web` from the tracked `ecosystem.config.cjs`.
14. Wait for service readiness with bounded retries.
15. Verify API `/health` returns 200 and includes database time.
16. Verify local web root returns 200.
17. Verify public HTTPS root returns 200.
18. Verify PM2 reports both TradeOS processes online and owned by UID/GID for `lightworld`.
19. Write the successful candidate SHA and timestamp to the deployment manifest atomically.
20. Run `pm2 save` only after a successful activation.
21. Prune old release directories conservatively, keeping the current release plus at least the two previous releases.

## 8. Database migration ledger

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
- if filename is absent from `schema_migrations`, apply the file inside `psql -v ON_ERROR_STOP=1` and then record filename/checksum;
- if filename exists with the same checksum, skip it;
- if filename exists with a different checksum, abort deployment because an already-applied migration was edited in place.

Bootstrap behavior must account for the existing database where migrations 0001-0013 have already been applied without a ledger. During installation, the bootstrap command will explicitly baseline the currently known migration set by recording checksums only after validating the expected schema markers for the existing database. This baseline step is one-time and must be logged distinctly from normal migration application.

After the ledger exists, migration files are immutable. Schema changes require new numbered files.

## 9. Failure and rollback behavior

### Build or validation failure

If dependency installation, typecheck, deployment tests, or build fails before activation:

- do not touch PM2;
- do not change the live release pointer;
- do not update the manifest;
- retain logs for diagnosis;
- optionally remove the failed release directory after logging.

### Migration failure

If a pending migration fails:

- abort before activation;
- do not update the manifest;
- do not reload PM2;
- keep the previous application version running.

Database migrations are forward-only. If a migration succeeds but a later activation step fails, application rollback is allowed only when the previous code remains compatible with the new schema. Therefore new migrations must follow expand/contract compatibility rules: additive first, code switch second, destructive cleanup only in a later release.

### Health-check failure after activation

If PM2 reload succeeds but API/web health fails:

- switch the runtime pointer back to the previous release;
- reload the same PM2 apps against the previous release;
- re-run local health checks;
- leave the manifest pointing to the previous successful SHA;
- log the candidate as failed.

No automatic schema rollback is attempted.

## 10. Concurrency and idempotency

The timer can fire while a prior deployment is still running. The deployer therefore uses `flock` on the persistent lock file. If the lock is held, the new invocation exits cleanly without waiting.

Release directory creation, migration checks, manifest writes, and symlink switches must all be idempotent. Re-running the same candidate SHA after an interrupted attempt must either continue safely or rebuild the candidate without affecting the active release.

## 11. Security model

- `tradeos-deploy.service` runs as `lightworld`, not root.
- The deployer uses the repository's existing HTTPS Git remote; no GitHub SSH private key is introduced.
- `.env.staging` remains mode 600 or equivalently restrictive and is never printed.
- The deployment script must never use `set -x` while secrets are in scope.
- Commands must pass environment values without shell re-evaluation.
- No database credentials are stored in systemd unit files.
- The deployer may read the environment file but must not echo its contents.
- The live PM2 processes continue to drop privileges to `lightworld` through the tracked ecosystem config.

## 12. Observability

Every deployment attempt logs:

- start timestamp;
- currently deployed SHA;
- candidate SHA;
- each gate started/completed;
- migration filenames applied or skipped, but never migration secret data;
- activation and rollback events;
- health-check results;
- final outcome and elapsed time.

The manifest will use a simple operator-readable format, for example:

```text
sha=cd994ace2bea0aed1b279dd0035eea0f33edef6e
status=success
deployed_at=2026-10-07T12:30:00Z
previous_sha=989746e3b0aba5e9d25992bb58dd4c0fc140be8f
```

The service's journal remains available through `journalctl -u tradeos-deploy.service`.

## 13. Systemd scheduling

`tradeos-deploy.timer` will use approximately a one-minute cadence, matching the proven operational expectation from SchoolManager while avoiding continuous polling.

The timer must be persistent so a missed interval after reboot is picked up. The service itself is `Type=oneshot` and cannot overlap because of the lock.

The unit will set a reasonable start timeout so a broken build cannot hang indefinitely.

## 14. CI relationship

GitHub Actions remains the primary code-quality gate. The VPS deployer is not intended to replace CI.

Because the repository currently has only `ci.yml` and no server-side deployment handoff, the initial version will poll `origin/main` directly. A later hardening phase may query GitHub for the candidate SHA's successful CI status before allowing activation.

For the first implementation, automatic deployment will require the same candidate to be on `origin/main`, and the VPS will still run local deployment-specific validation plus build. CI-status verification can be added once its GitHub API authentication model is defined without introducing broad secrets.

## 15. Bootstrap plan

Installation is a one-time operator action and will be separate from normal deployments.

Bootstrap will:

1. create `/home/lightworld/deployments/tradeos` and `/home/lightworld/releases/tradeos` with `lightworld` ownership;
2. place/preserve the persistent `.env.staging` in the shared path;
3. baseline the existing migration ledger safely;
4. create the initial release directory from the currently verified successful SHA;
5. install the systemd service and timer;
6. enable/start the timer;
7. trigger one manual service run;
8. verify the service detects no-op when already current;
9. verify a controlled future commit can deploy end to end.

The bootstrap script must be designed so re-running it does not destroy an existing healthy setup.

## 16. Repository changes expected during implementation

Likely tracked files:

- `bin/deploy-staging.sh`
- `bin/apply-migrations.sh`
- `ops/systemd/tradeos-deploy.service`
- `ops/systemd/tradeos-deploy.timer`
- `test/deployment-config.test.mjs` additions for deployer invariants
- migration-ledger bootstrap SQL or helper under `packages/db/` / `bin/`
- deployment documentation in `README.md` or `docs/`

VPS-only persistent state is intentionally not committed.

## 17. Test strategy

Implementation will use test-driven development for the tracked scripts/configuration.

Automated tests must cover at minimum:

- service runs as `lightworld`;
- timer points to the correct service;
- deploy script refuses non-fast-forward candidates;
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
- manifest SHA equals the active release SHA.

## 18. Acceptance criteria

The architecture is complete when the following scenario succeeds without manual Git commands:

1. a reviewed change is merged to `main`;
2. CI passes;
3. within the polling interval, the VPS detects the new SHA;
4. the release is prepared, validated, migrated, built, and activated;
5. health checks pass;
6. the manifest records the new SHA;
7. the public TradeOS site serves the new release;
8. a second timer invocation is a clean no-op;
9. intentionally broken candidate validation proves the currently working release stays live.

## 19. Design decisions

The following choices are deliberate:

- **Pull from VPS instead of GitHub SSH push:** keeps deployment authority on the server and avoids introducing deployment SSH secrets.
- **Prepare releases outside the live path:** a failed build cannot corrupt the running application directory.
- **Forward-only migrations with checksum ledger:** prevents accidental re-execution or mutation of historical schema changes.
- **Atomic release switch plus PM2 reload:** reduces downtime and provides a practical rollback point without replacing the existing runtime stack.
- **Systemd timer instead of cron:** gives explicit service state, journald logs, startup ordering, retry visibility, and easier operator diagnostics.
- **`lightworld` execution:** preserves least privilege and matches the intended application ownership model.

## 20. Open implementation detail

The implementation plan must choose one stable runtime-pointer layout after inspecting the current Nginx and PM2 path assumptions:

- either keep `/home/lightworld/webapps/tradeos-staging` as a symlink to the active release; or
- introduce `/home/lightworld/webapps/tradeos-staging/current` and update the PM2 `cwd`/start scripts accordingly.

The preferred option is to make `/home/lightworld/webapps/tradeos-staging` itself the stable symlink because it preserves existing absolute paths for PM2 and Nginx. Before implementation, the plan must verify no external process requires that path to remain a physical directory.
