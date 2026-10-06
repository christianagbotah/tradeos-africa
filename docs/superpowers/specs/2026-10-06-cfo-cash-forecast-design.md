# TradeOS Africa — 30-Day CFO Cash Forecast Design

**Date:** 2026-10-06
**Branch:** `feat/cfo-cash-forecast`
**Status:** Design approved in chat; written spec pending user review before implementation.

## 1. Purpose

TradeOS needs a cash forecast that can answer a small-business owner’s practical question:

> “Based on the cash I really have, the money customers owe me, the money I owe suppliers, and the way cash normally moves through this business, will I run short of money in the next 30 days?”

The forecast must be useful to informal and formal businesses without pretending certainty that the underlying records do not support. It must be explainable, deterministic, auditable, branch-aware, timezone-aware, and derived only from authoritative TradeOS data.

This design deliberately does **not** use an LLM or ML model to produce the numeric forecast. Generative AI may later explain the forecast, but it must consume the deterministic result rather than inventing figures.

## 2. Success Criteria

The feature is successful when TradeOS can produce, for one branch or the whole business:

1. A daily 30-day projected cash path beginning with the authoritative current cash balance.
2. Known customer receivable inflows placed on their contractual due dates.
3. Known supplier payable outflows placed on their contractual due dates.
4. A conservative operating-cash baseline derived from recent actual settled cashbook behavior.
5. A clear split between **contractual** and **estimated** cash movements.
6. Confidence/coverage metadata showing how much evidence supports the forecast.
7. The first projected date on which cash becomes negative, if any.
8. No double-counting of credit sales/purchases as cash before settlement.
9. No owner injection, withdrawal, opening-balance, or manual-adjustment pollution of the operating baseline.
10. Stable behavior offline in the UI through the existing cached reporting pattern: previously fetched forecasts remain viewable, but no new forecast is fabricated while offline.

## 3. Scope

### In scope

- `GET /v1/reports/cash-forecast`
- 1–30 day horizon, default 30 days.
- Whole-business or branch-scoped forecast.
- Business-timezone daily bucketing.
- Current authoritative cash opening balance from `cashbook_entries`.
- Customer contractual obligations from `customer_credit_obligations`.
- Supplier contractual obligations from `supplier_credit_obligations`.
- Overdue obligations rolled into the first forecast day and separately identified as overdue.
- Recent historical operating cashbook behavior as the statistical baseline.
- Same-weekday median baseline when evidence is sufficient.
- Overall median fallback when weekday evidence is insufficient.
- Zero baseline where history is too sparse.
- Confidence and evidence metadata.
- First negative-cash date and lowest projected balance.
- Owner-facing web presentation within the existing CFO / financial-report area.
- Shared contract shape usable by mobile and desktop later.
- Integration tests against PostgreSQL.

### Out of scope for this slice

- Predicting future invoices/sales orders that do not yet exist.
- ML forecasting, neural networks, ARIMA/Prophet, or LLM-generated numbers.
- Automatic rescheduling based on customer payment probability.
- Bank/MoMo provider balance imports not already represented in TradeOS.
- FX forecasting.
- Scenario editing (“what if I delay supplier X?”). This can follow once the base forecast is stable.
- Automated actions, supplier payment execution, or customer collection execution.

## 4. Data Sources and Accounting Boundaries

### 4.1 Opening cash

Opening cash is the authoritative sum of `cashbook_entries.amount_delta_minor` strictly before the first forecast instant, scoped to business and optional branch.

This is the same money basis used by existing financial reporting. The forecast must not create a second cash ledger or infer cash from sales totals.

### 4.2 Contractual receivable inflows

Open customer obligations come from `customer_credit_obligations` where `open_minor > 0`.

Each obligation already snapshots:

- `issued_at`
- `due_at`
- `original_minor`
- `open_minor`
- source sale/customer/business/branch identity

The forecast schedules `open_minor` as an expected contractual inflow on `due_at`.

If `due_at` is before the forecast start, the obligation is placed on forecast day 1 and marked as **overdue**, rather than pretending the historical due date is still in the future.

### 4.3 Contractual supplier outflows

Open supplier obligations come from `supplier_credit_obligations` where `open_minor > 0`.

The same overdue rule applies: supplier obligations already past due are placed on forecast day 1 and identified separately as overdue outflow pressure.

### 4.4 Operating baseline

The operating baseline is derived from recent `cashbook_entries`, excluding non-operating capital/manual entries.

Included entry types:

- `SALE_RECEIPT`
- `CUSTOMER_PAYMENT`
- `PURCHASE_PAYMENT`
- `SUPPLIER_PAYMENT`
- `SALE_REFUND`
- `PURCHASE_RETURN_RECOVERY`
- `EXPENSE`

Excluded entry types:

- `OPENING_BALANCE`
- `OWNER_INJECTION`
- `OWNER_WITHDRAWAL`
- `ADJUSTMENT`

The baseline is computed separately for positive and negative daily operating cash so the system does not hide volatility inside a single net number.

## 5. Avoiding Double Counting

The forecast combines two layers:

