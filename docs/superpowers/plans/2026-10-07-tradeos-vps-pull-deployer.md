# TradeOS VPS Pull Deployer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CI-gated VPS staging deployer that promotes only successfully tested `main` commits, applies forward-only migrations safely, prepares immutable releases, atomically switches the active runtime, and restores the previous application release on failed post-activation health checks.

**Architecture:** GitHub Actions advances a fast-forward-only `deploy/staging-ready` ref after successful CI on `main`. A `lightworld` systemd timer polls that approved ref through a persistent bare Git mirror, materializes a release by SHA, validates/builds it, applies only migrations not already recorded in a checksum ledger, atomically switches `/home/lightworld/webapps/tradeos-staging`, reloads the existing PM2 apps, verifies health, and records a manifest. The existing staging database is explicitly baselined once; the normal migration runner refuses to operate before that baseline exists.

**Tech Stack:** GitHub Actions, Bash, Git, systemd, PM2, Node.js 22+, pnpm 10.17.1, PostgreSQL 17-compatible SQL, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-07-tradeos-vps-pull-deployer-design.md`

## Global Constraints

- Deploy only a CI-approved SHA from `refs/heads/deploy/staging-ready`; never deploy `main` directly.
- The handoff ref moves by normal fast-forward only; never force-push it.
- Normal VPS deployment runs as `lightworld`, not root.
- No GitHub SSH key or PAT on the VPS.
- Preserve `.env.staging` outside Git; never print, `source`, or `eval` secret values.
- Keep API `127.0.0.1:4036`, web `127.0.0.1:3036`, PM2 names `tradeos-staging-api` / `tradeos-staging-web`, and tracked launchers unchanged.
- Historical migrations become immutable once baselined; checksum drift aborts deployment.
- The normal migration runner requires an existing `schema_migrations` baseline and must never replay pre-ledger history on an unbaselined database.
- Activation is atomic and manifest advancement happens only after all health checks pass.
- Database rollback is never automatic; future migrations follow expand/contract compatibility.

## Review Focus

- **Out-of-order successful CI runs:** stale CI must not move the handoff ref backward — Task 1.
- **Unbaselined or checksum-drift database:** normal deployment must abort before replaying history — Task 2.
- **Concurrent/interrupted deploy:** lock/no-op behavior and reusable candidate releases must be safe — Task 3.
- **Post-migration application health failure:** restore prior code pointer while retaining forward schema — Task 3.
- **Secret/metacharacter dotenv values:** preserve literal data without shell evaluation or logging — Tasks 2 and 4.

---

### Task 1: CI-approved staging handoff

**Files:**
- Create: `.github/workflows/deployment-handoff.yml`
- Create: `test/deployment-handoff.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes existing workflow named `CI`.
- Produces fast-forward-only `refs/heads/deploy/staging-ready` at the exact successful `workflow_run.head_sha` from `main`.

- [ ] **Step 1: Write failing workflow-contract tests**

Tests:
- `handoff listens only to completed CI workflow runs`
- `handoff requires success and main before publishing`
- `handoff publishes workflow_run.head_sha without force`
- `handoff verifies candidate remains reachable from main`

Assert `workflow_run`, `types: [completed]`, `contents: write`, checks for `conclusion == 'success'` and `head_branch == 'main'`, full-history fetch, ancestry check against `origin/main`, and a push to `deploy/staging-ready` with no force option.

- [ ] **Step 2: Run RED**

Run: `node --test test/deployment-handoff.test.mjs`
Expected: FAIL because workflow file does not exist.

- [ ] **Step 3: Implement the handoff workflow**

Use `workflow_run.head_sha` as candidate; verify it is still on `origin/main`; push `<sha>:refs/heads/deploy/staging-ready` normally. A stale out-of-order run must fail its non-fast-forward push instead of moving the ref backward.

- [ ] **Step 4: Run GREEN and wire into root tests**

