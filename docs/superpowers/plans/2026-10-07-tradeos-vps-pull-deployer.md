# TradeOS VPS Pull Deployer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CI-gated, VPS-side staging deployer that promotes only successfully tested `main` commits, applies forward-only migrations safely, prepares immutable releases, atomically switches the active runtime, and rolls application code back on failed post-activation health checks.

**Architecture:** GitHub Actions advances a fast-forward-only `deploy/staging-ready` ref after successful CI on `main`. A `lightworld` systemd timer polls that approved ref through a persistent bare Git mirror, materializes a release by SHA, runs validation/build/migrations, atomically switches `/home/lightworld/webapps/tradeos-staging` to the release, reloads the existing PM2 apps, verifies health, and records a manifest. Database migrations use a checksum ledger and remain forward-only.

**Tech Stack:** GitHub Actions, Bash, Git, systemd, PM2, Node.js 22+, pnpm 10.17.1, PostgreSQL 17-compatible SQL, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-07-tradeos-vps-pull-deployer-design.md`

## Global Constraints

- Deploy only a CI-approved SHA published through `refs/heads/deploy/staging-ready`; never deploy `main` directly.
- `deploy/staging-ready` must move by normal fast-forward only; never force-push it.
- VPS deployment service runs as `lightworld`, not root.
- Do not introduce a GitHub SSH key or PAT on the VPS.
- Preserve `.env.staging` outside Git; never print or shell-evaluate secret values.
- Keep API on `127.0.0.1:4036` and web on `127.0.0.1:3036`.
- Keep PM2 app names `tradeos-staging-api` and `tradeos-staging-web` and tracked launchers `bin/start-api.sh` / `bin/start-web.sh`.
- Database migrations are forward-only and immutable after application; checksum drift must abort deployment.
- Release activation must be atomic and the previous application release must remain recoverable.
- A failed build, migration, or health check must not advance the deployment manifest.

## Review Focus

- **Out-of-order successful CI runs:** a stale earlier run must not move `deploy/staging-ready` backward; Task 1 tests the handoff update strategy and ancestry guard.
- **Edited historical migration:** an already-recorded filename with a new SHA-256 must abort before activation; Task 2 tests checksum drift.
- **Interrupted or concurrent deploy:** a second deployer invocation must exit cleanly while the lock is held, and rerunning the same candidate must remain safe; Task 3 tests lock/no-op behavior.
- **Post-migration application health failure:** code must return to the prior release while leaving forward schema changes intact; Task 3 tests runtime-pointer rollback and manifest preservation.
- **Secret/metacharacter environment values:** deployment/bootstrap scripts must parse dotenv values literally without `source`, `eval`, or logging secrets; Tasks 2 and 4 extend the existing dotenv safety tests.

---

### Task 1: CI-approved staging handoff

**Files:**
- Create: `.github/workflows/deployment-handoff.yml`
- Create: `test/deployment-handoff.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing workflow named `CI` in `.github/workflows/ci.yml`.
- Produces: fast-forward-only `refs/heads/deploy/staging-ready` pointing to the exact successful `workflow_run.head_sha` from `main`.

- [ ] **Step 1: Write failing workflow-contract tests**

Create `test/deployment-handoff.test.mjs` with tests named:
- `handoff listens only to completed CI workflow runs`
- `handoff requires success and main before publishing`
- `handoff publishes workflow_run.head_sha to deploy/staging-ready without force`
- `handoff verifies candidate remains reachable from main`

Assert the workflow uses `workflow_run`, `types: [completed]`, repository `contents: write`, explicit checks for `conclusion == 'success'` and `head_branch == 'main'`, fetches full history, checks ancestry against `origin/main`, and updates `deploy/staging-ready` without `--force`.

- [ ] **Step 2: Run the new test and confirm RED**

Run: `node --test test/deployment-handoff.test.mjs`
Expected: FAIL because `.github/workflows/deployment-handoff.yml` does not exist.

- [ ] **Step 3: Implement `.github/workflows/deployment-handoff.yml`**

Use `workflow_run` for workflow name `CI`; set only `contents: write`; gate on success/main; checkout/fetch full history; assign `CANDIDATE_SHA=${{ github.event.workflow_run.head_sha }}`; require `git merge-base --is-ancestor "$CANDIDATE_SHA" origin/main`; then push `<candidate>:refs/heads/deploy/staging-ready` with no force option.

- [ ] **Step 4: Run handoff tests GREEN**

