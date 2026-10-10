# TradeOS Mobile Catalog + POS Foundation Implementation Plan

**Goal:** Ship the first real Android/iOS TradeOS transaction workflow: cached catalog/inventory browsing and durable immediate-payment sale capture through the existing offline sync engine.

**Spec:** `docs/superpowers/specs/2026-10-10-tradeos-mobile-pos-catalog-design.md`

### Task 1 — Allow-listed mobile catalog/inventory reads

Files: `apps/web/app/lib/native-api-proxy.ts`, its tests, mobile catch-all route tests if needed.

- [ ] RED tests for GET catalog/inventory allowed, write variants blocked, query forwarding preserved.
- [ ] Implement minimal route policy expansion.
- [ ] Web focused tests + typecheck.

### Task 2 — Mobile API catalog/inventory methods

Files: `apps/mobile/src/api-client.ts`, tests.

- [ ] RED tests for typed bearer GET catalog and inventory with encoded business/branch/query params.
- [ ] Implement types/methods using existing refresh-safe client.
- [ ] Mobile tests + typecheck.

### Task 3 — Commerce cache + pure POS model

Files: `apps/mobile/src/storage.ts`, storage tests, create `apps/mobile/src/pos-model.ts`, tests.

- [ ] RED cache tests for business/branch scoping, freshness and malformed cache fail-closed.
- [ ] RED POS tests for sellable projection, search, cart increment/remove/quantity, display total and exact server-authoritative mutation payload.
- [ ] Implement minimal cache/model.
- [ ] Mobile tests + typecheck.

### Task 4 — Commerce runtime

Files: `apps/mobile/src/runtime.ts`, tests.

- [ ] RED tests for online live load+cache, online failure cache fallback, offline cache-only/no-cache, role gating, durable enqueue, online flush, rejected sale review, network flush fallback.
- [ ] Implement `loadCommerce()` and `createSale()`.
- [ ] Full mobile tests + typecheck.

### Task 5 — App model + functional POS UI

Files: `apps/mobile/src/app-model.ts`, tests, `apps/mobile/App.tsx`.

- [ ] RED app-model tests for commerce load, cart actions, payment selection, durable checkout clearing cart, cached-data warning and review state.
- [ ] Implement `Sell` / `Sync` READY workspace UI with mobile-first search/catalog/cart/checkout.
- [ ] Keep all five immediate payment methods; no customer credit.
- [ ] Full mobile tests/typecheck + Android/iOS exports.

### Task 6 — Verification + PR + staging

- [ ] Run clean-checkout mobile tests with `packages/client-core/dist` absent.
- [ ] Run root typecheck, lint, whitespace, tests and builds against isolated PostgreSQL.
- [ ] Update QA evidence.
- [ ] Push PR and require green GitHub CI.
- [ ] Merge exact verified SHA.
- [ ] Deploy merged main to staging, restart web only if API unchanged, and smoke catalog/inventory allow-list plus auth boundary.
