# TradeOS Africa — Supplier purchase order email delivery
16 November 2026 · Release #143 continuation

## Scope

This release adds an audited, sender-gated, tenant-specific **issued supplier
purchase order email** workflow. It is a plain-text supplier purchase-order
summary constructed *on the API server* from immutable issued PO data: supplier,
business, numbered order, purchased items, quantities, prices and total.
It is **not** a PDF email attachment, proof of inventory receipt, payment
confirmation, or guaranteed inbox delivery. A merchant can still use the
separate Print / Save as PDF action in the Purchase Order preview.

The prior invoice-matching/evidence system remains unchanged. Private supplier
invoice files are **not** sent via public URLs and cannot be attached to an
email until a separately vetted private-attachment sender is implemented.

## Merchant procedure

1. Enter supplier email in **Suppliers** before creating the PO, or update the
   supplier's active email record as required.
2. Create and ISSUE the PO (draft/cancelled POs cannot be sent).
3. Open its preview. Find **Email purchase order** under the print document.
4. Choose **Prepare email for review**. Only the exact active supplier email
   address is allowed; arbitrary recipients/forged addresses are rejected.
   The server stores the exact immutable subject and message body and does
   not send anything yet.
5. Review full email text and verify the recipient is correct. Check the two
   explicit confirmation boxes (recipient verified, supplier expects message).
6. Only OWNER, ADMIN or MANAGER can **Authorize email send**. If the verified
   SMTP account is not configured, the action stays disabled and the API
   returns a service-unavailable result. No silent sending.
7. After authorizing, the worker queues and sends with a bounded, business-
   scoped transaction. Status transitions:
      PREPARED → QUEUED → SENDING → ACCEPTED
                                   ↘ REVIEW_REQUIRED
      PREPARED/QUEUED → CANCELLED
8. **ACCEPTED** means the SMTP provider accepted this recipient. It does
   **not** mean delivered/read; do not label as DELIVERED without verified
   provider delivery events.
9. On an uncertain result, do NOT auto-resend. Ask the supplier whether the
   message arrived, check **I checked with the supplier and confirmed
   non-receipt**, then a manager can authorize another attempt; maximum
   three total attempts. Crashed/expired attempts are also reviewed rather
   than retried. Pending queue expires its 24-hour confirmation window.
10. Manual copy for WhatsApp is allowed, clearly labelled **manual sharing**;
    TradeOS does not record it as provider-sent or delivered.

## Production SMTP configuration (operator only; no secrets in Git)

New environment keys for the API service:
- `TRADEOS_DOC_DELIVERY_ENABLED`: set `true` only after end-to-end testing;
  **unset / false by default**.
- `TRADEOS_DOC_SMTP_VERIFIED`: set `true` only when platform sender domain
  and mail account are confirmed and verified.
- `TRADEOS_DOC_SMTP_HOST`: provider SMTP hostname.
- `TRADEOS_DOC_SMTP_PORT`: 587 for STARTTLS (or 465 for implicit TLS).
- `TRADEOS_DOC_SMTP_USER` and `TRADEOS_DOC_SMTP_PASS`: SMTP credentials from
  the secrets manager, never from a browser, no Git commit, no log output.
- `TRADEOS_DOC_SMTP_FROM`: the platform's **verified** transactional email
  address, e.g. a verified no-reply@... sender on the provider.
- `TRADEOS_DOC_SMTP_FROM_NAME`: optional sender display name.

The provider uses TLS 1.2+, server certificate validation and authenticated
SMTP. For port 587, STARTTLS is required. Operator should first confirm SPF,
DKIM, DMARC, MX setup and provider allowlist; recipient opt-in/transaction
expectations; sender domain; provider throttling, bounce and suppression
mechanism. Verify return-path/deliverability using deliberately authorized
sandbox recipients (not real suppliers) before flipping the flag.

The scheduler only starts when **enabled, verified and all SMTP secrets** are
present. The merchant UI shows readiness; it cannot submit raw SMTP host/user/
pass or change its sender. The platform sender is fixed; emails explicitly
state they are sent on behalf of the merchant. A supplier's email must match
their active TradeOS supplier record on both preparation and authorization.

Use separate staging and production mail accounts. SMTP accepted callbacks
alone cannot prove delivery. Implement DSN/bounce processing or a verified
transactional provider webhook before introducing DELIVERED statuses.

## Critical technical constraints

- `0038_supplier_document_delivery_outbox.sql`: stores typed, tenant-scoped
  outbox rows + distinct durable attempt rows + database scope trigger.
- Idempotent request ID and SHA256 request fingerprint, replay-safe.
- Purchase-order row lock serializes draft creation and daily limit; email
  body derives from the authoritative PO snapshots and is not browser-authored.
- Email transport is Nodemailer SMTP, secure STARTTLS/TLS; no remote URLs or
  attachment file access.
- Worker claims with `FOR UPDATE SKIP LOCKED` and marks attempts SENDING
  *before* calling SMTP; uncertain outcomes remain REVIEW_REQUIRED.
- Stale jobs, supplier contact changes, cancelled PO or queued requests
  older than 24 hours do NOT go to SMTP.
- Queue cancellation is safe before the SMTP hand-off; cancel after
  provider hand-off is prohibited.
- Up to 10 new PO deliveries per 24 hours per order; at most 3 send attempts.
- Business access is required to preview, prepare or read history; only
  OWNER/ADMIN/MANAGER may authorize/cancel/retry.
- Raw SMTP errors, passwords, full message bodies and recipient contents
  must not be written to provider-error columns or application logs.
- The outbox never mutates inventory, payables, cashbook, supplier payments
  or Hubtel provider state.

## UAT / automated verification

Run the integration suite on an isolated PostgreSQL database (never production),
app/web typechecks, frontend contract tests, full GitHub CI, authenticated
Visual QA, desktop-native build, and staging health checks.

Test coverage:
- PREPARED entries persist while email is disabled; auth fails closed.
- Only ISSUED POs, a saved active supplier email and matching business are
  eligible; no arbitrary email injection, no cross-tenant read.
- Auth + explicit confirmation; prepared→queued; request ID replay and
  altered-payload conflicts.
- Fake SMTP sender accepted → ACCEPTED (not delivered), one attempt only.
- Fake ambiguous failure → REVIEW_REQUIRED; no automatic retry; explicit
  manager non-receipt attestation → second attempt.
- Queued message cancelled without sending; changed supplier contact
  blocked; no inventory, cashbook or AP posting.

## Deliberate exclusions / next phase

No automatic WhatsApp API sends or email PDF attachments in this release:
Meta WhatsApp Business account/template approval and private-attachment
delivery require a separate consented provider integration and hardened
object links. No provider email delivery confirmation, bounce handling,
signed PDF email attachment, mobile OS share-sheet certification, marketing
broadcasts or bulk campaigns yet. Track in #143.

Hubtel merchant POS remains OFF pending provider authorization and
stock/valuation finality (#134).
