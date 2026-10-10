# TradeOS Returns / Refunds / Exchanges QA — 2026-10-10

Branch: `feat/returns-refunds-exchanges-ux`
Base: `fc3d70398afc0dc079ac253426a21948965132e5`

## Scope

Frontend/business-flow recomposition only. Posted sales remain immutable evidence. The existing `RETURN_CREATE` and `EXCHANGE_CREATE` mutation ownership, server-authoritative pricing/accounting/stock logic, role presentation, feature caches, session-epoch guards and offline queue semantics are preserved.

### Returns evidence workspace
- Shared `CommandBar`, `StatePanel`, `MobileRecordCard` and `StatusBadge` composition.
- Original posted receipt, customer, date, cashier, sale value, refund history and status remain evidence rather than editable fields.
- Desktop rows and phone record cards are separate responsive representations.

### Return / refund correction
- Read-only original receipt block precedes correction controls.
- Return + refund, Refund only and Exchange modes remain linked corrections.
- Refund-only states that stock is unchanged.
- Product stock supports Available / Quarantine / Discard; services are stock N/A; prepared products are discard / waste.
- Reason is required and actor/reason evidence remains visible.
- Provider reversals remain truthfully described as processing until confirmed.

### Exchange
- Explicit three-stage flow: Return → Replace → Settle.
- Original receipt remains visibly read-only and linked.
- Replacement selling units remain explicit and display prices remain estimates; authoritative values are server validated.
- Customer pays / Customer receives / No difference outcome is explicit.
- Applied evidence links original receipt, replacement receipt and return correction.

### Orchestration
- A newly selected correction resets stale mode/refund-method/reason state.
- `?saleId=...&mode=exchange` opens the selected sale explicitly in Exchange mode.
- Applied Sale/Return/Refund/Exchange mutations refresh the open receipt while reconciling an in-progress draft instead of silently wiping it.

## Rendered browser evidence

Evidence directory: `docs/qa/evidence/tradeos-returns-refunds-exchanges/`.

### Authenticated live route
The built-in Owner demo account successfully authenticated against the staging API. The demo business had **zero posted sales**; both `/api/tradeos/v1/sales` requests returned HTTP 200 with an empty list. TradeOS did not create an immutable sale merely to obtain screenshots.

The live `/returns` route was captured at 360, 390, 768 and 1280 px. The browser audit reports no document-level horizontal overflow at any width.

### Sheet rendering limitation and controlled harness
Because the demo tenant contained no posted sale, live sale-backed Return/Refund and Exchange sheets could not be opened without creating permanent transaction evidence. Instead, a temporary **local-only QA route** rendered the actual production `ReturnRefundSheet` and `ExchangeSheet` components with representative fixture data. The harness made no API mutation and was deleted before verification/commit.

The real components/CSS were captured at 360, 390, 768 and 1280 px. Return/Refund also has a 390 px Refund-only capture. Exchange added one replacement item only to local component state. Audit results show zero sheet horizontal overflow and zero viewport overflow at all tested sizes.

Keyboard checks at 390 px:
- Return/Refund: Shift+Tab from the close control wrapped to `Process return / refund` inside the modal.
- Exchange: Shift+Tab from the close control wrapped to `Cancel` inside the modal.

## Console notes
The audit retains raw browser console errors for transparency. The two 401 entries are expected unauthenticated `/api/session/me` probes before login. The four 404 entries came from unrelated Dashboard credit-aging/cash-forecast requests before navigation to Returns; the Returns sales requests themselves returned HTTP 200.

## Data integrity
- No sale was posted.
- No return/refund was submitted.
- No exchange was submitted.
- No catalog/customer/payment/staging business data was created or modified.
- Temporary browser runtime and temporary QA routes were removed after capture.

## Acceptance status before PR
- Focused Returns tests: 27/27 passed before final whole-app verification.
- Focused typecheck: clean.
- 360 / 390 / 768 / 1280 rendered matrix: no horizontal overflow.
- No browser `alert`, `prompt` or `confirm` flow introduced.
- Full whole-app tests/typecheck/lint/build are required again on the exact PR tree before push.
