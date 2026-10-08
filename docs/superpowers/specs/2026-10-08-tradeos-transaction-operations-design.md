# TradeOS Transaction Operations Design

## Goal
Make Sales, Returns/Refunds, Purchases and Inventory feel like one professional TradeOS operating system while preserving accounting history. Posted transactions are never edited or deleted; corrections are represented by return, refund, recovery, exchange or inventory-adjustment events with actor, reason and audit evidence.

## Product rules
- Posted sales and purchases are immutable business evidence. Users inspect them and create linked correction events.
- Every action is permission-aware in both UI and API. VIEWER remains read-only.
- Financial, tax, stock, COGS, valuation, receivable/payable and cash effects remain server-authoritative.
- Offline-capable mutations are durably queued and idempotent. Rejections remain visible for review.
- Mobile controls are at least 48px; normal text is 15–16px; no prompt/alert based transaction management.
- Search, filters and primary actions share one command row on desktop and become touch-safe stacked controls on narrow screens.

## Sales workspace
Sales is a receipt/history workspace, not an editor. It provides search, status/payment/customer filters, readable receipt rows, a detail sheet, payment/refund state, customer context, cashier, line snapshots and links into correction workflows. A posted sale cannot be renamed, repriced, have quantities changed, or be deleted.

## Returns and refunds
The existing server-backed return engine remains authoritative. The obsolete static demo ReturnsPanel is retired. Return/refund UX starts from a real sale, exposes remaining returnable quantity, return disposition, refund destination, reason and expected accounting/stock effect before submission. Pending provider refunds remain visibly processing rather than being shown as completed.

## Exchanges
Exchange is a first-class correction transaction, never an edit of the original sale. It atomically records the returned quantity/disposition, replacement sale lines, price difference and settlement/refund of that difference. The original sale and replacement sale remain independently auditable and are linked by one exchange case/correlation ID. Walk-in exchanges are supported; named customer credit is optional, not required.

## Purchases
Purchase receiving becomes a professional builder with supplier context, invoice/reference, payment method/account, editable draft lines, unit/cost/quantity controls, running total and stock conversion preview. Posted purchases are read-only. Corrections use purchase return/recovery only.

## Inventory operations
Inventory balances are derived from movements. Users never type over an on-hand balance. New inventory adjustment workflow supports stock count correction and location reclassification among AVAILABLE, QUARANTINE, DAMAGED and WASTE with required reason, actor, idempotency and valuation-safe movement entries. Negative stock is rejected unless the operation is an explicitly supported reconciliation that can prove sufficient source quantity.

## UX architecture
Split the current large transaction coordinators into focused business components: list/workspace, detail sheet, correction sheet and draft builder. Reuse TradeOS tokens, Button primitives, lifecycle/confirmation patterns and offline queue status. Do not create a generic ERP CRUD renderer.

## Acceptance
All new behavior is TDD. Every slice passes typecheck, lint, whitespace, full tests, production build and authenticated sync smoke. Responsive source/CSS contracts cover 360/390/768/1440 behavior; browser-based visual UAT is performed when a browser engine is available and otherwise explicitly remains a staging UAT item.
