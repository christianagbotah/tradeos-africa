# TradeOS Money, Stock & Purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/cashbook`, `/inventory`, and `/purchases` into phone-first TradeOS operating workspaces while preserving the existing server-authoritative money, inventory, supplier, purchasing, receiving, payment, return, valuation, reconciliation, and offline-sync rules.

**Architecture:** Keep the existing API/domain/database contracts intact. Split the current presentation monoliths into focused route workspaces, introduce pure display/view-model helpers and one shared cached procurement read hook, then progressively compose the existing mutation flows behind action sheets/panels rather than recreating business logic. Money remains backed by Cashbook/Treasury server totals and posted account balances; Stock remains backed by `/inventory`; Purchases remains backed by suppliers/purchases and existing durable mutations.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Vitest 3, existing `clientApi`, `feature-cache`, `offline-sync`, PostgreSQL/Fastify backend.

**Spec:** `docs/superpowers/specs/2026-10-08-tradeos-2-design-system-ux-architecture.md` §§6–8, 11–12, plus the route/domain preservation rules in `docs/superpowers/specs/2026-10-07-tradeos-multipage-ux-design.md`.

## Global Constraints

- Preserve the established routes `/cashbook`, `/inventory`, `/purchases`; mobile and desktop are adaptive presentations of the same domain workflows.
- Mobile body/default controls remain 15–16px; normal business context/navigation never falls to 9–10px.
- Mobile primary touch targets are 48–52px; icon-only touch targets are at least 44x44px; respect bottom safe-area insets.
- Keep the responsive bands `<480`, `480–767`, `768–1099`, `>=1100` and prevent page-level horizontal overflow at 360px.
- Do not reconstruct accounting, stock valuation, payable, conversion, or reconciliation formulas in the client. Render server totals/balances and submit the existing mutation inputs only.
- Do not invent low-stock thresholds, supplier recommendations, or sales velocity that the current APIs do not expose. Until a server threshold exists, Stock may truthfully call out zero/negative availability and high-value inventory only.
- Keep durable offline behavior: locally accepted mutations stay clearly pending; rejected sync results are not presented as completed business events.
- Preserve role enforcement in both UI and backend. UI capability checks are presentation only and never replace server authorization.
- Keep GHS and non-GHS currency support through existing minor-unit values and `Intl.NumberFormat`/shared money presentation.
- Do not add another generic `workspace-polish` override layer. New styles are route/workspace scoped and consume the existing `--tos-*` tokens.
- No new animation dependency; honor `prefers-reduced-motion`.

## Review Focus

1. **Offline with saved vs no saved data:** Money/Stock/Purchases must distinguish cached usable data from unavailable data and must not imply the server has posted a pending mutation.
2. **Viewer/Cashier/Inventory/Accountant role differences:** read-only roles see useful data without write controls; supplier terms, money adjustment/transfer/reconciliation, receiving and supplier payment remain role-safe.
3. **Zero/negative/large values and non-GHS currencies:** totals and balances remain readable, signed correctly and do not overflow cards at 360px.
4. **No-threshold inventory:** zero/negative availability may be flagged as out of stock; positive inventory must not be labelled “low” without server evidence.
5. **Durable procurement actions:** receiving/payment/return screens clear or close only after local durable enqueue succeeds; remote applied/pending/rejected status stays explicit.

---

## File Structure

### Shared procurement read layer
- Create `apps/web/app/components/procurement/procurement-types.ts` — public `Supplier`, `InventoryItem`, `PurchaseSummary`, `ProcurementSnapshot` types currently buried in the legacy component.
- Create `apps/web/app/components/procurement/procurement-model.ts` — pure summary/search helpers for Stock and Purchases.
- Create `apps/web/app/components/procurement/procurement-model.test.ts` — pure contract tests including no-threshold behavior.
- Create `apps/web/app/components/procurement/use-procurement-data.tsx` — existing three-endpoint cached read orchestration and mutation-applied refresh behavior.
- Create `apps/web/app/components/procurement/use-procurement-data.test.tsx` — source/cache/session-scope contracts.

