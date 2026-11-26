# TradeOS Staging Migration Ledger Design

## Intent
Prevent TradeOS staging from ever activating application code against an older PostgreSQL schema. The October 23 incident happened because the VPS deployment profile used `MIGRATION_MODE='manual'`, while the deployed System Admin code required migrations 0021 and 0022.

## Goals
- Apply each tracked PostgreSQL migration at most once and in filename order before release activation.
- Record a SHA-256 checksum for every applied migration in the database.
- Fail closed if an applied filename's checksum changes, a prior migration is left incomplete, SQL fails, or the migration directory is malformed.
- Serialize migration work with a PostgreSQL advisory lock in addition to the existing VPS application deployment lock.
- Keep `.env.staging` values out of shell evaluation and logs.
- Preserve the current release if migration preparation fails; no process restart or symlink activation occurs.

## Non-goals
- Down/reverse migrations.
- Automatic rollback of schema after a forward migration succeeds.
- Allowing destructive migrations without review.
- Guessing a legacy database baseline from existing tables.

## Approach
Use a compiled API-side migration runner (`apps/api/src/scripts/apply-migrations.ts`) because the API already owns the PostgreSQL client and is built before activation. The VPS deployer gets a new `postgres-ledger` migration mode that invokes this runner after the release build and before source verification/activation. The runner acquires a fixed PostgreSQL advisory lock, creates `lightworld_schema_migrations`, scans only canonical `NNNN_name.sql` files, computes SHA-256 checksums, and applies pending files sequentially on one database session.

For each pending file the runner first persists an `APPLYING` ledger row, then executes the migration SQL, then marks it `APPLIED`. SQL failure marks the row `FAILED` when possible and aborts. Any existing `APPLYING`/`FAILED` row blocks later deploys until explicitly reconciled. An `APPLIED` row with a different checksum also blocks deployment.

The staging database predates this ledger. It will therefore receive a one-time explicit baseline after verifying the current schema includes migrations 0001–0022; the baseline records the exact current-main checksums without replaying old SQL. After that, the live registry switches from `manual` to `postgres-ledger`.

## Safety and rollback
The application symlink is not changed until build + migrations + release-source verification all succeed. If a migration succeeds but the new application later fails health checks, the deployer can roll application code back, so migrations must remain forward/backward compatible with the immediately previous application release. Schema rollback is deliberately not automated.

## Testing
- Unit/integration tests for fresh apply, no-op second run, checksum drift, failed SQL, interrupted `APPLYING`, filename validation, and advisory lock behavior.
- VPS contract tests proving `postgres-ledger` invokes migration before activation and failure prevents activation/restart.
- Existing deployment/security tests remain green.
- Disposable PostgreSQL migration validation remains part of CI.
