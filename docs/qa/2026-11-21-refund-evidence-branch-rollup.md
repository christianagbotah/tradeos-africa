# TradeOS Africa — branch-wide refund provider-evidence attention and reactive worklist

## Goal
The refund settlement worklist already has evidence discrepancy, awaiting-review, and provider-proof filters (PR #200). This increment adds **branch-wide, per-currency evidence counts and amounts** independent of pagination, plus the **No evidence submitted** filter for unresolved **electronic** refunds. Staff do not have to open every refund to know the volume of investigations. A claim submission or second-person review now refetches the parent worklist and its attention totals without requiring a manual browser reload.

## Semantics
- All queries are scoped by the signed-in finance role, the **exact business and active branch**, and unresolved refund status `PENDING` or `FAILED`.
- `evidenceSummaryByCurrency` contains four categories; each refund appears **at most once per category**, regardless of number of submitted evidence claims. Amounts use the **original refund liability in integer minor units**, never merchant-reported amounts. Separate original currency groups are never added together.
  - `missing`: unresolved electronic refunds (`MOMO`, `CARD`, `BANK` or an electronically linked `ORIGINAL_METHOD`) with **no** evidence claims. Unresolved cash refunds are **not** classified as needing provider evidence.
  - `awaitingReview`: one or more evidence claims lack a second-person review.
  - `discrepancy`: one or more claims disagree on amount/currency, or received a discrepancy review.
  - `needsProvider`: evidence was submitted and reviewed with no outstanding review or discrepancy; **authenticated payout is still NOT established**.
- The `awaitingReview` and `discrepancy` categories can overlap. These figures are attention **subsets of outstanding refund liabilities**, not extra debts or amounts to sum.
- The new `EVIDENCE_MISSING` filter uses the same electronic method and original-payment eligibility, independent of page size.
- The frontend validates safe integers, ISO currency codes, the exact known currencies and individual upper bounds against unresolved liability balances. Incomplete/old responses show **unavailable**, not zero.
- Successful merchant evidence submission or independent review calls `onRecorded` → `onEvidenceRecorded` → settlement worklist `refetch`, refreshing amounts/filters/badges immediately while keeping failed writes unchanged. No provider calls or financial status writes.

## Verification and gate
1. Create disposable PostgreSQL QA database, apply all 60 migration files; do not reset staging or another project's data.
2. Integration coverage: complete branch rollups even with `limit=1` and offsets, separate GHS/USD groups, 2 original electronic refunds vs cash exclusion, amount/currency mismatch, overlap with unreviewed, category evolution after second-person review, cross-branch denial, unauthorized 401/403, no change in refund status.
3. Strict API/web/desktop TypeScript, original refund regression suites, frontend contracts and money precision tests.
4. Full GitHub CI, Linux Tauri native build, authenticated visual QA, then squash merge and protected staging marker deployment. Verify exact release SHA, HTTP 200 health/returns and 401 for unauthenticated worklist, preserve rollback releases.
