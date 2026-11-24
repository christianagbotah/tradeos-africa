# POS attendant own cash drawer — authorization and UAT

## SME user journey
Owner/manager opens business trading day in Operations. Owner assigns a
POS-only employee to a physical branch. Employee visits Sell and sees
My cash shift immediately above Standard POS / Quick Serve controls.
They enter a physical opening cash float and open their own shift.
Normal cash sales are attributed to the staff's open shift by the
existing cashbook posting and idempotent sales engine. At handover they
count the drawer, see expected vs counted, record shortage/surplus and an
optional explanation, then close only their shift. Manager closes the
business day after all shifts finish. No cashbook adjustment is silently
posted to hide shortages. No extra subscription or paid service.

## Least privilege
- POS_ATTENDANT remains limited to Sell and Sign out navigation.
  Own drawer controls are inside Sell, never the Finance workspace.
- Authenticated membership and active assigned physical branch are
  checked on every request and on offline mutation replay.
- Two new allowed mutation types: SHIFT_OPEN_CREATE / SHIFT_CLOSE_CREATE.
  A POS attendant cannot open/close operating days, create expenses,
  payment adjustments, select another staff actor or close another
  employee's shift, configure providers, sell noncash or refund.
- Opening requires an existing business day, its UUID and exactly one
  nonnegative cash float. Closing requires their own shift UUID and a
  cash count plus FOUR zero-valued noncash balances; their role never
  accepts MoMo, card, bank or other payments, so these values are zero.
- The owner and cashier roles retain their existing permissions.
- Restricted current-operations GET returns day ID/status/open timestamp
  and own shift ID/status/open timestamp/CASH balance only. It does
  NOT reveal business day tender balances or other staff cash totals.
- The days read route denies POS_ATTENDANT. The shifts history lists
  only their own shifts and cash balance, scoped to their assigned branch.
- Cash sales without a shift remain possible for backward compatibility;
  mandatory shift-before-sale must be a separately tested opt-in policy.
- The UI requires online confirmation before declaring a shift open/closed.
  Late offline cashbook entries may update expected totals and variance.

## PostgreSQL CI UAT
- Manager opens day with ₵50. Employee opens own shift with ₵10.
- Employee sells 2 x ₵15 portions, own expected drawer becomes ₵40.
- Employee counts ₵39; closing records ₵1 shortage, no automatic cash
  adjustment, audit events SHIFT_OPENED and SHIFT_CLOSED present.
- Duplicate opening mutation is idempotent.
- Forged actor, negative/unsafe counts, nonzero other tenders, missing
  methods and attempts to close business day fail authorization.
- Another employee's shift ID fails domain ownership checks.
- Owner retains business-wide five-tender operating day report.

## Platform parity and deployment
This PR adds web POS drawer interface and shared API contract. Native app
cash-only POS role remains unchanged and does NOT yet have its own shift
handover panel. Native parity needs separate implementation and tests.

Source only; do not deploy while offsite backup restore, migrations
0061-0063, historical outbox #218, signed release and rollback #204
are unresolved. Avoid heavyweight builds on shared near-capacity VPS.