Run: `node --test test/deployment-handoff.test.mjs`
Expected: all handoff tests PASS.

- [ ] **Step 5: Add the handoff test to root `pnpm test`**

Update root `package.json` so deployment contract tests run both `test/deployment-config.test.mjs` and `test/deployment-handoff.test.mjs` before workspace tests.

- [ ] **Step 6: Run root deployment tests**

Run: `pnpm test`
Expected: existing deployment tests plus new handoff tests PASS.

- [ ] **Step 7: Commit**

Commit message: `ci: gate staging deployment on successful main CI`

---

### Task 2: Migration checksum ledger and legacy baseline

**Files:**
- Create: `packages/db/migrations/0014_schema_migrations.sql`
- Create: `bin/apply-migrations.sh`
- Create: `bin/baseline-staging-migrations.sh`
- Create: `test/migration-runner.test.mjs`
- Modify: `test/deployment-config.test.mjs`

**Interfaces:**
- Produces table `schema_migrations(filename text primary key, checksum text not null, applied_at timestamptz not null default now())`.
- Produces command `bin/apply-migrations.sh <repo-root>`; reads `DATABASE_URL` from literal dotenv parsing when not already exported; applies unseen `packages/db/migrations/*.sql` in lexical order and records SHA-256.
- Produces bootstrap command `bin/baseline-staging-migrations.sh <repo-root>`; validates the existing pre-ledger staging schema/data, creates the ledger if needed, then records current migration checksums without replaying historical SQL.

- [ ] **Step 1: Write failing migration-runner tests**

Create temp PostgreSQL-independent harness tests around a fake `psql`/`sha256sum` PATH shim so shell behavior can be tested deterministically. Required tests:
- `applies unseen migration then records checksum`
- `skips migration whose filename and checksum already match`
- `aborts on checksum drift before applying later migrations`
- `processes filenames in lexical order`
- `dotenv parser preserves ampersand dollar and equals characters literally`
- `baseline refuses to mark legacy migrations when required schema sentinels are missing`

- [ ] **Step 2: Run migration-runner tests RED**

Run: `node --test test/migration-runner.test.mjs`
Expected: FAIL because migration scripts are absent.

- [ ] **Step 3: Add migration `0014_schema_migrations.sql`**

Create only the ledger table/indexes needed by the runner. Keep it idempotent with `CREATE TABLE IF NOT EXISTS`.

- [ ] **Step 4: Implement `bin/apply-migrations.sh`**

Required shell interfaces/functions:
- `load_dotenv_literal <path>`
- `migration_checksum <path>`
- `lookup_recorded_checksum <filename>`
- `apply_one_migration <path> <filename> <checksum>`

Use `psql -v ON_ERROR_STOP=1`; never `source` or `eval` `.env.staging`; abort if a recorded checksum differs; write the ledger row only after the migration succeeds.

- [ ] **Step 5: Implement `bin/baseline-staging-migrations.sh`**

Validate a curated set of schema/data sentinels spanning the legacy 0001-0013 database before inserting baseline ledger rows. At minimum verify core business/branch tables, identity/membership tables, supplier/purchase tables, purchase-return structures, cashbook/expense structures, operating-day/shift structures, money-account/reconciliation structures, credit-term obligation structures, and the known demo tenant seeded by 0013. Abort if any required sentinel is absent.

- [ ] **Step 6: Extend deployment-config tests for migration safety**

Assert both scripts use `set -euo pipefail`, literal dotenv parsing, `ON_ERROR_STOP`, SHA-256 checksums, and do not contain `source "$ENV_FILE"`, `eval`, or hard-coded database credentials.

- [ ] **Step 7: Run migration and deployment tests GREEN**

Run: `node --test test/migration-runner.test.mjs test/deployment-config.test.mjs`
Expected: all tests PASS.

- [ ] **Step 8: Validate all migrations on a disposable PostgreSQL database**

Run the same lexical migration loop used by CI against a disposable PostgreSQL 17 database, then run `bin/apply-migrations.sh` again.
Expected: first migration loop succeeds; second runner is a clean no-op with matching ledger checksums.

- [ ] **Step 9: Commit**

Commit message: `feat: add checksum migration ledger for staging deploys`

---

### Task 3: Immutable release deployment engine

**Files:**
- Create: `bin/deploy-staging.sh`
- Create: `test/staging-deployer.test.mjs`
- Modify: `test/deployment-config.test.mjs`