Run: `node --test test/deployment-handoff.test.mjs`, then update root `pnpm test` to include it and run `pnpm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `ci: gate staging deployment on successful main CI`

---

### Task 2: Migration checksum ledger and one-time staging baseline

**Files:**
- Create: `packages/db/migrations/0014_schema_migrations.sql`
- Create: `bin/apply-migrations.sh`
- Create: `bin/baseline-staging-migrations.sh`
- Create: `test/migration-runner.test.mjs`
- Modify: `test/deployment-config.test.mjs`

**Interfaces:**
- `schema_migrations(filename text primary key, checksum text not null, applied_at timestamptz not null default now())`.
- `bin/baseline-staging-migrations.sh <repo-root>`: one-time existing-staging operation; validates legacy schema/data sentinels, creates ledger, records checksums for the already-applied 0001-0014 set without replaying historical SQL.
- `bin/apply-migrations.sh <repo-root>`: normal deployment operation; **requires a nonempty valid baseline ledger**, compares every tracked migration checksum, applies only files absent from the ledger, and records each only after success.

- [ ] **Step 1: Write failing migration-runner tests**

Tests:
- `normal runner refuses database with no migration ledger`
- `normal runner refuses empty unbaselined migration ledger`
- `applies unseen post-baseline migration then records checksum`
- `skips migration whose filename and checksum match`
- `aborts on checksum drift before applying later migrations`
- `processes new migration filenames in lexical order`
- `dotenv parser preserves ampersand dollar and equals characters literally`
- `baseline refuses when required legacy schema sentinel is missing`
- `baseline records legacy checksums without executing legacy migration files`

Use fake `psql`/`sha256sum` PATH shims for deterministic shell tests.

- [ ] **Step 2: Run RED**

Run: `node --test test/migration-runner.test.mjs`
Expected: FAIL because scripts/migration are absent.

- [ ] **Step 3: Add `0014_schema_migrations.sql`**

Create only the idempotent ledger table required by deployment.

- [ ] **Step 4: Implement literal dotenv and migration helpers**

In `bin/apply-migrations.sh` define:
- `load_dotenv_literal <path>`
- `migration_checksum <path>`
- `assert_baseline_ready`
- `lookup_recorded_checksum <filename>`
- `apply_one_migration <path> <filename> <checksum>`

Use `psql -v ON_ERROR_STOP=1`; never `source` or `eval`. `assert_baseline_ready` aborts when the ledger is absent/empty rather than replaying historical migrations.

- [ ] **Step 5: Implement the one-time baseline script**

`bin/baseline-staging-migrations.sh` validates schema/data sentinels spanning 0001-0013 (core business/branch, identity/membership, supplier/purchase, purchase returns, cashbook/expenses, operating days/shifts, money accounts/reconciliation, credit obligations, and the demo tenant). It creates the ledger using the same schema as 0014, then records checksums for 0001-0014 without executing those migration files.

- [ ] **Step 6: Extend safety-contract tests**

Assert `set -euo pipefail`, literal dotenv parsing, `ON_ERROR_STOP`, SHA-256 usage, baseline requirement, and absence of `source "$ENV_FILE"`, `eval`, or hard-coded credentials.

- [ ] **Step 7: Run GREEN**

Run: `node --test test/migration-runner.test.mjs test/deployment-config.test.mjs`
Expected: PASS.

- [ ] **Step 8: Verify both CI and staging migration modes on disposable PostgreSQL 17 databases**

Database A: run the existing CI lexical migration loop over 0001-0014 and verify it succeeds.

Database B: run 0001-0014 with the CI loop, then run `baseline-staging-migrations.sh`; verify 14 ledger rows with matching checksums and no historical replay. Add a synthetic test-only `0015` fixture in a temporary repo copy, run `apply-migrations.sh` once (applies/records it), then again (clean no-op).

- [ ] **Step 9: Commit**

Commit: `feat: add checksum migration ledger for staging deploys`

---

### Task 3: Immutable release deployment engine

**Files:**
- Create: `bin/deploy-staging.sh`
- Create: `test/staging-deployer.test.mjs`
- Modify: `test/deployment-config.test.mjs`

**Interfaces:**
- Defaults:
  - state `/home/lightworld/deployments/tradeos`
  - releases `/home/lightworld/releases/tradeos`
  - runtime `/home/lightworld/webapps/tradeos-staging`
  - env `/home/lightworld/shared/tradeos-staging/.env.staging`
- Uses bare mirror `<state>/repo.git`.
- Candidate is only `refs/remotes/origin/deploy/staging-ready`.
- Writes `<state>/last_manifest.txt` only after successful activation verification.

- [ ] **Step 1: Write failing fake-command deployer tests**

Tests:
- approved ref is the only candidate source;
- candidate must be reachable from `origin/main`;
- candidate must descend from deployed SHA;
- equal SHA is a no-op with no build/migration/reload;
- held `flock` prevents overlap;
- candidate is materialized outside active runtime;
- validation/migration failure leaves runtime and manifest untouched;
- success switches runtime and writes manifest;
- post-activation health failure restores previous runtime and leaves manifest unchanged;
- pruning keeps active plus at least two prior releases.

- [ ] **Step 2: Run RED**

Run: `node --test test/staging-deployer.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement discovery/guard functions**

Functions:
- `fetch_refs`
- `read_deployed_sha`
- `candidate_sha`
- `verify_candidate_is_on_main <sha>`
- `verify_fast_forward_from_deployed <deployed> <candidate>`