### Money
- Create `apps/web/app/components/money/money-model.ts` — pure presentation model from already-authoritative Cashbook summary/totals, posted money-account balances, queue/failure counts.
- Create `apps/web/app/components/money/money-model.test.ts`.
- Create `apps/web/app/components/money/money-workspace.tsx` — decision-first Money page composing existing Cashbook/Treasury capabilities.
- Create `apps/web/app/components/money/money-workspace.test.tsx`.
- Create `apps/web/app/money-workspace.css`.
- Modify `apps/web/app/(workspace)/cashbook/page.tsx`.
- Modify `apps/web/app/components/cashbook-expenses.tsx`, `cashbook/*`, and `treasury.tsx` only where needed to expose focused presentation hooks; do not change mutation payload semantics.

### Stock
- Create `apps/web/app/components/inventory/inventory-workspace.tsx` — Stock home with search, health, high-value inventory, unavailable/quarantine/damaged context, recent receiving and Receive Stock route action.
- Create `apps/web/app/components/inventory/inventory-workspace.test.tsx`.
- Create `apps/web/app/inventory-workspace.css`.
- Modify `apps/web/app/(workspace)/inventory/page.tsx`.

### Purchases
- Create `apps/web/app/components/procurement/purchases-workspace.tsx` — procurement home/action orchestration.
- Create `apps/web/app/components/procurement/purchases-workspace.test.tsx`.
- Create focused components under `apps/web/app/components/procurement/` for supplier creation, purchase receipt, supplier payment/terms, purchase history, and purchase return as they are extracted from `purchases-inventory.tsx`.
- Create `apps/web/app/purchases-workspace.css`.
- Modify `apps/web/app/(workspace)/purchases/page.tsx`.
- Delete `apps/web/app/components/purchases-inventory.tsx` only after both new routes no longer reference it and characterization tests cover its mutation contracts.

### Composition / global
- Modify `apps/web/app/layout.tsx` to import scoped workspace CSS.
- Modify `apps/web/app/components/workspace/route-composition.test.tsx` to require the new route workspaces and prohibit `PurchasesInventory` route composition.
- Retain `cashbook.css` / `purchases-inventory.css` only while unmigrated subcomponents still require them; remove dead responsibility after final route migration.

---

### Task 1: Procurement read model and shared data source

**Files:**
- Create `apps/web/app/components/procurement/procurement-types.ts`
- Create `apps/web/app/components/procurement/procurement-model.ts`
- Create `apps/web/app/components/procurement/procurement-model.test.ts`
- Create `apps/web/app/components/procurement/use-procurement-data.tsx`
- Create `apps/web/app/components/procurement/use-procurement-data.test.tsx`

**Interfaces:**
- `buildInventoryOverview(items: readonly InventoryItem[]): InventoryOverview`
- `filterInventory(items: readonly InventoryItem[], query: string): InventoryItem[]`
- `buildProcurementOverview(suppliers: readonly Supplier[], purchases: readonly PurchaseSummary[]): ProcurementOverview`
- `useProcurementData({ businessId, branchId }): { suppliers; inventory; purchases; source; message; reload }`, where `source` is `"live" | "cached" | "unavailable"`.

- [ ] **Step 1: Write failing pure-model tests.** Assert tracked count, total server-provided inventory value, zero/negative availability count, quarantine/damaged quantities, high-value sort, supplier payable/credit split, latest purchase list, search by name/SKU, and explicitly assert positive stock is never classified as low without a server threshold.
- [ ] **Step 2: Run the focused test and confirm RED.** `pnpm --filter @tradeos/web exec vitest run app/components/procurement/procurement-model.test.ts`
- [ ] **Step 3: Implement the minimal pure types/helpers.** Aggregate display-only values from server fields; do not derive valuation or conversion costs.
- [ ] **Step 4: Run the focused test and confirm GREEN.**
- [ ] **Step 5: Commit the pure model.** `feat(web): add procurement presentation model`
- [ ] **Step 6: Write failing data-hook characterization tests.** Pin the existing three endpoints, feature-cache namespace/scope, session epoch guard, offline cached/unavailable distinction, and applied-mutation refresh set.
- [ ] **Step 7: Run the hook test and confirm RED.**
- [ ] **Step 8: Implement `useProcurementData` by moving the existing read/cache orchestration from `PurchasesInventory` without changing endpoints.**
- [ ] **Step 9: Run focused hook + existing purchases/inventory API tests and confirm GREEN.**
- [ ] **Step 10: Commit.** `refactor(web): share procurement read state`

