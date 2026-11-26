# TradeOS: finance/refund/offline read-only pre-cutover gate (first slice)

**Scope:** protected GitHub-source preflight module and regression tests only. This
is *not* installed as a privileged VPS root tool, is *not* a deployable runtime
artifact, and does *not* authorize any production or staging cutover.

## Nine aggregate checks

The module issues one fixed `SELECT COUNT(*)::text` per category against the
current schema: pending sale payments, pending refund transactions, in-flight
merchant Hubtel POS checkouts, in-flight subscription checkouts, requested
subscription refunds, offline sync mutations still RECEIVED, unpublished outbox
events, inconsistent reconciled Hubtel checkout/payment links, and externally
succeeded refunds without a provider reference.

A single `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` and
mandatory `ROLLBACK` surround all nine checks. No sale/customer/tenant IDs,
amounts, provider references, PII, raw SQL errors, or credentials are printed.
The evaluation rejects any invalid/missing/unsafe count, SQL error, connection
failure, or failed rollback. Nonzero counts show **review required**, never
alter rows or clear a backlog. In-flight transactions may be legitimate, so
human review and a planned maintenance window are needed; nothing is silently
reclassified as settled or failed.

The CLI is designed to run **only in a separately approved protected operation**
against an exact verified source-light candidate and protected external env
file, as the unprivileged application user. It refuses an unverified bundle
and loads the DB driver from the verified runtime, not a source checkout.
The existing root auditor still only performs signature, migration and
temporary candidate sealing; this PR deliberately does **not** edit its
installed signed checksum list, launcher or run a database query from CI.

## Verification and release boundary

CI: `node --test test/read-only-finance-gate.test.mjs` exercises fixed-only SQL,
all nine nonzero blockers, fail-closed malformed counts, repeatable-read/ROLLBACK,
failed SELECT/ROLLBACK, minimal output and nonactivation contract. Existing
migration and CI artifact contracts remain mandatory. No VPS build, package
install, database migration, SQL write, finance/refund/provider API call,
release switch, PM2 restart or generated artifact retention.

**Next separately gated steps:** approve/pin source in root-owned audited
operator tool; verify actual staging data as read-only with no secrets exposed;
test backup/isolated restore and scheduler ownership; implement deployable
immutable-artifact contract and isolated canary; rehearse PM2 switch + rollback.
Until all checks pass, `authorizedToDeploy=false`. Issue #204 remains open.
