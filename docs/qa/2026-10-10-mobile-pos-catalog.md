# TradeOS Mobile Catalog + POS Foundation — QA Record

Date: 2026-10-10
Branch: `feat/mobile-pos-catalog-foundation`
Verified implementation head before QA commit: `4d27d9eb03af84f475847b2c7a8d6f86f0c285e7`
Base: merged `main` mobile runtime foundation (`9a79b00ee3219920d7cacd1fa38faae20372377a`)

## Outcome

This slice turns the TradeOS Android/iOS client from an authenticated sync shell into the first real business workflow:

- read-only mobile catalog access through the existing HTTPS domain;
- read-only branch inventory access through the existing HTTPS domain;
- refresh-safe bearer requests for both read models;
- durable per-business catalog cache and per-business+branch inventory cache;
- searchable sellable units with last-known branch stock display;
- mobile cart with quantity increment/decrement/remove;
- immediate-payment checkout for Cash, MoMo, Card, Bank and Other;
- durable `SALE_CREATE` capture into the existing offline mutation queue;
- online immediate flush, offline pending sync, reconnect sync and server-rejection review handling;
- role-aware Sell/Sync mobile workspace.

Customer-credit checkout remains intentionally out of this slice until mobile customer lookup and credit readiness are implemented.

## Server-authoritative commerce invariants

The mobile POS does not become an alternate pricing or accounting engine.

- `SALE_CREATE` contains only `currencyCode`, `paymentMethod` and lines `{ itemId, saleUnitCode, quantity }`.
- Mobile never sends a unit price, line total or sale total in the economic mutation.
- The server still validates the current sellable unit, current price, conversion, stock, tenant, authenticated actor, permission, accounting, cashbook, COGS and idempotency.
- Mobile display totals are explicitly read-model totals only.
- Offline stock is shown as last-known branch stock, never as a current availability guarantee.
- The sale mutation is durably enqueued before any network flush attempt.
- A network failure after enqueue leaves the sale pending rather than losing or ambiguously retrying it.
- A server-rejected sale moves to the queue's failed/review evidence rather than being silently deleted.
- Customer credit is not offered by this mobile checkout.
- Sale creation is gated to `OWNER`, `ADMIN`, `MANAGER`, `CASHIER`, `SALES` and `STAFF`.

## Native gateway surface

`/api/mobile/[...path]` now additionally permits only:

- `GET /v1/catalog/items`
- `GET /v1/inventory`

Catalog/inventory POST/PATCH/write routes remain blocked by the native gateway before Fastify. Query strings are forwarded unchanged to the private localhost API.

## Offline read cache behavior

- Catalog cache is scoped by business.
- Inventory cache is scoped by business and branch.
- Successful online refreshes write both snapshots with a confirmation timestamp.
- Offline mode uses cache only.
- Online refresh failure falls back to cache when available and surfaces a last-known-data warning.
- A device with no cache must connect successfully once before offline selling is available.
- Malformed commerce cache is treated as disposable read-model data and fails closed to no cache.
- This deliberately differs from mutation queue corruption, which remains blocking and non-destructive because the queue contains economic evidence.

## TDD evidence

Implementation proceeded RED -> GREEN for each slice.

Focused coverage added/expanded:

- native gateway policy/query forwarding: **4 total gateway tests**;
- mobile API client: **9 tests**;
- mobile storage: **8 tests**;
- new mobile POS model: **6 tests**;
- mobile runtime: **15 tests**;
- mobile app model: **12 tests**.

Final mobile suite: **5 files / 50 tests passed**.

Final web suite: **62 files / 336 tests passed**.

API integration suite: **23 files / 85 tests passed**.

The API suite covers authentication, tenant boundaries, sync commerce, inventory, finance, treasury, cashbook, returns/exchanges, operations, supplier flows, reporting and related authoritative domains.

## Clean-state repository gate

A PostgreSQL 18 test cluster was created under `/tmp/tradeos-pos-ci-pg`, bound to localhost on port `56382`, migrated through the full current schema, and contained **57 public tables**. It was isolated from staging data.

Before running the root gate, `packages/client-core/dist` was deleted to preserve the clean-checkout condition that previously exposed a mobile resolver defect.

Executed:

```text
pnpm typecheck
pnpm lint
git diff --check main...HEAD
pnpm test
pnpm build
```

Result: **PASS, exit code 0**.

Observed key results:

- deployment configuration tests: **6/6 passed**;
- client-core: **16/16 passed**;
- domain: **35/35 passed**;
- web: **62 files / 336 tests passed**;
- mobile: **5 files / 50 tests passed**;
- API: **23 files / 85 tests passed**;
- system-admin production build: PASS;
- web production build: PASS, including `/api/mobile/[...path]`;
- API build: PASS;
- desktop build: PASS;
- mobile TypeScript build: PASS.

Generated Next `next-env.d.ts` build artifacts were restored and are not part of this feature branch.

## Exact-HEAD native packaging

With `packages/client-core/dist` absent, the verified implementation head exported both native targets successfully:

- Android: 609 modules, Hermes bundle `_expo/static/js/android/AppEntry-d5d4aa03c2ab0f8137329fa66e9e2437.hbc`, **1,580,533 bytes**.
- iOS: 611 modules, Hermes bundle `_expo/static/js/ios/AppEntry-2b00e9c9a32f5f8f98aae07a1a03b6b3.hbc`, **1,575,630 bytes**.

Both exports exited 0 and `packages/client-core/dist` remained absent throughout.

## Functional mobile experience

The READY workspace now has two primary modes.

### Sell

- current business / branch / role / currency context;
- live vs last-known data freshness indicator;
- searchable item/SKU/unit catalog;
- unit-level cached/default display price;
- last-known stock display for stock-tracked products;
- Add action;
- cart quantity + / - / remove;
- display-only total with a server-recalculation notice;
- Cash / MoMo / Card / Bank / Other payment selector;
- role-aware checkout gating;
- synchronized, pending-sync and needs-review result states.

### Sync

- pending mutation count;
- mutations blocked for another active business;
- failed/review count;
- manual sync;
- reconnect auto-flush behavior inherited from the durable runtime.

## Deliberate limits / next owned slices

This is the first mobile transaction workflow, not the full mobile business suite. The next slices should build on it in this order:

1. Mobile customer search/selection and safe customer-credit readiness.
2. Mobile sale history/receipt detail plus returns/exchanges.
3. Broader inventory workflows and purchasing where mobile operation is valuable.
4. Device UAT, signed Android/iOS distributables and store/test distribution.
5. True OS background scheduling where platform rules allow it.

Server pricing, permissions, accounting, stock, customer credit, refunds/returns, tenancy and idempotency remain authoritative throughout.
