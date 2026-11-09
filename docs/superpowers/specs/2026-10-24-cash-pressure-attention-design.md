# Cash Pressure Attention Design

## Intent

Complete the tenant AI attention engine by making the already-declared `CASH_PRESSURE_FORECAST` rule operational. TradeOS should proactively surface a cash review when its existing authoritative cash forecast projects a negative cash balance, without introducing a second forecast model or permitting any economic mutation.

## Goals

- Reuse the existing cash-forecast calculation and data-loading path as the single source of truth.
- Evaluate a 30-day forecast during business attention evaluation.
- Emit one branch/business scoped `CASH_PRESSURE_FORECAST` attention item only when `firstNegativeCashDate` is non-null.
- Mark it `CRITICAL` when the first negative date is within 3 local forecast days; otherwise `HIGH`.
- Preserve forecast confidence/history in evidence rather than suppressing a real negative projection.
- Make the rule selectable by the existing safe cash-review automation, producing only an internal `CREATE_CASH_REVIEW` action item.

## Non-goals

- No new AI/LLM provider requirement.
- No arbitrary low-cash percentage threshold.
- No direct payment, cashbook, purchase, expense, funding, withdrawal, or other economic mutation.
- No duplicate cash forecast implementation inside the attention service.

## Architecture

Extract the current report body from `apps/api/src/cash-forecast.ts` into an exported `getCashForecastReport(pool, input)` function. The HTTP route delegates to it, preserving response semantics. The attention service calls the same function with `horizonDays: 30` and the evaluation timestamp, then derives the signal from the returned `CashForecastResponse`.

The signal evidence includes opening cash, projected closing cash, lowest projected cash/date, first negative cash date, confidence level/history days, contractual inflows/outflows, and currency metadata. Existing attention persistence/idempotency handles update/resolution.

The automation guidance exposes `CASH_PRESSURE_FORECAST` as the trigger for the existing cash-position review template; the dispatcher still creates only internal action items.

## Safety

- Tenant/branch scope continues through the existing forecast scope validation.
- Financial attention stays hidden from non-financial roles through the existing `FINANCIAL_BUSINESS_ATTENTION_RULE_CODES` gate.
- Forecast failures fail attention evaluation rather than silently synthesizing a signal.
- No new write path is added outside `business_attention_items` / existing safe action-item automation.
