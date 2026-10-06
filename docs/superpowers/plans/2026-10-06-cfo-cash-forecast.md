# TradeOS Africa — 30-Day CFO Cash Forecast Implementation Plan

**Goal:** Deliver the approved deterministic 1–30 day cash forecast end-to-end: shared contracts, pure forecast math, authorized PostgreSQL API, owner-facing CFO panel, offline cache, and full regression verification.

**Architecture:** Keep money forecasting deterministic. PostgreSQL supplies authoritative opening cash, dated open obligations and bounded historical operating cash observations. A pure domain function turns those facts into daily projections, confidence and shortfall summaries. The web app only renders/caches the server result; it never recalculates a forecast client-side.

**Tech:** TypeScript, pnpm workspace, Vitest, Fastify, PostgreSQL 18/CI-compatible SQL, Next.js 16, React 19.

## Shared rulings

- `sameWeekdayCoverageDays` is the minimum number of completed historical observations available for each unique weekday represented in the forecast horizon.
- Even-count medians that land between two minor-unit values are rounded with `Math.round`, preserving integer minor-unit money.
- Baseline history contains completed local calendar days only; once business activity begins, zero-activity days inside the bounded history window remain real observations.
- Contractual obligations are projected from `open_minor`, never `original_minor`.
- Overdue obligations are rolled into day 1 and exposed separately from non-overdue contractual amounts.
- Whole-business forecasts use the business timezone; branch forecasts use the active branch timezone, matching existing financial-report behavior.
- No forecast query may mutate ledgers, terms or obligations.

## Task 1 — Shared contract and pure forecast engine

**Files**
- Modify: `packages/contracts/src/reports.ts`
- Create: `packages/domain/src/cash-forecast.test.ts`
- Create: `packages/domain/src/cash-forecast.ts`
- Modify: `packages/domain/src/index.ts`

### 1. RED — write forecast-domain tests

Add tests for:
- daily opening/closing chaining and contractual inflow/outflow arithmetic;
- odd and even median behavior in integer minor units;
- same-weekday median selection at 4+ samples;
- overall median fallback at 14+ completed history days with weak weekday coverage;
- sparse history (<14 days) producing zero estimated baseline and LOW confidence;
- HIGH confidence at 42+ days only when every horizon weekday has 4+ samples;
- overdue fields flowing through day 1 without changing the contractual total;
- first negative-cash date and lowest projected balance/date;
- safe-integer overflow throwing instead of silently losing money precision.

Run:
`pnpm --filter @tradeos/domain test -- cash-forecast.test.ts`

Expected RED: module/types/functions are missing.

### 2. GREEN — add shared report types

In `packages/contracts/src/reports.ts`, add:
- `CashForecastBaselineMethod`
- `CashForecastDay`
- `CashForecastSummary`
- `CashForecastConfidence`
- `CashForecastResponse`

Keep all money fields as integer minor units.

### 3. GREEN — implement the pure domain engine

In `packages/domain/src/cash-forecast.ts`, define input facts for:
- metadata and forecast start local date;
- opening cash;
- 1–30 day horizon;
- completed historical daily inflow/outflow rows;
- aggregated customer/supplier contractual rows.

Implement:
- ISO-local-date increment/weekday helpers;
- safe integer addition/subtraction guard;
- median minor-unit calculation;
- weekday sample grouping;
- overall fallback;
- daily projection chain;
- summary totals, minimum cash and first negative date;
- confidence and explainable assumptions.

Export from `packages/domain/src/index.ts`.

Run the focused test until GREEN, then run:
`pnpm --filter @tradeos/domain test`

Commit checkpoint:
`feat: add deterministic cash forecast engine`

## Task 2 — Authorized PostgreSQL cash-forecast API

**Files**
- Create: `apps/api/test/cash-forecast.integration.test.ts`
- Create: `apps/api/src/cash-forecast.ts`
- Modify: `apps/api/src/app.ts`

### 1. RED — write PostgreSQL integration tests first

Follow existing API-test setup (`buildApp`, `createPool`, real migrations, `TRUNCATE app_users,businesses CASCADE`). Cover:
- empty new business returns a flat LOW-confidence forecast;
- opening cash equals authoritative cashbook sum before local forecast-day start;
- future customer obligations land on their recorded due local dates;
- supplier obligations land as outflows on their due local dates;
- overdue receivables/payables roll to day 1 and remain separately identified;
- reduced `open_minor` is used after partial allocation;
- owner injection/withdrawal/opening balance/adjustment affect opening cash where historically valid but are excluded from the operating baseline;
- same-weekday median behavior with 4+ observations;
- overall median fallback with 14+ observations and weak weekday coverage;
- sparse history gives contractual-only projection and LOW confidence;
- branch scope excludes other branches and whole-business scope aggregates them;
- branch timezone maps UTC-crossing due dates to the correct local day;
- response chaining, first negative date and minimum balance are internally exact;
- invalid `businessId`, `branchId` and `days` return the existing 400/403/404 semantics.

