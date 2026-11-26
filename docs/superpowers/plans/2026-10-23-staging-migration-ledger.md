# TradeOS Staging Migration Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every TradeOS staging deployment schema-aware so application activation is blocked until all tracked PostgreSQL migrations are safely applied exactly once.

**Architecture:** A compiled API migration CLI owns PostgreSQL ledger/checksum/locking semantics. The Lightworld VPS deploy engine adds a `postgres-ledger` mode that invokes the CLI after build and before activation. Staging is explicitly baselined through the current migrations once, then switches to the ledger mode.

**Tech Stack:** TypeScript, Node.js, `pg`, PostgreSQL, Bash, Node test runner/Vitest, Lightworld VPS deployment engine.

**Spec:** `docs/superpowers/specs/2026-10-23-staging-migration-ledger-design.md`

## Global Constraints
- Never source `.env.staging` in Bash; dotenv values are data, not shell code.
- Never print `DATABASE_URL`, API keys, tokens, or other environment values.
- Migration failures must happen before release activation and process restart.
- Applied migration checksum drift must fail closed.
- No automatic schema rollback.

## Review Focus
- A process dies after an `APPLYING` row is written: next deploy must block rather than replay.
- An already applied SQL file changes: checksum mismatch must block.
- Invalid/noncanonical files in the migrations directory must not be executed.
- A SQL migration fails: active release remains unchanged and the ledger records failure when possible.
- Concurrent migration attempts: database advisory lock serializes them.

---

### Task 1: PostgreSQL migration ledger runner

**Files:**
- Create: `apps/api/src/scripts/apply-migrations.ts`
- Create: `apps/api/test/apply-migrations.integration.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces CLI: `node apps/api/dist/scripts/apply-migrations.js <migration-directory>`.
- Uses `DATABASE_URL` from process environment and optional `TRADEOS_RELEASE_SHA` for ledger metadata.

- [ ] Write integration tests for fresh apply, second-run no-op, checksum mismatch, failed SQL, interrupted state, canonical filename ordering, and advisory lock serialization.
- [ ] Run focused tests and observe RED because the runner does not exist.
- [ ] Implement the minimal runner with one PostgreSQL session, advisory lock, SHA-256 checksums and `lightworld_schema_migrations` state transitions.
- [ ] Run focused tests to GREEN and run API typecheck.
- [ ] Commit Task 1.

### Task 2: VPS deployer `postgres-ledger` mode

**Files:**
- Modify: `ops/lightworld-vps/lib/common.sh`
- Modify: `ops/lightworld-vps/apps/tradeos-africa.staging.conf.example`
- Modify: `test/lightworld-vps-platform.test.mjs`

**Interfaces:**
- Consumes migration CLI from Task 1.
- `MIGRATION_MODE='postgres-ledger'` runs the compiled CLI with the release migration directory after build and before activation.

- [ ] Add failing deployment contract tests that require `postgres-ledger`, verify invocation order, and prove migration failure blocks activation/restart.
- [ ] Run focused VPS tests and observe RED.
- [ ] Implement safe invocation through `node --env-file=<ENV_FILE>` as the app user; reject unsupported modes.
- [ ] Update the TradeOS staging registry template to `postgres-ledger`.
- [ ] Run focused VPS tests to GREEN and run shell syntax checks.
- [ ] Commit Task 2.

### Task 3: Staging baseline and installation

**Files:**
- Operational: `/etc/lightworld-deploy/apps.d/tradeos-africa.staging.conf`
- Operational: `/usr/local/libexec/lightworld-deploy/*`
- Database: `lightworld_schema_migrations`

**Interfaces:**
- Baseline records exact checksums for migrations 0001–0022 only after schema verification.

- [ ] Build a disposable schema from migrations 0001–0022 and compare required database objects with staging before baselining.
- [ ] Seed `lightworld_schema_migrations` for 0001–0022 using exact current-main SHA-256 checksums and state `APPLIED`.
- [ ] Install the tested deploy engine files and switch the live TradeOS staging registry to `MIGRATION_MODE='postgres-ledger'`.
- [ ] Run the migration CLI against staging and verify a clean no-op with no pending migrations.
- [ ] Run deployment engine contract tests plus repository deployment tests.
- [ ] Commit/push the branch; verify CI; merge only after green.