### Task 2: Decision-first Money workspace

**Files:**
- Create `apps/web/app/components/money/money-model.ts`
- Create `apps/web/app/components/money/money-model.test.ts`
- Create `apps/web/app/components/money/money-workspace.tsx`
- Create `apps/web/app/components/money/money-workspace.test.tsx`
- Create `apps/web/app/money-workspace.css`
- Modify `apps/web/app/(workspace)/cashbook/page.tsx`
- Modify existing Cashbook/Treasury components only for composition hooks.

**Interfaces:**
- `buildMoneyOverview({ summary, totals, accounts, queued, failed }): MoneyOverview`
- `MoneyWorkspace({ businessId, branchId, currencyCode, role })`
- Existing `CashbookExpenses` mutation payloads and `Treasury` server/account rules remain authoritative.

- [ ] **Step 1: Write failing model tests.** Assert server summary inflow/outflow/net are passed through unchanged, posted account balances are grouped by method, negative balances remain signed, queue/failure counts are surfaced, and non-GHS formatting remains supported.
- [ ] **Step 2: Confirm RED, implement model, confirm GREEN, commit.** `feat(web): add Money operating model`
- [ ] **Step 3: Write failing Money workspace tests.** Require first-view money position, today inflow/outflow, role-aware Record Expense / Transfer / Reconcile actions, recent movement, progressive treasury, sync status, >=48px phone actions and safe-area behavior. Assert read-only roles do not receive mutation controls.
- [ ] **Step 4: Confirm RED.**
- [ ] **Step 5: Implement `MoneyWorkspace` by reorganizing the existing Cashbook/Treasury data and actions into command-center + progressive action surfaces.** Do not change mutation names/payload fields or server summary math.
- [ ] **Step 6: Replace `/cashbook` route composition and add scoped responsive styles.**
- [ ] **Step 7: Run Money-focused tests plus existing Cashbook/Treasury tests and confirm GREEN.**
- [ ] **Step 8: Commit.** `feat(web): redesign Money workspace`

### Task 3: Stock home workspace

**Files:**
- Create `apps/web/app/components/inventory/inventory-workspace.tsx`
- Create `apps/web/app/components/inventory/inventory-workspace.test.tsx`
- Create `apps/web/app/inventory-workspace.css`
- Modify `apps/web/app/(workspace)/inventory/page.tsx`

**Interfaces:**
- Consumes `useProcurementData` and `buildInventoryOverview` from Task 1.
- `InventoryWorkspace({ businessId, branchId, currencyCode, role })`.

- [ ] **Step 1: Write failing Stock tests.** Require total tracked products, total server inventory value, out-of-stock exceptions, quarantine/damaged context, highest-value items, name/SKU search, recent receipts, and a `Receive stock` action to `/purchases` only for roles already allowed to receive.
- [ ] **Step 2: Add the review-focus case proving a positive-availability item is not labelled low stock.**
- [ ] **Step 3: Confirm RED.**
- [ ] **Step 4: Implement Stock home and responsive styles.** Use rows/lists rather than a desktop table on phone; no invented threshold/velocity/reorder quantity.
- [ ] **Step 5: Replace `/inventory` route composition.**
- [ ] **Step 6: Run focused Stock + procurement model/hook tests and confirm GREEN.**
- [ ] **Step 7: Commit.** `feat(web): ship Stock operating workspace`

### Task 4: Professional Purchases workspace

**Files:**
- Create `apps/web/app/components/procurement/purchases-workspace.tsx`
- Create `apps/web/app/components/procurement/purchases-workspace.test.tsx`
- Extract focused procurement mutation components from `apps/web/app/components/purchases-inventory.tsx` into `apps/web/app/components/procurement/`
- Create `apps/web/app/purchases-workspace.css`
- Modify `apps/web/app/(workspace)/purchases/page.tsx`

