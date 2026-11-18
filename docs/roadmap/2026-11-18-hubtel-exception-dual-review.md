# Hubtel settlement exception — dual-control investigation handoff

Date: 18 November 2026. Scope: owner-approved follow-up for already observed independent Hubtel refund/status exceptions. This milestone does not transfer money, reverse stock, modify original payment state or automatically issue an accounting journal.

### Roles and business process

Business OWNER/ADMIN/MANAGER/ACCOUNTANT can view branch-scoped post-settlement exceptions and submit an investigation recommendation with an external provider support case/document reference plus a narrative evidence note (20-700 characters). The proposed action is either:
- PROVIDER_INVESTIGATION: raise or continue an external Hubtel support case.
- ACCOUNTING_REVIEW: ask the accounting team to investigate a potential manual reconciliation.

A different OWNER or ADMIN independently approves the recommendation or returns it for additional evidence. The submitter cannot approve their own submission, even when they are an OWNER. The UI hides own approval, the route rejects it, and PostgreSQL disallows same-user approvals.

Returned proposals can be resubmitted using optimistic revision control. Approved records are frozen; all submit, return and approve events are append-only and attributed to individual users in both the event log and audit events. The evidence is an opaque external reference, never a credential or a raw payment callback.

### Database and security

Migration 0051 adds tenant-scoped hubtel_pos_exception_review_cases and immutable hubtel_pos_exception_review_events. Cases have one-to-one ownership of an independently verified post-settlement exception (migration 0050), revisioned updates, independent approval and a restricted status machine. Application endpoints:

- GET /v1/payments/hubtel/exception-cases?businessId=...
- POST /v1/payments/hubtel/exception-cases/:exceptionId/submit
- POST /v1/payments/hubtel/exception-cases/:exceptionId/decide

Response is private no-store. GET/submit require an active OWNER/ADMIN/MANAGER/ACCOUNTANT business membership; decide requires active OWNER/ADMIN and a different authenticated user. Cross-tenant access, stale revisions and replayed decisions are rejected.

### Explicit financial limitations

APPROVED_ACCOUNTING_REVIEW and APPROVED_PROVIDER_INVESTIGATION are administrative investigation handoffs, not an authorization to debit the merchant or make a refund. They do not automatically alter payment, cashbook, tax, stock, sale completion or customer credit. No Hubtel refund endpoint is called.

According to Hubtel's November 2026 refund guide, full-order refunds apply only to eligible MoMo orders under the 45-day window, above the ₵1 minimum. Provider refund acceptance is asynchronous, not a final result. Financial reversal and provider refund requests must be separately authorized, bound to a unique original order and independently checked before any ledger write.

Sources:
- https://code.hubtel.com/docs/guides/refunds
- https://code.hubtel.com/docs/guides/reconciliation

### Launch gating

CI PostgreSQL migrations and multiuser integration tests must pass, along with TypeScript compilation, Linux native build, and authenticated visual QA. Protected staging release is permitted only while merchant live POS flags and callback capture remain off. Actual merchant-owned Hubtel sandbox callback, status, refund response evidence, IP allowlisting and beneficiary ownership remain separate go-live gates.