Run:
`DATABASE_URL=postgresql://tradeos:tradeos@127.0.0.1:55432/tradeos_ci pnpm --filter @tradeos/api test -- cash-forecast.integration.test.ts`

Expected RED: route returns 404 / implementation missing.

### 2. GREEN — create the route module

Implement `registerCashForecastRoutes(app, pool)` in `apps/api/src/cash-forecast.ts`.

Endpoint:
`GET /v1/reports/cash-forecast?businessId=<uuid>&branchId=<optional uuid>&days=<1..30>`

Authorization roles must exactly match existing financial reporting:
`OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`, `VIEWER`.

Use one REPEATABLE READ, READ ONLY transaction and a bounded query set:
1. active scope metadata + local forecast start + authoritative opening cash;
2. customer open obligations aggregated by effective local forecast date;
3. supplier open obligations aggregated by effective local forecast date;
4. up to 56 completed local history days of operating cashbook inflow/outflow, including zero days after activity begins.

Operating baseline entry types only:
`SALE_RECEIPT`, `CUSTOMER_PAYMENT`, `PURCHASE_PAYMENT`, `SUPPLIER_PAYMENT`, `SALE_REFUND`, `PURCHASE_RETURN_RECOVERY`, `EXPENSE`.

Explicitly exclude capital/manual types from baseline:
`OPENING_BALANCE`, `OWNER_INJECTION`, `OWNER_WITHDRAWAL`, `ADJUSTMENT`.

Use safe-integer validation on every bigint amount/count received from PostgreSQL before giving facts to the domain engine.

### 3. Register route

Import/register the module in `apps/api/src/app.ts` after financial reporting registration.

Run focused tests until GREEN, then:
- `DATABASE_URL=... pnpm --filter @tradeos/api test`
- `pnpm --filter @tradeos/api typecheck`

Commit checkpoint:
`feat: expose authorized 30-day cash forecast API`

## Task 3 — Owner-facing CFO forecast panel and offline cache

**Files**
- Modify: `apps/web/package.json`
- Create: `apps/web/app/components/cash-forecast.test.tsx`
- Create: `apps/web/app/components/cash-forecast.tsx`
- Modify: `apps/web/app/components/financial-reports.tsx`
- Modify: `apps/web/app/globals.css` only if existing warning styles cannot express negative projected cash clearly.

### 1. RED — add render tests before the component

Add Vitest as the web test runner and use `react-dom/server` so tests remain browser-free.

Test the pure panel rendering for:
- primary forecast cards;
- confidence label and generated timestamp;
- overdue annotation on day 1;
- negative closing-cash row warning class;
- daily table values and contractual-vs-estimated explanation;
- offline-cached indicator.

Run:
`pnpm --filter @tradeos/web test`

Expected RED: component is missing.

### 2. GREEN — implement `CashForecastPanel`

Render:
- Cash today
- Projected closing cash
- Lowest projected cash + date
- First shortfall / No projected shortfall
- Contractual inflows/outflows
- Confidence badge
- daily table: Date, Opening cash, Customer due, Supplier due, Estimated inflow, Estimated outflow, Closing cash
- returned assumptions and evidence metadata.

Use the existing visual language and `--warning`; do not introduce an unrelated design system.

### 3. Integrate server fetch and offline cache

In `financial-reports.tsx`:
- fetch `/api/tradeos/v1/reports/cash-forecast` in the existing report load flow;
- scope branch vs whole business consistently with the selected report scope;
- request 30 days;
- cache successful responses under a forecast-specific versioned key keyed by business + branch/all + horizon;
- while offline, show only the saved server forecast with its original `generatedAt` and mark it cached;
- never derive a new forecast in browser code;
- refresh forecast after relevant money mutations using the existing refresh event mechanism.

Run:
- `pnpm --filter @tradeos/web test`
- `pnpm --filter @tradeos/web typecheck`
- `pnpm --filter @tradeos/web build`

Commit checkpoint:
`feat: add CFO cash forecast workspace`

## Task 4 — Full regression and delivery gate

### 1. Recreate the CI database from migrations

Drop/recreate the isolated `tradeos_ci` database on port 55432, then apply every migration in order with `ON_ERROR_STOP=1`.

### 2. Full local verification

With the isolated DB configured, run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `pnpm build`

Also verify worktree is clean except intended feature files and inspect the final diff for secrets/generated artifacts.

### 3. Push feature branch and verify protected GitHub CI

Push `feat/cfo-cash-forecast`, observe GitHub Actions through completion, and do not merge on red CI.

### 4. Code review

Review specifically for:
- tenant/branch isolation;
- timezone/DST day bucketing;
- double counting;
- integer overflow;
- opening cash vs baseline boundaries;
- obligation due-date correctness;
- offline stale-data labeling;
- no live-database or deployment-directory mutation.

### 5. Merge/deploy only after green evidence

After all gates are green, integrate the feature into `main` using the repository’s normal PR/merge path. Then confirm staging health and the CFO forecast UI against staging without changing production accounting data.
