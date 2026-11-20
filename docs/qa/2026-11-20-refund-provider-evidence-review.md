# TradeOS Africa — Merchant-supplied refund-provider evidence and two-person review

## Scope and trust model
Staff can submit **claims** from external payout provider receipts, merchant dashboards, or support cases against one unresolved **electronic** refund. Claims contain the provider, reference, minor-unit amount, original currency, masked recipient destination (final 4 characters ONLY), provider-reported status, case reference, note and optional report timestamp. The claim source is **MERCHANT_SUPPLIED_UNVERIFIED**, never an authenticated API response.

A *different* active finance/management member can record exactly one immutable review, classifying the claim as **FIELDS_MATCHED_UNVERIFIED**, **DISCREPANCY_RECORDED**, or **PROVIDER_CONFIRMATION_NEEDED**. An amount/currency mismatch cannot be labelled fields-matched. Neither a submission nor a second-person review proves payout; both are pre-provider investigation records only.

## Compliance and safety
- Migration 0060 creates append-only `refund_provider_evidence_claims` and `refund_provider_evidence_reviews`; independent DB triggers validate business, branch, refund linkage, active authorized membership, unresolved status, electronic refund method, and two different users. Update/delete always fails.
- Partial refunds and non-GHS/multi-currency refunds retain their exact original currency, without mixing currency balances. Claimed amount/currency mismatches remain visible and can only be classified as discrepancy or provider confirmation needed.
- Duplicate provider refs are rejected within the same business and provider, including case-insensitive reference variants. Client UUIDs give idempotent exact replay; changed replay gets 409.
- Only last-four destination characters are accepted. Never record full phone/card/account numbers, credentials, document URLs, or images in these fields. No provider API calls, webhook trust claims, email/SMS dispatches, wallet/ledger writes, refund status updates, or automatic finalization.
- The database constrains `provider_authenticated=false` and `payout_finality_established=false` on **every** claim and review. The API and UI return `providerFinality=NOT_ESTABLISHED` and `canMarkPaid=false` throughout.
- Endpoints: authenticated finance-role GET/POST `/v1/refunds/provider-evidence` and POST `/v1/refunds/provider-evidence-review`. Branch scoping and no-store cache; worklist UI under each refund's **Reconciliation checks**. Online-only writes. No background offline queue.
- A second person marking the *fields* as matched is not authorized to finalize a refund. Real settlement will require separately authenticated provider-issued refund ID, exact settlement amount and currency, timestamp, and recipient destination.

## Verification and deployment gate
- Apply all **60 migrations** to a disposable PostgreSQL 18 QA database; never use staging financial data in integration tests.
- API integration: exact retries, unique references, cross-branch and cashier denial, inactive/outsider checks, malformed URL/amount/reference/currency, self-review denial, second-person audit, mismatch rejection, closed and cash-refund refusal, immutable triggers, and unchanged refund liability.
- Web contract: input formatting (ISO currency-specific minor units; no floating money arithmetic), masked destination, fail-closed response semantics, online only, role-aware reviewer UI.
- Regression: original-order Hubtel observations, refund reconciliation preflight, follow-ups and currency-isolated summary.
- Run API/web typechecks and packages builds; GitHub full CI including Ubuntu desktop-native build and authenticated Visual QA. Squash merge; protected staging deploy with exact SHA, read-only schema/guard verification and 200/401 checks. Preserve previous release for rollback.
