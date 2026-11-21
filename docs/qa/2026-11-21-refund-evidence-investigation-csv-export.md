# TradeOS Africa — Finance-only refund investigation CSV export

## Scope
Adds an authenticated download from **Returns → Refund settlement worklist → Export CSV**.
The report exports **all matching unresolved refunds for the current branch**, not just
the visible page. It uses the same statuses as the live worklist: all unresolved,
pending, failed, overdue 24h/7d, mismatches, unreviewed evidence, reviewed-but-still
unverified provider claims, and no evidence submitted. A second selector narrows
the report to one ISO currency without combining currencies.

A row represents **one refund liability**, regardless of how many claims were attached.
Included fields: immutable refund and original sale IDs, UTC date, status, method,
original ISO currency, **exact amount in minor units**, optional customer name,
return reason, counts of claims/unreviewed/discrepant claims, an evidence priority,
latest merchant-claimed provider/reference/status, and latest staff review decision.

**Trust boundary:** All merchant-supplied evidence remains
`MERCHANT_SUPPLIED_UNVERIFIED`; every row has `NOT_ESTABLISHED` provider
finality and `FALSE` can-mark-paid. CSV export cannot change refund,
ledger, customer credit, stock, original payment, refund provider status or
accounting balances. No online provider calls or live refund submissions.

## Confidentiality, safety and limits
- Server authenticates the caller and restricts access to active OWNER, ADMIN,
  MANAGER or ACCOUNTANT of the requested business, with an **active branch
  belonging to that business**. Cashiers, unauthorized members and anonymous
  users are denied. No cross-tenant or cross-branch retrieval.
- URL is an authenticated GET with no-store caching, `nosniff`, and a fixed
  sanitized download filename; there are no public CSV URLs.
- Contains a customer name where known; treat the downloaded report as a
  **confidential finance document**. No customer phone/email, full recipient
  destination, last-four destination identifier, free-form notes or API secrets
  are included. Uploaded receipts themselves are not exported.
- CSV text is quoted, with quotes escaped, control/newline characters removed
  and spreadsheet formula prefixes (equal/plus/minus/at sign) defanged.
  UTF-8 BOM allows proper Ghanaian names in common spreadsheet applications.
- The export has an explicit **5,000-row maximum**. If a filter would match more,
  it returns HTTP 413 with instructions to narrow by filter or currency;
  it **never quietly truncates or mislabels a partial file as complete**.
- Currency amounts stay in exact integer **minor units**; users can interpret
  them using the currency code and its ISO fraction digits. No floating-point
  summing of multiple currencies.
- Server logs only the actor's user ID, tenant/branch scope, status/currency
  filter and row count for operational audit — no customer names or references.
- The download button is disabled offline; reports are neither cached locally
  by the TradeOS offline queue nor silently replayed later.

## Verification
- Isolated PostgreSQL 18 database with all **60 schema migrations**, destroyed
  after integration tests. Never truncate live/staging business records.
- API unit tests for CSV formula injection, quotes, newline removal, UTF-8,
  output finality, 5,000-row refusal, exact amount precision and classification.
- API integration checks for route access, business/branch isolation, original
  currency filtering, each triage state, no completed refunds, no recipient
  details, header/no-store/download behavior, and preserved refund status.
- Web contract for authenticated offline-safe download, same active filter,
  no direct public links and no provider settlement claims.
- API/web typechecks; existing refunds, Hubtel original-order and Tauri
  desktop-native regressions; GitHub CI, visual QA, protected staging deploy;
  verify 200/401 and release commit before declaring deployed.
