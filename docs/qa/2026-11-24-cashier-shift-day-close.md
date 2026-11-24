# SME shift and daily close UI contract repair

## Existing accounting, not a duplicate

TradeOS already persists operating days, cashier shifts, five tender balances,
cashbook movement attribution, idempotent opening/closing sync mutations,
immutable audit/outbox events and late-offline movement reattribution.
The source web screen used to expect a nonexistent "current" wrapper from
GET /v1/operations/current and submitted incomplete financial mutations.

## Owner / cashier workflow

- Owner, manager or accountant opens a trading day; local business date
  and counted opening cash float required.
- Staff opens their own shift under the open day with counted opening cash.
  Cashier has own shift rights, not day-close permission.
- Real cashbook entries contribute to expected balances during the shift.
  Existing sale, refund, expense and transfer permission gates remain.
- Cashier counts all five methods (cash, MoMo, card, bank, other), optionally
  records a handover note and confirms their own shift close by its server ID.
- Supervisor cannot close operating day while any staff shift is open.
  After all shifts close, supervisor verifies all five methods and confirms
  day close by its server ID. Missing counts are not assumed zero.
- Recent closed days, expected versus counted amounts and variances remain
  visible after closing. The CSV export uses actual currency exponent and
  the Ghanaian cedi symbol (₵), not a hard-coded 100 divisor.
- Shift history is visible; cashiers see their own shifts, while management
  can inspect the whole branch per existing API permission rules.
- Actions require online verification for success. A queued or failed
  synchronization is never described as a confirmed close.
- Switching business or branch clears financial count input state.

## QA

Pure helper tests validate required day/shift IDs, midnight timezone date,
five counts, negative and missing count rejection, role gates and variance.
Report tests verify 0-, 2- and 3-decimal currencies, only closed intervals
exported and CSV formula-injection defense. UI contract tests protect the
bare current endpoint shape, permission gates and completed history.
Existing real PostgreSQL reconciliation tests already cover late offline
postings, idempotency, self-shift ownership, overlap and open-shift day-close
rejections.

## Caveats and next phase

- This repairs existing operator controls; it does not force POS sales to
  require an open shift. Business opt-in strict shift policy should follow
  compatibility and authorization tests.
- Expected cashbook movements include non-sale transactions such as
  expenses; they are not gross sales revenue or net profit.
- Late legitimate offline entries can change expected/variance amounts
  on a closed day. Original physical closing counts remain persisted.
- No cashbook balancing adjustments are posted automatically for variances.
  Authorized manager investigates shortage or surplus separately.
- Seven recent operating days and fifteen shifts are initially loaded.
  Date-range exports, shift acceptance/approval and richer summaries are
  future separate work.

## Protected staging

GitHub CI only. Shared VPS continues to serve its immutable older release
until migrations 0061-0063, independent offsite restore, historical
outbox issue 218, signed artifact promotion and rollback issue 204
are all properly verified.
