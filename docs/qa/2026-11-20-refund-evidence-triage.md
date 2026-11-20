# TradeOS Africa — Refund provider-evidence triage in settlement worklist

Read-only branch-scoped evidence filters were added to the existing unresolved refund settlement worklist after the independently audited merchant-supplied evidence workflow (PR #199).

- **Evidence to review**: one or more merchant-submitted evidence claims have not been reviewed by a second authorized team member.
- **Evidence discrepancies**: a provider-reported amount or currency differs from the actual refund liability, or an independent reviewer recorded a discrepancy.
- **Provider proof needed**: one or more claims exist, all have second-person reviews, and none contains a recorded discrepancy. This categorization is **NOT payout verification**. Original and submitted provider documents remain merchant-supplied, unverified claims.
- Each worklist item includes numeric counts and explicit providerFinality=NOT_ESTABLISHED. No provider reference, masked recipient fragment, free-form evidence note, or secret is exposed in the condensed worklist.
- The existing currency-grouped liability totals remain unchanged and independent of filtering, pagination and claim duplication. Filters never change refund status, payout, ledger or provider finality.
- The API uses the exact tenant and branch, unresolved PENDING/FAILED refund status and per-refund indexed evidence subquery. The existing finance-role authorization remains required.

Test with a fresh disposable PostgreSQL 18 database, 60 committed migrations, backend integration tests covering mismatched amount/currency, nonmatching branch, reviewers, all three filters and unchanged liability; frontend contract plus existing refund tests. Require GitHub CI, desktop-native build, Visual QA, then protected staging deployment.
