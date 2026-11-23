# Quick Serve: 22-customer queue regression and device demo

## Verified behaviour to preserve

The menu uses actual catalog sale units. One example order is Waakye
standard ₵10, Gari ₵2, Fish large ₵20 and Egg ₵8, total ₵40.
The source rehearsal models 22 separate customer baskets with other prices
and repeated quantities. It builds source-format SALE_CREATE payloads and
unique clientMutationIds, simulating a replay with the same transaction ID.

Web checkout may clear the Quick Serve cart only after server APPLIED and
COMPLETED or after the device reports durable local offline capture. Offline
capture is explicitly pending sync, not final server reconciliation.
RECEIVED, REJECTED, AWAITING_PAYMENT, unknown results and failed local
persistence MUST NOT auto-clear the draft.

## Mobile CSS finding

A real mobile Chromium practice rehearsal found a layout obstruction:
the desktop rule for the order pane sets top:14px; when mobile switched
its position to fixed and added bottom:0, the top remained active and
stretched the entire pane, hiding food buttons. Set top:auto in the
mobile fixed-order rule. The standalone demo received the same fix.
Verified at 390x844 using actual Playwright clicks.

## Limitations

These unit tests and the separate browser demo neither authenticate a real
cashier nor send real cash, MoMo, stock, sale or accounting transactions.
The demonstration is labelled TRAINING DEMO and contains no live endpoints
or sensitive data. It is a UX rehearsal, NOT an approved financial release.

GitHub source readiness is distinct from VPS deployment. Keep the serving
release unchanged until independent offsite restore, financial and outbox
cutover gates, signed artifact promotion, canary and rollback are ready.
See issues #204 and #218.
