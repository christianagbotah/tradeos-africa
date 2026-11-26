# Supplier purchase orders — manual WhatsApp share

## Feature
Managers/owners/admins viewing an **issued** supplier purchase order can prepare a WhatsApp compose action for the **supplier's current, active phone number** and download an A4 PDF of the same immutable purchase-order values.

- Email address is **not required** for manual WhatsApp sharing.
- The contact number is read from the current supplier record, scoped to the authenticated tenant and current issued purchase order.
- Supports Ghana 02x/05x local mobile formats or explicit E.164 international numbers; rejects ambiguous bare international digits, multiple numbers and header-injection content.
- Contact, order details, and message are checked server-side; the user sees an explicit browser confirmation before opening an externally hosted WhatsApp compose window.
- The prefilled message contains PO number, merchant/branch, total, expected delivery date and instructions to attach the separate PDF.
- **No automatic WhatsApp send is made.** Clicking to open WhatsApp is not an accepted, sent, delivered or read event. Do not add these attempts to the SMTP outbox or financial ledgers.
- The PDF can be downloaded even if the supplier lacks an email or WhatsApp number, provided the PO remains issued and the user is authorized.
- Offline actions require reconnection to refresh supplier contact and PO state; no stale phone number is synced or queued.

## Routes and safeguards
- GET /v1/purchase-orders/:orderId/manual-whatsapp?businessId=...: current active supplier, issued PO, tenant and manager authorization, short manual message, never cache.
- GET /v1/purchase-orders/:orderId/manual-share-pdf?businessId=...: issued PO, tenant and manager authorization; exact PDF generated from stored PO snapshots, never mutable catalog price or supplier name.
- Missing/invalid phone is a typed 409, not a guessed number.
- Inactive supplier or cancelled PO cannot open a new manual WhatsApp composition.
- No webhook, Hubtel funds flow, automated WhatsApp provider charge, or delivery claim introduced.

## Release evidence
- Unit tests for number normalization and message accuracy.
- API integration tests for email-independent use, auth, tenant isolation, inactive suppliers, cancelled orders, PDF format and no accounting/outbox mutation.
- Web contract tests for explicit confirmation, managed-role action, safe external link and manual PDF download.
- Full CI, visual QA and real-device UAT required before claiming live completion.