1. **Contractual layer:** future open receivable/payable obligations.
2. **Behavioral layer:** historical operating cash behavior.

The historical baseline summarizes *past actual settled cash*. Contractual obligations represent *currently open future settlement expectations*. No existing open credit balance is converted directly into historical cash or counted as current cash.

The first version does not attempt to subtract the statistical probability that future baseline inflows may themselves contain future customer-credit collections. Instead, TradeOS surfaces contractual and baseline values separately and labels the baseline as an estimate. This is intentional and explainable.

If future evidence shows material systematic double counting, the next refinement should split historical baseline by source class and condition the projected baseline on open obligations. That is explicitly deferred from this slice.

## 6. Forecast Horizon and Timezone

### 6.1 Forecast start

The forecast starts at the beginning of the current business-local calendar day, converted to an instant for SQL queries.

The report uses the configured business/branch timezone already used by financial reporting.

### 6.2 Daily buckets

Generate `days` local calendar dates, default 30, maximum 30 for this first release.

Each daily point represents the half-open local-day interval:

`[local midnight, next local midnight)`

This avoids DST errors caused by assuming every business day is exactly 24 hours.

## 7. Baseline Algorithm

### 7.1 History window

Use up to the previous **56 completed local days**, excluding the current partial day.

Reasons:

- Eight weeks gives up to eight samples for each weekday.
- It remains responsive to recent business behavior.
- It avoids implying long-term seasonality that the first forecast model does not support.

### 7.2 Daily historical features

For each completed local day, compute:

- operating inflow minor
- operating outflow minor (absolute positive magnitude)
- net operating cash
- weekday (0–6)

Days with no activity are real zero observations and remain part of the series when the business had already begun operating in the window.

### 7.3 Same-weekday median

For forecast date D:

- Take historical observations with the same weekday as D.
- If at least **4 same-weekday observations** exist, use the median inflow and median outflow from those observations.

Median is preferred to mean because a single unusual supplier settlement, bulk stock purchase, event sale, or large customer collection should not dominate the forecast.

### 7.4 Overall median fallback

If fewer than 4 same-weekday observations exist but at least **14 completed historical days** exist, use the median across all available completed days.

### 7.5 Sparse-history fallback

If fewer than 14 completed historical days are available, baseline inflow and outflow are both zero.

The forecast still shows contractual obligations and current cash, but confidence is LOW and assumptions explicitly state that normal operating behavior could not yet be estimated reliably.

### 7.6 Business-start detection

The history series starts at the later of:

- forecast start minus 56 local days, or
- the business/branch’s earliest operating cashbook entry date.

This prevents dozens of artificial zero days from being inserted before a newly created business actually began using TradeOS.

## 8. Daily Calculation

For forecast day `d`:

```
openingCash[d]
+ contractualCustomerInflows[d]
- contractualSupplierOutflows[d]
+ baselineOperatingInflows[d]
- baselineOperatingOutflows[d]
= closingCash[d]
```

Then:

```
openingCash[d+1] = closingCash[d]
```

All amounts remain integer minor units. No floating-point money arithmetic is allowed.

Each daily point returns:

- `date`
- `openingCashMinor`
- `contractualInflowsMinor`
- `overdueContractualInflowsMinor`
- `contractualOutflowsMinor`
- `overdueContractualOutflowsMinor`
- `baselineInflowsMinor`
- `baselineOutflowsMinor`
- `netMovementMinor`
- `closingCashMinor`
- `customerObligationCount`
- `supplierObligationCount`
- `baselineMethod`: `WEEKDAY_MEDIAN | OVERALL_MEDIAN | NONE`

## 9. Forecast Summary

The response summary includes:

- `openingCashMinor`
- `projectedClosingCashMinor`
- `lowestProjectedCashMinor`
- `lowestProjectedCashDate`
- `firstNegativeCashDate | null`
- `totalContractualInflowsMinor`
- `totalContractualOutflowsMinor`
- `totalBaselineInflowsMinor`
- `totalBaselineOutflowsMinor`
- `overdueReceivablesMinor`
- `overduePayablesMinor`

## 10. Confidence and Evidence

The forecast must communicate evidence quality, not only numbers.

Return:

```ts
type CashForecastConfidence = {
  level: "HIGH" | "MEDIUM" | "LOW";
  historyDaysAvailable: number;
  sameWeekdayCoverageDays: number;
  openCustomerObligationCount: number;
  openSupplierObligationCount: number;
  contractualInflowsMinor: number;
  contractualOutflowsMinor: number;
  assumptions: string[];
};
```

### Suggested confidence rules

**HIGH**
- at least 42 completed history days, and
- at least 4 historical observations for every weekday appearing in the horizon.

**MEDIUM**
- at least 14 completed history days, but HIGH criteria are not met.

**LOW**
- fewer than 14 completed history days.

Contractual obligations do not by themselves upgrade baseline confidence, because they improve known cash visibility but do not improve evidence for normal operating behavior. The UI should separately show that contractual coverage exists.

## 11. API Contract

### Endpoint

`GET /v1/reports/cash-forecast`

### Query parameters

