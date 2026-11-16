# TradeOS Africa — auditable transactional document email, phase 1
16 November 2026 · TradeOS issue #143

## Business outcome
Merchant owners, administrators and managers can prepare and send
**issued supplier purchase orders** and **issued quotations/proformas**
using authenticated TradeOS screens. A user must explicitly verify the
recipient address. If it differs from the recorded supplier/customer
contact, the manager must provide a reason of at least 12 characters.

The server reloads the source document from tenant-scoped tables, takes its
real document number, item quantities, item line amounts and total, and
constructs an itemized plain-text email with a link to the authenticated
document page. No untrusted client-provided prices, stock details or sender
identities are accepted. This email is **NOT an attached PDF**. A recipient
who is not a TradeOS user can read the itemized summary in the email, but
cannot open the authentication-protected document link without an account.
This is an interim delivery format, not an external supplier portal.

## Activation (off by default)
This is a **separate feature gate** from password recovery email and from
Hubtel merchant POS. The platform administrator must first verify:
- Authorized sender mailbox/domain and actual SMTP/Exim routing.
- Domain DNS SPF, DKIM and DMARC alignment with the outgoing MTA.
- Confirmation of a real, controlled inbox and appropriate bounce handling.
- That tenant/business communications use the platform sender, not an
  impersonated merchant address. No tenant sender spoofing or unverified
  Reply-To is supported.

Only after verification, configure the **API service environment**:
```sh
TRADEOS_DOCUMENT_EMAIL_ENABLED=true
TRADEOS_DOCUMENT_EMAIL_VERIFIED=true
TRADEOS_DOCUMENT_EMAIL_FROM=verified-sender@example.com
# Optional if not the server's default /usr/sbin/sendmail:
TRADEOS_SENDMAIL_PATH=/usr/sbin/sendmail
```
Never commit credentials, recipient addresses or test delivery tokens to Git.
Do not infer that mail is configured merely because Exim exists on the VPS.
Default is disabled. Sending is rejected with a visible 409 until enabled.

## API/DB contract
Migration `0038_document_delivery_outbox.sql` adds tenant-scoped
`document_deliveries` and `document_delivery_attempts` tables,
business-scoped idempotency keys and request fingerprints, and a bounded
review queue. This is separate from generic application `outbox_events`.

Routes (JWT + business membership, owner/admin/manager for writes):
- GET `/v1/document-deliveries/readiness?businessId=...`
- GET `/v1/document-deliveries?businessId=...&documentKind=...&documentId=...`
- POST `/v1/document-deliveries` prepares an EMAIL request, checking issued
  status, recipient consent, manager override reason, idempotency.
- POST `/v1/document-deliveries/:deliveryId/send` sends a previously
  prepared itemized summary after a second merchant confirmation.

Statuses: QUEUED (prepared, not sent), SENDING (recorded before invoking
the mailer), ACCEPTED (local mail transport exit code 0 — inbox **not**
verified), REVIEW_REQUIRED (uncertain provider result — cannot automatically
retry) and FAILED (reserved for future provably-unsent failures).
Attempts and audit events record accepted/uncertain results and initiator.
No user-visible DELIVERED state is asserted without provider proof.
Hourly rates are capped at 20 preparations and 20 send attempts per business.

Sending is **synchronous on explicit merchant action** in this tranche;
the durable ledger survives process crashes. If a process dies after
persisting SENDING, the record stays in that state requiring an operator
to reconcile. This is intentional at-most-once behavior to avoid duplicate
customer/supplier messages after a provider timeout. A later dispatch
worker or provider-callback integration must preserve these guarantees.

## Merchant UAT
1. Create a PO with a supplier email; issue it (DRAFT must not be sendable).
2. Open PO preview, scroll below the printable order to Email this document.
3. Review the saved recipient address, tick explicit confirmation and
   prepare the message. Confirm status: Prepared, not sent.
4. If email service is disabled, Send email is disabled with an explanation.
5. After verifying server configuration in an approved environment,
   click Send email and confirm the address again. Status becomes
   Accepted by mail server, not Delivered.
6. Repeat the same send: no duplicate provider submission.
7. Test timeout/uncertain MTA response: REVIEW_REQUIRED; further send
   attempts blocked rather than automatically resubmitted.
8. Edit recipient email; enter a sufficient reason. A missing reason must
   be rejected. Attempt malformed address/header newlines: rejected.
9. As another tenant, attempt list/read/dispatch: no access to documents.
10. Cancel an issued quotation after preparing delivery; sending rejected.
11. Confirm document amounts and line items never change from email
    preparation or dispatch and no stock, cashbook, payable, tax or
    customer balance is posted by the communication workflow.
12. Check the document's print view still works: delivery controls are
    excluded from paper and PDF output.

## Deliberate next phases
- Private server-generated PDF attachment or a recipient-accessible,
  expiring, purpose-scoped document download token, with malware/retention
  controls as needed.
- Per-business verified sender identity, opt-in contact preferences,
  bounce and callback reconciliation, queue worker and provider statuses.
- WhatsApp business template approval, recorded consent, sender credentials
  and signed delivery callbacks. WhatsApp currently always disabled.
- Customer sales receipt delivery (requires verified customer email and
  completed/partially refunded/refunded status handling).
- Provider-facing monitoring to reconcile SENDING/REVIEW_REQUIRED without
  exposing the underlying tenant document.
