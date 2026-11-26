# Branch-restricted POS attendant: rollout and verification

Scope: POS_ATTENDANT only. Existing cashiers, managers and business
owners do not lose any access. Requires migrations 0061, 0062, 0063 in
that order after a protected migration rehearsal; NOT LIVE.

## Owner workflow
Open Business Settings -> Team & access. Add a staff member with role
POS attendant (cash-only). The branch assignment editor opens after
saving. Select one or more active physical branches and save. For an
existing POS attendant, choose Assign branches. An empty selection
revokes all POS access. Send the invitation after saving branch access.
Owners and administrators may manage; managers cannot.

## Authorization and transaction boundaries
- No branch grants means 403 BRANCH_SCOPE_DENIED. Never silently assign
  Main branch.
- Authenticated business context returns only assigned active branches.
- Every POS sale mutation validates branchId before financial posting,
  including an offline replay using a stale device branch. Existing
  cash-only, no-credit, no-discount rules remain.
- Public price quote and POS availability validate branch assignment.
  Inventory costs remain hidden.
- Completed PDF receipts must belong to the same staff identity and a
  currently assigned branch. Other financial endpoints retain their
  existing restrictive role lists.
- Catalog list represents shared business retail catalog, not branch
  stock cost or profit.
- Assignment API requires owner/admin, validates same-tenant active
  branches, updates atomically, writes before/after audit. Composite
  foreign keys reject cross-tenant inserts at database level.
- Employee role changes remove old branch grants. Return to POS requires
  an explicit new assignment.
- Revocation denies subsequent requests. A previously authorized
  in-flight sale may finish; do not claim cancellation of in-flight work.

## Real PostgreSQL CI UAT matrix
1. No grants: context, stock, sale all deny.
2. Main grant: Main only visible; Main quote, stock, sale and own
   completed receipt allowed; Market denied.
3. Transfer grant to Market: Main hidden and old Main receipt denied.
4. Foreign tenant, invalid/duplicate IDs: reject with grants unchanged.
5. Role change SALES then back POS: old grants removed.
6. Existing cashier/owner permissions and offline queue intact.

## Deployment gate
Shared VPS still serves an older immutable release, root disk ~90%.
GitHub-hosted CI only. Do not run 0061-0063 on live DB or switch PM2
until independent offsite restore, finance-outbox triage (#218), verified
migrations, signed artifact promotion and tested rollback (#204).
