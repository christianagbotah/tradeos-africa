# Dedicated shop attendant profile: POS-only, cash-only pilot

A waakye stall, salon, barber or hardware attendant should only see the
selling surface. Owners/admins create a staff account with POS_ATTENDANT,
invite as usual and can revoke it. This is a NEW role; existing CASHIER
memberships and their permissions remain unchanged.

## Source implementation and expected UAT

- Migration 0062 expands three role constraints for staff, invitations and
  memberships. Until the protected release applies that migration the new
  role cannot work on the served TradeOS website.
- Web navigation shows Sell and Sign out. Direct attempts to browse other
  workspace pages show an access-denied view, not the page module.
- Native mobile shows cash tender only; stale noncash tender is reset.
- Role is selected from authenticated database membership on each sync.
  POS_ATTENDANT can push SALE_CREATE only, cash only. Customer account,
  credit, payment splitting, gateway checkout and discount approval IDs
  are explicitly rejected before writing financial events.
- Catalog list and retail sale prices are readable; catalog edit is denied.
  POS stock read returns item id, SKU, name, stock-unit and available
  quantity, not inventory cost, COGS, damage, quarantine or valuation.
- Never treat queued offline capture as a server-confirmed sale. The
  existing backend retains final authority for pricing, tax, stock, sale
  posting, idempotency and reconciliation.
- Existing cashier/owner navigation, tender choices and role rights are
  unchanged. Owner/manager retain refund and end-of-day supervision.

## Deliberate limitations

POS_ATTENDANT is CASH ONLY in this initial, financially conservative version.
Existing CASHIER is still available for MoMo, credit, refunds and other
supervised financial workflows. Extend attendant tenders separately after
provider, transaction and refund authorization tests.

The existing TradeOS business membership grants role within the whole
business, not per physical branch. The initial attendant may still be
able to switch active branches under that business. **DO NOT** advertise
this role as branch-restricted; do not deploy it for businesses that require
branch isolation until staff-to-branch authorization is implemented on both
frontend and API (sync, catalog, inventory and context switching).

## Protected release

Source only. All tests and packaging on GitHub-hosted runners, not the VPS.
Do not apply 0062, change the running release or backfill accounts until
offsite independent restore, pending 0061 migration, historical outbox
reconciliation, signed deployable artifact and rollback gates (#204/#218)
are closed. The online staging app remains on its earlier release.