- [ ] **Step 4: Implement release preparation**

Functions:
- `prepare_release <sha>` via exact archive from bare mirror
- `attach_shared_env <release>`
- `validate_release <release>` running deployment tests, `pnpm typecheck`, `pnpm build`
- `apply_release_migrations <release>` invoking normal migration runner

Pin `HOME=/home/lightworld` and predictable pnpm/Corepack PATH so root cache state cannot leak into the `lightworld` service.

- [ ] **Step 5: Implement activation/health/rollback**

Functions:
- `switch_runtime <release>` with atomic symlink replacement
- `reload_tradeos_pm2 <release>`
- `wait_for_health` with bounded retries for API/web
- `verify_public_health`
- `verify_pm2_ownership`
- `rollback_runtime <previous-release>`
- `write_manifest_atomically <candidate> <previous>`
- `prune_old_releases`

- [ ] **Step 6: Run GREEN and contract tests**

Run: `node --test test/staging-deployer.test.mjs test/deployment-config.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit: `feat: add immutable staging release deployer`

---

### Task 4: systemd units and idempotent bootstrap

**Files:**
- Create: `ops/systemd/tradeos-deploy.service`
- Create: `ops/systemd/tradeos-deploy.timer`
- Create: `bin/bootstrap-staging-deployer.sh`
- Create: `test/staging-bootstrap.test.mjs`
- Modify: `test/deployment-config.test.mjs`

**Interfaces:**
- Service executes `/home/lightworld/webapps/tradeos-staging/bin/deploy-staging.sh` with `User=lightworld`, `Group=lightworld`, `HOME=/home/lightworld`, `Type=oneshot`.
- Timer targets that service about once per minute and is persistent.
- Bootstrap is the only root-required installation step; normal deployments remain unprivileged.

- [ ] **Step 1: Write failing unit/bootstrap tests**

Tests:
- service runs one-shot as `lightworld` and pins HOME;
- service has bounded start timeout;
- timer targets service and is persistent;
- bootstrap preserves env without printing it;
- bare mirror and initial release exist before runtime path replacement;
- bootstrap refuses switch unless candidate local health passes;
- rerunning an already-bootstrapped layout is non-destructive.

- [ ] **Step 2: Run RED**

Run: `node --test test/staging-bootstrap.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement systemd units**

Use `OnBootSec`, roughly one-minute `OnUnitActiveSec`, `Persistent=true`, and a bounded `TimeoutStartSec`.

- [ ] **Step 4: Implement bootstrap stages**

Validate current runtime health; create persistent state/release/shared dirs; preserve/move `.env.staging`; create/fetch bare mirror; run migration baseline; materialize and locally verify the current known-good SHA; atomically convert runtime path to stable symlink; install/enable timer; run one no-op service verification. Detect and safely reuse an existing bootstrapped layout.

- [ ] **Step 5: Run GREEN**

Run: `node --test test/staging-bootstrap.test.mjs test/deployment-config.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `ops: add TradeOS staging deploy service and bootstrap`

---

### Task 5: Documentation, whole-repo verification, PR, and controlled VPS installation

**Files:**
- Create: `docs/operations/staging-deployment.md`
- Modify: `README.md`

- [ ] **Step 1: Document lifecycle and recovery**

Document CI -> handoff ref -> timer -> release -> migrations -> activation -> PM2 -> health -> manifest; status/journal/manifest commands; and explicit forward-only schema policy.

- [ ] **Step 2: Run full verification**

Run `pnpm typecheck`, `pnpm test`, `pnpm build`.
Expected: all exit 0.

- [ ] **Step 3: Review branch diff against the spec and request code review**

Confirm every spec requirement maps to code/tests/docs and no unrelated business behavior changed.

- [ ] **Step 4: Commit docs and open reviewed PR**

Commit: `docs: document TradeOS staging deployment operations`. Merge only after CI is green on the exact PR head.

- [ ] **Step 5: Perform one-time VPS bootstrap from the verified merged release**

Run root-only installer without exposing `.env.staging` contents.

- [ ] **Step 6: Verify installed service and runtime**

Confirm timer enabled/active; no-op cycle succeeds; PM2 API/web online as `lightworld`; API local health 200 with database time; web local 200; public HTTPS 200; manifest SHA equals active release and approved handoff SHA.

- [ ] **Step 7: Prove automatic promotion with a harmless controlled follow-up commit**

Merge through normal CI; verify successful CI advances the handoff, timer deploys exactly that SHA, manifest updates once, public health stays 200, and the next cycle is a no-op.

- [ ] **Step 8: Prove failure containment only in test/fake environments**

Verify failed CI never advances the handoff and failed local validation never changes the active runtime. Do not intentionally break the public staging service.
