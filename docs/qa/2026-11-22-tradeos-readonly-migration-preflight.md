# TradeOS — signed artifact pre-promotion migration ledger gate

**Scope:** Gate the separately verified, **nondeployable** GitHub-built source-light runtime. Do not activate, migrate, restart, update finance records, or alter the release symlink.

## Why it matters

TradeOS records PostgreSQL migrations in `lightworld_schema_migrations` with migration filename, immutable SHA-256 checksum and `APPLIED`, `APPLYING`, or `FAILED` state. Deploying code with an unrecognized schema, modified historical SQL, a failed migration, or bundled migrations missing from the ledger could threaten payments, returns, refunds, stock and transaction accounting. Checksums and signing alone do not test SQL compatibility.

## Implementation

- `ops/release/check-promotion-migrations.mjs` verifies the *exact* pilot manifest source SHA, Node 22, `deployable:false`, regular runtime package structure and canonical, non-symlinked migration files. It calculates SHA-256 for the SQL bytes without executing them.
- A PostgreSQL client is loaded from the **verified bundle**'s `apps/api/node_modules`. Only the external `DATABASE_URL` is used. It runs `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, selects only `migration_name`, `checksum_sha256`, `state` from the schema ledger, and always issues `ROLLBACK` on normal read or SQL failure. Client timeouts and one-connection pool bound the check. It does not load transaction, payment, customer, credentials or other financial tables.
- The comparison **blocks** pending SQL migrations, SQL checksum drift, `APPLYING`/`FAILED` ledger rows, duplicate or malformed records, ledger history absent from the bundle, unexpected symlinks, unexpected schema identity and database/query failures. Output is intentionally restricted to migration filenames, counts, compatibility and blocker categories; database credentials/connection strings are never printed.
- The authenticated `audit-github-artifact-pilot.sh <exact-main-sha> <main-push-run> --rehearse --ledger-readonly` opt-in extends the existing signature, source, checksum, archive structure and quarantined extraction checks. It requires the root-owned application registry and external config, and uses the **lightworld** application identity to read the ledger, never the root deployer identity. The temporary sandbox is app-group readable only for this audit. The existing audit and `--rehearse` behavior stay read-only with no database connection by default.
- The output explicitly includes `authorizedToDeploy:false` and `artifactDeployable:false` even on a compatible ledger. No release promotion, migration or activation code is introduced or enabled.

## Tests

```
node --test test/read-only-promotion-gate.test.mjs test/ci-artifact-pilot-contract.test.mjs
python3 -m unittest discover -s test -p test_ci_artifact_intake.py -v
python3 -m unittest discover -s test -p test_ci_signed_provenance.py -v
python3 -m unittest discover -s test -p test_source_light_launchers.py -v
```

The ledger gate's 13 isolated tests cover accepted history, pending/new migrations, modified/absent historical migrations, failed/applying rows, duplicate data, bad manifests, symlinks, read-only SQL ordering and rollback on failure. The CI contract ensures this gate cannot gain activation privileges. GitHub Actions validates the pure tests without accessing live TradeOS financial records.

## Remaining release activation gates

The next separately reviewed deployment capability still needs an independently trusted deployable artifact schema and root-owned immutable-release installer, migration/backups and payment-refund reconciliation evidence, app readiness/PM2 start on loopback-only test ports, atomic activation and verified rollback. This gate is a **precondition**, not a replacement for those controls. The shared VPS source-light build/space policy remains binding.
