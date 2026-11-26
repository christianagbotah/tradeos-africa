# Optional shift-before-sale enforcement — Ghana and multi-region merchants

## Model and rollout
- Default OFF for every existing and new business/branch. A branch OWNER
  or ADMIN must explicitly enable with a 10–500 character audit reason.
- Configuration is per branch, not a global constraint that stops other
  businesses, waakye sellers or unsupervised small shops from selling.
- Branch Settings displays effective policy and requires a backdrop confirmation
  modal and optimistic revision check. Changes use authenticated API, are
  unavailable offline, and update immediately on confirmed response.
- Each enable or disable writes a new policy event record, audited action and
  outbox event. No permission to alter another branch or business. Role and
  staff actor originate from the session, never from caller-supplied payload.
- Direct and queued SALE_CREATE mutations run the same authoritative domain
  transaction guard before inventory, money or sales rows can be created.
  The guard validates authenticated seller's shift and operating day within
  the branch at the recorded sale timestamp.
- A new sale inside a mandatory-shift period without a corresponding shift
  rejects as SHIFT_REQUIRED_FOR_SALE, leaving its failed offline mutation in
  the native/web review queue. No fake receipt, ledger or stock posting.
- Offline sales timestamped before initial enable are not retroactively
  denied; sales during enabled periods require a covering shift even if
  they synchronize after shift close. Disabling/re-enabling preserves history.
- Existing applied sale mutations remain idempotent replays before policy
  evaluation, avoiding double billing or retroactive rejection.
- If a branch enables enforcement, users with SALES/STAFF roles who lack
  shift-opening permissions need reassignment to shift-capable roles or
  a supervisor must disable the requirement. No silent role bypass.

## Tests
PostgreSQL integration covers default OFF, API role and branch scopes,
optimistic revisions, audited policy history, rejection before economic
posting, covered shifts, late offline sales after closing, past-before-enable
sales, and opt-out. Static contract tests protect UI/server wiring.

## Security and limitations
- Recorded occurredAt is client-provided. Offline client clock integrity or
  backdating cannot be independently attested; regulated firms may require
  trusted device time or online-only checkout for guarantees.
- History is append-only through application permissions. Privileged database
  administrators may amend records; database-level immutability remains future.
- Late posted sales can change a closed shift's expected and variance values
  while leaving physical counted closing values intact.
- Supervisor acceptance, cash deposit reconciliation and report approval
  are future separate features. No automatic cashbook adjustments.
- Migration 0064 is additive, but passing CI is not permission to deploy.
  Protected staging remains old until offsite restore, 3 historical outbox
  events, migration rehearsal 0061–0064, deployable signed artifact and
  rollback have been verified (issues 204 and 218).
