# TradeOS Z.ai all-pages cutover — 2026-10-11

## Problem confirmed

The authenticated frontend was in a hybrid state. Dashboard/POS and the public entry had later Z.ai composition work, while several authenticated routes still mounted generic route chrome and the root layout had reintroduced the 2,514-line `tradeos-app.css` monolith. Purchases, Inventory, Operations and Reports also duplicated route-level generic headers on top of coordinator-owned headers.

## Cutover shipped in this branch

- Removed generic `PageHeader`, `DataCard` and `tradeos-page-stack` route chrome from the primary authenticated routes.
- Added one shared Z.ai route header/access-state grammar for feature pages and denied-role states.
- Preserved the existing business coordinators, APIs, permissions, offline queues and mutation authority; this cutover changes the presentation boundary, not business truth.
- Restored the focused canonical Z.ai module stylesheets for purchases/inventory, returns/exchanges, sales, cashbook/treasury, operations, reports and master-data lifecycle surfaces.
- Preserved the newer PR #42 public login/onboarding composition separately in `public-entry.css` instead of overwriting it with the older canonical snapshot.
- Isolated post-canonical accessibility/correctness additions in `zai-correctness.css`.
- Deleted `tradeos-app.css` completely from the runtime and repository.
- Bumped the service-worker cache namespace to `tradeos-shell-v6-zai-all-pages` so installed clients evict the previous cached page/CSS generation.

## Primary authenticated routes covered

- Dashboard (existing Z.ai command-center composition retained)
- Sell / POS
- Sales
- Customers
- Purchases
- Inventory
- Catalog
- Returns & refunds
- Cashbook & expenses
- Operations
- Reports

## Regression boundary

`apps/web/app/components/workspace/zai-all-pages-composition.test.ts` prevents the hybrid state from returning by asserting:

- no primary route imports generic PageHeader/DataCard chrome;
- no primary route mounts `tradeos-page-stack`;
- coordinator-owned pages use `ZaiRouteHeader`;
- denied mutation-first routes use the shared Z.ai access state;
- root layout imports focused module CSS and never imports `tradeos-app.css`;
- post-canonical report severity treatment remains present.

## Verification evidence

Fresh local verification on the candidate tree:

- PostgreSQL 18 isolated CI database: all migrations applied, 57 public tables.
- Root `pnpm typecheck`: passed across all workspaces.
- Root `pnpm lint`: passed across all workspaces.
- Web: 63 test files / 342 tests passed.
- Mobile: 5 test files / 50 tests passed.
- API: 23 integration test files / 85 tests passed.
- Root `pnpm build`: passed for system-admin, web, API, desktop and mobile.
- Next production build generated all authenticated routes successfully.
- Authenticated sync replay smoke: duplicate client mutation produced one `sync_mutations` row (`count=1`).
- `git diff --check`: clean.
- Isolated PostgreSQL cluster was stopped after verification; staging data was not touched.

## Visual runtime note

The VPS does not currently expose Chromium/Playwright/Puppeteer, so no local browser screenshot capture was generated in this branch. Source-level composition, production bundling and route generation were verified here; live staging visual inspection follows deployment after CI.