**Interfaces:**
- Consumes `useProcurementData` / `buildProcurementOverview`.
- Preserve existing mutation contracts: `PURCHASE_RECEIVE_CREATE`, `SUPPLIER_PAYMENT_CREATE`, `PURCHASE_RETURN_CREATE`; supplier create/patch remain the existing online API writes.
- `PurchasesWorkspace({ businessId, branchId, currencyCode, role, catalog })`.

- [ ] **Step 1: Write characterization tests around the existing purchase mutation payloads before extraction.** Assert receiving lines contain only item/purchase unit/quantity/unit cost; settlement methods include immediate methods + `SUPPLIER_CREDIT`; supplier payment cannot exceed payable balance; purchase return uses original line id, quantity and source location.
- [ ] **Step 2: Confirm characterization tests GREEN against current behavior.** This is the safety net before refactor, not a RED feature step.
- [ ] **Step 3: Write failing Purchases workspace tests.** Require supplier/payable summary, primary `Receive stock` action, supplier search/context, recent receipts, progressive supplier management/payment/return actions, phone-native action surfaces, and role-safe read-only behavior.
- [ ] **Step 4: Confirm RED.**
- [ ] **Step 5: Extract the existing supplier/receipt/payment/return functions into focused components without changing payload semantics.**
- [ ] **Step 6: Implement `PurchasesWorkspace` and responsive styles.** Receipt flow prioritizes supplier → lines → settlement/reference → durable receive result; hide unrelated administration from the primary flow.
- [ ] **Step 7: Replace `/purchases` route composition.**
- [ ] **Step 8: Run Purchases UI tests plus `purchases-inventory.integration.test.ts` and `purchase-returns.integration.test.ts`; confirm GREEN.**
- [ ] **Step 9: Commit.** `feat(web): ship professional Purchases workspace`

### Task 5: Remove the combined legacy route component and lock route composition

**Files:**
- Modify `apps/web/app/components/workspace/route-composition.test.tsx`
- Modify `apps/web/app/layout.tsx`
- Delete `apps/web/app/components/purchases-inventory.tsx` when unreferenced
- Remove dead selectors from `apps/web/app/purchases-inventory.css` or delete it when no longer imported.

**Interfaces:**
- `/cashbook` → `MoneyWorkspace`
- `/inventory` → `InventoryWorkspace`
- `/purchases` → `PurchasesWorkspace`

- [ ] **Step 1: Write failing composition/dead-code tests requiring the three new workspaces and prohibiting route imports of `PurchasesInventory` / legacy combined composition.**
- [ ] **Step 2: Confirm RED if any legacy route/dead responsibility remains.**
- [ ] **Step 3: Remove the legacy combined component and dead CSS responsibility.**
- [ ] **Step 4: Run web tests/typecheck and confirm GREEN.**
- [ ] **Step 5: Commit.** `refactor(web): retire legacy money stock procurement composition`

### Task 6: Full regression, responsive acceptance and stacked integration

**Files:**
- Modify only evidence-backed fixes found by this gate.

- [ ] **Step 1: Run `pnpm --filter @tradeos/web test`.**
- [ ] **Step 2: Run `pnpm typecheck && pnpm lint`.**
- [ ] **Step 3: Run `pnpm --filter @tradeos/web build`.**
- [ ] **Step 4: Run `pnpm test`.**
- [ ] **Step 5: Verify at 360, 390/393, 430, 768, 1024, 1280, 1440 for OWNER, CASHIER, INVENTORY, ACCOUNTANT, VIEWER as relevant.** Confirm no page horizontal overflow, no 9–10px normal labels, >=48px critical touch controls, safe-area transaction actions, and truthful offline states.
- [ ] **Step 6: Verify business/branch switches reset scoped data and stale asynchronous responses cannot cross session/business boundaries.**
- [ ] **Step 7: Verify Cashbook/Treasury server totals, Inventory server values, purchase receiving, supplier credit/payment and purchase returns through their existing integration tests.**
- [ ] **Step 8: Create a stacked PR from `feat/tradeos-money-stock-purchases` to `feat/tradeos-crud-pos-architecture`; squash only after the exact final head passes migrations, typecheck, lint, whitespace, full tests, production build and authenticated sync smoke.**
- [ ] **Step 9: After squash, verify the architecture-branch squash commit with a fresh complete CI run; PR #33 then automatically carries the slice toward `main`.