**Interfaces:**
- Reads:
  - `TRADEOS_DEPLOY_STATE_DIR` default `/home/lightworld/deployments/tradeos`
  - `TRADEOS_RELEASE_ROOT` default `/home/lightworld/releases/tradeos`
  - `TRADEOS_RUNTIME_PATH` default `/home/lightworld/webapps/tradeos-staging`
  - `TRADEOS_SHARED_ENV` default `/home/lightworld/shared/tradeos-staging/.env.staging`
- Uses bare mirror `<state>/repo.git` and approved ref `refs/remotes/origin/deploy/staging-ready`.
- Produces atomic manifest `<state>/last_manifest.txt` only after all health checks pass.

- [ ] **Step 1: Write failing deployer tests with fake Git/PM2/curl/psql commands**

Required tests:
- `reads candidate only from deploy staging ready ref`
- `rejects candidate not reachable from origin main`
- `rejects candidate that is not descendant of deployed sha`
- `no-op candidate exits without build migration or pm2 reload`
- `held flock prevents overlapping deployment`
- `materializes candidate outside active runtime path`
- `manifest is unchanged when validation or build fails`
- `manifest is unchanged when migration fails`
- `successful health checks switch runtime and write manifest`
- `post-activation health failure restores previous runtime pointer and reloads previous release`
- `pruning always keeps active plus at least two previous releases`

- [ ] **Step 2: Run deployer tests RED**

Run: `node --test test/staging-deployer.test.mjs`
Expected: FAIL because `bin/deploy-staging.sh` is absent.

- [ ] **Step 3: Implement candidate discovery and guard functions**

Required shell functions:
- `fetch_refs`
- `read_deployed_sha`
- `candidate_sha`
- `verify_candidate_is_on_main <sha>`
- `verify_fast_forward_from_deployed <deployed> <candidate>`

Fetch `main` and `deploy/staging-ready` into the bare mirror; never choose `origin/main` as the candidate authority.

- [ ] **Step 4: Implement release preparation functions**

Required functions:
- `prepare_release <sha>` materializes exact Git archive into `<release-root>/<sha>`
- `attach_shared_env <release>` creates `.env.staging` symlink to persistent shared path
- `validate_release <release>` runs deployment tests, `pnpm typecheck`, and `pnpm build`
- `apply_release_migrations <release>` invokes `bin/apply-migrations.sh`

Ensure `HOME=/home/lightworld` and PATH/Corepack behavior are explicit so the deployer does not inherit root's Corepack cache.

- [ ] **Step 5: Implement activation, health, rollback, and manifest functions**

Required functions:
- `switch_runtime <release>` using atomic symlink replacement
- `reload_tradeos_pm2 <release>` using tracked `ecosystem.config.cjs`
- `wait_for_health` with bounded retries for API 4036 and web 3036
- `verify_public_health` for `https://tradeosafrica.lightworldtech.com/`
- `rollback_runtime <previous-release>`
- `write_manifest_atomically <candidate> <previous>`
- `prune_old_releases`

Do not update the manifest until local API, local web, public HTTPS, and PM2 ownership/status checks all pass.

- [ ] **Step 6: Extend deployment-config contract tests**

Assert the deploy script defaults to the exact state/release/runtime/shared paths, uses `flock`, references `deploy/staging-ready`, never uses unsafe dotenv sourcing, and verifies both TradeOS PM2 app names.

- [ ] **Step 7: Run deployer tests GREEN**

Run: `node --test test/staging-deployer.test.mjs test/deployment-config.test.mjs`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

Commit message: `feat: add immutable staging release deployer`

---

### Task 4: systemd units and idempotent VPS bootstrap

**Files:**
- Create: `ops/systemd/tradeos-deploy.service`
- Create: `ops/systemd/tradeos-deploy.timer`
- Create: `bin/bootstrap-staging-deployer.sh`
- Create: `test/staging-bootstrap.test.mjs`
- Modify: `test/deployment-config.test.mjs`

**Interfaces:**
- Service invokes `/home/lightworld/webapps/tradeos-staging/bin/deploy-staging.sh` as `User=lightworld`, `Group=lightworld`, `Type=oneshot`.
- Timer invokes `tradeos-deploy.service` approximately every minute and is persistent.
- Bootstrap is a root-operated one-time installer but creates runtime/deployment assets owned by `lightworld`; normal deployments never require root.

- [ ] **Step 1: Write failing unit/bootstrap tests**

