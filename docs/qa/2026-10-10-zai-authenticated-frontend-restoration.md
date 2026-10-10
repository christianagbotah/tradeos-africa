# Z.ai authenticated frontend restoration — 2026-10-10

## Why this recovery exists

PR #38 (`feat/tradeos-zai-full-frontend-replacement`) merged the Z.ai full frontend replacement first. PR #37, based on the older frontend foundation, merged immediately afterward and overwrote overlapping authenticated presentation files. Later PR #43 further changed the shell, Dashboard and POS mobile composition.

This recovery restores the overlapping authenticated presentation from the final Z.ai PR #38 branch head `99871d60fc62e113e03785f9b41ec4706fa1526b` while preserving later non-visual correctness work already on `main`.

## Restored Z.ai presentation

- Application shell and responsive navigation
- Dashboard command center
- POS workspace and product browser
- Sales workspace presentation
- Inventory workspace presentation
- Associated Dashboard / POS / shell CSS

The root layout already retained Z.ai's eight-file design-system CSS boundary, and legacy files such as `real-app.css`, `workspace-polish.css`, `pos-workspace.css`, and `interactions.css` remain absent.

## Deliberately preserved later correctness work

- PR #42 public-entry/login/register/onboarding composition
- Multi-currency metadata and exponent-aware money handling
- Optimistic-concurrency and lifecycle protections
- Offline/sync correctness
- Dialog/focus safety where it does not alter Z.ai's authenticated composition
- Backend/API/domain/accounting contracts

The restored Z.ai components were adjusted only where necessary to call the shared exponent-aware `formatMoney()` helper. Their layout/markup/CSS composition remains Z.ai's.

## Verification

Final hardening on the restoration branch also covers the interaction regressions found during rendered QA:

- money-entry controls use the shared spaced currency-prefix input, including Treasury transfers/reconciliation and operating-day/shift counts
- clickable controls expose pointer affordances while disabled controls remain non-clickable
- native select/dropdown surfaces are opaque, including the compact business/branch context selector
- phone/tablet buttons and selects keep a 48px interaction floor through 768px
- browser `prompt` / `confirm` / `alert` transaction flows remain absent
- the authenticated web proxy now exposes all report endpoints actually used by Dashboard and Reports: financial summary, credit aging and cash forecast

Fresh branch verification:

- Web tests: 61 files / 331 tests passed
- Monorepo typecheck: passed
- Monorepo lint: passed
- Monorepo production build: passed
- `git diff --check`: passed
- `zai-authenticated-composition.test.ts` protects the restored Z.ai shell / Dashboard / POS composition
- `review-fixes.test.tsx` protects money inputs, dropdown opacity, pointer affordances, 48px tablet targets and report proxy coverage

### Rendered browser QA

Authenticated demo-owner rendering was re-run against the production build at 360px, 390px, 768px and 1280px for all 11 authenticated routes:

- Dashboard
- Sell / POS
- Sales
- Customers
- Purchases
- Inventory
- Catalog
- Returns
- Cashbook / Treasury
- Operations
- Reports

The automated browser audit completed **44 route/viewport checks with 0 failures**. It verifies:

- no horizontal page overflow
- pointer cursor on visible interactive controls
- no transparent native select surfaces
- no sub-48px visible buttons/selects/summary controls at 360/390/768
- every visible shared money input has an 8px currency-prefix gap, visible currency prefix and at least 48px height
- no `ROUTE_NOT_ALLOWED` / “This TradeOS web route is not exposed” message on authenticated pages
- mobile More opens as a modal dialog and closes with Escape

Representative screenshots plus the machine-readable 44-check audit are in `docs/qa/evidence/tradeos-zai-restoration-final/`.