- `businessId` — required UUID
- `branchId` — optional UUID
- `days` — optional integer, defaults to 30, valid range 1–30

### Authorization

Use the existing financial-report role rules and tenant/branch isolation.

A branch-scoped request must verify:

- branch belongs to the requested business
- branch is active
- business is active
- caller has appropriate membership/role

### Response shape

```ts
type CashForecastResponse = {
  generatedAt: string;
  businessId: string;
  branchId: string | null;
  timezone: string;
  currencyCode: string;
  horizonDays: number;
  summary: CashForecastSummary;
  confidence: CashForecastConfidence;
  days: CashForecastDay[];
};
```

The types belong in `packages/contracts` so web, desktop and mobile can share them.

## 12. Web UX

Add a **30-Day Cash Forecast** section in the owner financial/CFO workspace.

### Primary summary cards

- Cash today
- Projected day-30 cash
- Lowest projected cash + date
- First projected cash shortfall, or “No projected shortfall”
- Contractual inflows
- Contractual outflows
- Confidence badge

### Daily forecast table

Columns:

- Date
- Opening cash
- Customer due
- Supplier due
- Estimated inflow
- Estimated outflow
- Closing cash

Overdue contractual amounts included in day 1 should carry an “overdue” annotation.

Negative closing cash rows should be visually emphasized using existing warning/error presentation classes, not a new unrelated design language.

### Explanation block

Display:

- confidence level
- history days used
- whether weekday or overall median was used
- concise assumptions
- explicit sentence that forecasted operating behavior is an estimate, while dated obligations come from recorded terms

### Offline behavior

Follow the existing financial-report cache pattern:

- Cache the last successful forecast per business/branch/horizon.
- When offline, show the cached forecast with its original `generatedAt` timestamp and an “offline cached” indicator.
- Never generate a fresh client-side forecast from stale fragments.

## 13. Error Handling

- Invalid UUID / days range → 400.
- Unauthorized membership → 403.
- Invalid/inactive branch → 404 or existing report security behavior.
- Numeric overflow outside supported safe-integer minor-unit range → 500 report overflow error.
- Missing history is not an error; produce a LOW-confidence contractual-only forecast.
- No obligations and no history is valid: the forecast remains flat at current cash with LOW confidence.

## 14. Performance

The endpoint should execute a bounded number of SQL queries independent of the number of forecast days.

Target query groups:

1. business/branch metadata + current cash
2. open customer obligations aggregated by local due date
3. open supplier obligations aggregated by local due date
4. historical daily cashbook aggregation for up to 56 days

Do not issue per-day or per-obligation queries.

Indexes from existing cashbook and obligation migrations should be reused. Add a new index only if `EXPLAIN`/test evidence shows a missing access path.

## 15. Security and Audit Boundaries

This feature is read-only. It must not:

- mutate cashbook records
- modify obligation due dates
- allocate payments
- post adjustments
- trigger reminders or payments

All returned amounts are derived from already authorized tenant data. The endpoint must never accept caller-supplied balances or forecast inputs that could cross tenant boundaries.

## 16. Testing Strategy

Implementation is test-first.

### Unit/domain tests

Pure forecast math tests for:

- chaining opening/closing balances
- median calculation with odd/even sample counts
- same-weekday vs overall fallback
- sparse history → zero baseline
- negative cash detection
- safe-integer overflow

### PostgreSQL integration tests

Use real migrations and authoritative ledger rows to prove:

1. Current cash opens the forecast exactly.
2. Future customer obligations appear on their contractual due dates.
3. Future supplier obligations appear as outflows on due dates.
4. Overdue receivable/payable amounts move to day 1 and remain separately reported.
5. Partial allocations reduce forecast obligations to `open_minor`, not `original_minor`.
6. Owner injections/withdrawals/opening balances/adjustments do not enter operating baseline.
7. Same-weekday median is used when at least four samples exist.
8. Overall median fallback is used with 14+ days but weak weekday coverage.
9. Fewer than 14 history days yields contractual-only baseline and LOW confidence.
10. Branch-scoped forecast excludes other branches.
11. Whole-business forecast aggregates authorized branches.
12. Local timezone buckets due dates correctly across UTC boundaries.
13. Daily closing balance of day N exactly equals opening balance of day N+1.
14. `firstNegativeCashDate` and lowest balance/date are correct.
15. An empty new business returns a valid flat, LOW-confidence forecast rather than failing.

### Regression gate

Before PR:

- fresh PostgreSQL migrations 0001 through current latest
- full API tests
- full domain tests
- workspace typecheck
- workspace lint
- web/system-admin/API/desktop/mobile builds
- GitHub protected CI after push

## 17. Future Extensions Enabled by This Design

This foundation intentionally makes later improvements possible without replacing the API concept:

- customer-specific collection probability
- supplier-payment rescheduling scenarios
- “what if” owner simulations
- seasonal/holiday models
- bank/MoMo live-balance ingestion
- probabilistic ranges instead of point estimates
- automatic CFO recommendations based on projected shortfalls
- LLM explanation of forecast evidence and recommended actions

Those extensions must remain downstream consumers of deterministic ledger facts.