Required tests:
- `service is oneshot and runs deployer as lightworld`
- `service pins HOME to lightworld and has bounded timeout`
- `timer targets deploy service and is persistent`
- `bootstrap preserves existing env file without printing it`
- `bootstrap creates bare mirror and initial release before replacing runtime directory`
- `bootstrap refuses to replace runtime path unless candidate release passed local health checks`
- `bootstrap is safe when persistent directories and symlink already exist`

- [ ] **Step 2: Run bootstrap tests RED**

Run: `node --test test/staging-bootstrap.test.mjs`
Expected: FAIL because unit/bootstrap files are absent.

- [ ] **Step 3: Implement systemd units**

Service must set `User=lightworld`, `Group=lightworld`, `Environment=HOME=/home/lightworld`, `Type=oneshot`, and a bounded `TimeoutStartSec`. Timer must use `OnBootSec`, roughly one-minute `OnUnitActiveSec`, `Persistent=true`, and target the service.

- [ ] **Step 4: Implement `bin/bootstrap-staging-deployer.sh`**

Required stages:
- validate current runtime is healthy;
- create persistent state/release/shared directories;
- preserve/move existing `.env.staging` without echoing contents;
- create/fetch bare mirror;
- baseline migration ledger;
- materialize current verified SHA as initial release;
- verify the initial release locally before switching path layout;
- convert `/home/lightworld/webapps/tradeos-staging` to stable symlink atomically;
- install copied systemd unit files;
- enable/start timer;
- run one no-op service verification.

The script must detect an already-bootstrapped layout and avoid destructive rework.

- [ ] **Step 5: Extend deployment-config tests**

Assert service/timer/bootstrap paths and least-privilege requirements match the spec and no unit file contains database credentials.

- [ ] **Step 6: Run bootstrap/deployment tests GREEN**

Run: `node --test test/staging-bootstrap.test.mjs test/deployment-config.test.mjs`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

Commit message: `ops: add TradeOS staging deploy service and bootstrap`

---

### Task 5: Documentation, full verification, and controlled VPS installation

**Files:**
- Create: `docs/operations/staging-deployment.md`
- Modify: `README.md`

**Interfaces:**
- Documents operator commands for status, logs, manifest inspection, manual service trigger, rollback diagnosis, and handoff-ref inspection without exposing secrets.

- [ ] **Step 1: Document deployment lifecycle and recovery**

Cover CI -> `deploy/staging-ready` -> systemd timer -> release preparation -> migrations -> atomic activation -> PM2 -> health -> manifest. Include `systemctl status tradeos-deploy.timer`, `systemctl status tradeos-deploy.service`, `journalctl -u tradeos-deploy.service`, and manifest location. State explicitly that schema rollback is not automatic.

- [ ] **Step 2: Run complete repository verification**

Run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Expected: all commands exit 0.

- [ ] **Step 3: Review branch diff against spec**

Verify every spec section maps to tracked code/tests/docs and no unrelated application behavior changed.

- [ ] **Step 4: Commit documentation**

Commit message: `docs: document TradeOS staging deployment operations`

- [ ] **Step 5: Merge through reviewed PR only after CI is green**

Verify PR CI on the exact head SHA before merge.

- [ ] **Step 6: Perform one-time VPS bootstrap**

Run the tracked bootstrap from the verified merged release as root only for installation. Do not expose `.env.staging` contents.

- [ ] **Step 7: Verify systemd installation**

Confirm timer enabled/active, service can execute as `lightworld`, persistent directories have correct ownership, and the first service cycle is a clean no-op when already current.

- [ ] **Step 8: Verify runtime after bootstrap**

Confirm:
- PM2 API/web are online as `lightworld`;
- `curl -fsS http://127.0.0.1:4036/health` returns 200 and database time;
- `curl -fsSI http://127.0.0.1:3036/` returns 200;
- `curl -fsSI https://tradeosafrica.lightworldtech.com/` returns 200;
- manifest SHA equals active release SHA.

- [ ] **Step 9: Prove automatic deployment with a harmless controlled commit**

Merge a documentation-or-version-marker change through normal CI. Verify CI success advances `deploy/staging-ready`, the timer deploys that exact SHA within its cadence, public health remains 200, manifest updates once, and the next cycle is a no-op.

- [ ] **Step 10: Prove failure containment**

Use a non-merge test harness/fake environment to prove failed CI never advances the handoff and failed local validation never changes the active runtime. Do not intentionally break the public staging service.
