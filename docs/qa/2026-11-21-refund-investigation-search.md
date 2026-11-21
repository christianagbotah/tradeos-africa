# TradeOS Africa — branch-wide refund investigation search

## Finance workflow

1. Open **Returns → Refund settlement worklist** as OWNER, ADMIN, MANAGER or ACCOUNTANT.
2. Search by full or partial **refund ID, original receipt/sale ID, customer name, provider refund reference** or merchant-submitted provider claim reference. Press Enter or Search.
3. Search applies server-side to every unresolved refund in the authenticated business and active branch, not only the visible ten records. Status/evidence filters and pagination continue to work; changing filters starts from page one. Clear search to restore the normal list.
4. **Export CSV** uses the same committed search and selected evidence/status/currency filter. It still refuses more than 5,000 matching rows; never silently truncates.
5. Branch-wide payout and provider-evidence summary balances remain unfiltered. The displayed note explains this distinction; searches cannot alter or settle liabilities.

## Security and accounting boundaries

- Authenticate on every request; verify finance role, tenant and active branch before searching.
- Search is limited to 100 characters and rejects control characters. `%`, `_` and `!` are escaped literally in PostgreSQL `ILIKE` rather than granting wildcard access. SQL binds all search inputs as parameters.
- Merchant-submitted provider references are searchable only inside the same business/branch/refund. Searches never disclose another branch's or tenant's records.
- No customer phone/email/address or provider destination is used for search. The CSV remains confidential and omits sensitive payout details.
- Both endpoints are read-only and use no-store semantics. No callbacks, provider API calls, refund disbursements, or mark-paid actions are triggered. Evidence remains **MERCHANT_SUPPLIED_UNVERIFIED** with **NOT_ESTABLISHED** provider finality.

## Acceptance / rollout

- Unit tests: input normalization, Unicode names, control/length checks, literal wildcard escaping.
- API integration tests in a **disposable isolated test database only**: ID, sale ID and provider-reference matches; pagination-independent results; wildcard and branch isolation; invalid query rejection; untouched refund liability.
- Web contract tests: accessible search field, committed query, branch-scoped URL, aligned CSV export, clear search, pagination reset.
- Verify API/web typecheck, existing refund and Hubtel regressions, repository CI, desktop native build and Visual QA. Merge to protected main only after green checks; deploy with the existing protected staging runner, confirm active SHA, HTTP 200/401 and rollback snapshot.
