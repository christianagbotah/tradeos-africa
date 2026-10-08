# TradeOS Money, Stock & Purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/cashbook`, `/inventory`, and `/purchases` into phone-first TradeOS operating workspaces while preserving the existing server-authoritative money, inventory, supplier, purchasing, receiving, payment, return, valuation, reconciliation, and offline-sync rules.

**Architecture:** Keep the existing API/domain/database contracts intact. Split the current presentation monoliths into focused route workspaces, add pure display/view-model helpers plus one shared cached procurement read hook, then compose existing mutation flows behind action sheets/panels rather than recreating business logic. Money remains backed by Cashbook/Treasury server totals and posted account balances; Stock remains backed by `/inventory`; Purchases remains backed by suppliers/purchases and existing durable mutations.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Vitest 3, existing `clientApi`, `feature-cache`, `offline-sync`, PostgreSQL/Fastify backend.

**Spec:** `docs/superpowers/specs/2026-10-08-tradeos-2-design-system-ux-architecture.md` §§6–8, 11–12, plus the route/domain preservation rules in `docs/superpowers/specs/2026-10-07-tradeos-multipage-ux-design.md`.

## Global Constraints

- Preserve `/cashbook`, `/inventory`, `/purchases`; mobile and desktop are adaptive presentations of the same domain workflows.
- Mobile body/default controls remain 15–16px; normal business context/navigation never falls to 9–10px.
- Mobile primary touch targets are 48–52px; icon-only touch targets are at least 44x44px; respect bottom safe-area insets.
- Keep responsive bands `<480`, `480–767`, `768–1099`, `>=1100`; prevent page-level horizontal overflow at 360px.
- Do not reconstruct accounting, stock valuation, payable, unit-conversion, purchase-recovery, or reconciliation formulas in the client. Render server totals/balances and submit existing mutation inputs only.
- Do not invent low-stock thresholds, supplier recommendations, or sales velocity that current APIs do not expose. Until a server threshold exists, Stock may truthfully call out zero/negative availability and high-value inventory only.
- Remove the legacy client-side purchase-unit conversion preview during extraction. If purchase unit equals stock unit, the UI may show the same quantity; otherwise say the server will convert/post after synchronization.
- Keep durable offline behavior: locally accepted mutations stay clearly pending; rejected sync results are not presented as completed business events.
- Preserve role enforcement in both UI and backend. UI capability checks are presentation only and never replace server authorization.
- Keep GHS and non-GHS currency support through existing minor-unit values and shared/`Intl.NumberFormat` presentation.
- Do not add another generic `workspace-polish` override layer. New styles are route/workspace scoped and consume existing `--tos-*` tokens.
- No new animation dependency; honor `prefers-reduced-motion`.

## Review Focus

1. **Offline saved vs unavailable:** Money/Stock/Purchases distinguish cached usable data from unavailable data and never imply pending local mutations are server-posted.
2. **Viewer/Cashier/Inventory/Accountant role differences:** read-only roles retain useful data; terms, adjustments/transfers/reconciliation, receiving and supplier payments stay role-safe.
3. **Zero/negative/large/non-GHS values:** balances remain signed/readable and never overflow phone surfaces.
4. **No-threshold inventory:** zero/negative availability may be flagged as out of stock; positive stock is never labelled low without server evidence.
5. **Durable procurement actions:** receive/pay/return flows clear or close only after local durable enqueue; applied/pending/rejected sync state remains explicit.

---

## File Structure

### Shared procurement read layer
- Create `apps/web/app/components/procurement/procurement-types.ts` — `Supplier`, `InventoryItem`, `PurchaseSummary`, `ProcurementSnapshot`.
- Create `apps/web/app/components/procurement/procurement-model.ts` and `.test.ts` — pure Stock/Purchases presentation helpers.
- Create `apps/web/app/components/procurement/use-procurement-data.tsx` and `.test.tsx` — current three-endpoint cached read/session-refresh orchestration.

### Money
- Create `apps/web/app/components/money/money-model.ts` and `.test.ts`.
- Create `apps/web/app/components/money/money-workspace.tsx` and `.test.tsx`.
- Create `apps/web/app/money-workspace.css`.
- Modify `/cashbook`, `cashbook-expenses.tsx`, focused `cashbook/*`, and `treasury.tsx` only where composition hooks are required.

### Stock
- Create `apps/web/app/components/inventory/inventory-workspace.tsx` and `.test.tsx`.
- Create `apps/web/app/inventory-workspace.css`.
- Modify `/inventory`.

### Purchases
- Create `apps/web/app/components/procurement/purchases-workspace.tsx` and `.test.tsx`.
- Extract supplier create/terms/payment, purchase receipt/history/return into focused `components/procurement/` files.
- Create `apps/web/app/purchases-workspace.css`.
- Modify `/purchases`.
- Delete `components/purchases-inventory.tsx` only after both new routes are unreferenced from it and characterization tests pin its mutation contracts.

### Composition / global
- Modify `apps/web/app/layout.tsx` for scoped imports.
- Modify `apps/web/app/components/workspace/route-composition.test.tsx` to require the three new workspaces and prohibit legacy combined route composition.
- Retain old route CSS only while extracted subcomponents still require it; remove dead responsibility after migration.

---

### Task 1: Procurement read model and shared data source

**Files:** `components/procurement/procurement-types.ts`, `procurement-model.ts`, `procurement-model.test.ts`, `use-procurement-data.tsx`, `use-procurement-data.test.tsx`.

**Interfaces:**
- `buildInventoryOverview(items: readonly InventoryItem[]): InventoryOverview`
- `filterInventory(items: readonly InventoryItem[], query: string): InventoryItem[]`
- `buildProcurementOverview(suppliers: readonly Supplier[], purchases: readonly PurchaseSummary[]): ProcurementOverview`
- `useProcurementData({ businessId, branchId }): { suppliers; inventory; purchases; source; message; reload }`, `source: "live" | "cached" | "unavailable"`

- [ ] **Step 1: Write failing pure-model tests.** Assert tracked count, sum of server-provided inventory values, out-of-stock count, quarantine/damaged quantities, high-value ordering, supplier payable/credit split, recent purchases, search by name/SKU, and that positive stock is not called low without threshold data.
- [ ] **Step 2: Run `pnpm --filter @tradeos/web exec vitest run app/components/procurement/procurement-model.test.ts`; expect RED because the module is absent.**
- [ ] **Step 3: Implement the minimal types/helpers; aggregate display-only server fields and never derive valuation/conversion costs.**
- [ ] **Step 4: Re-run the focused test; expect GREEN.**
- [ ] **Step 5: Commit `feat(web): add procurement presentation model`.**
- [ ] **Step 6: Write failing data-hook tests pinning `/suppliers`, `/inventory`, `/purchases`, feature-cache business/branch scope, session epoch guard, cached/unavailable offline state, and mutation-applied refresh types.**
- [ ] **Step 7: Run the focused hook test; expect RED because the hook is absent.**
- [ ] **Step 8: Move the existing read/cache orchestration from `PurchasesInventory` into `useProcurementData` without changing endpoints.**
- [ ] **Step 9: Run procurement hook/model tests and relevant existing web tests; expect GREEN.**
- [ ] **Step 10: Commit `refactor(web): share procurement read state`.**

### Task 2: Decision-first Money workspace

**Files:** `components/money/money-model.ts`, `.test.ts`, `money-workspace.tsx`, `.test.tsx`, `money-workspace.css`, `/cashbook/page.tsx`, focused existing Cashbook/Treasury files.

**Interfaces:**
- `buildMoneyOverview({ summary, totals, accounts, queued, failed }): MoneyOverview`
- `MoneyWorkspace({ businessId, branchId, currencyCode, role })`
- Existing `EXPENSE_CREATE`, `CASHBOOK_ADJUSTMENT_CREATE`, `MONEY_TRANSFER_CREATE`, `MONEY_RECONCILIATION_CREATE`, `MONEY_RECONCILIATION_RESOLVE` payloads remain unchanged.

- [ ] **Step 1: Write failing model tests.** Pass through authoritative inflow/outflow/net, group posted account balances by method for presentation, preserve negative balances, surface queue/failure counts, support non-GHS.
- [ ] **Step 2: Confirm RED, implement the model, confirm GREEN, commit `feat(web): add Money operating model`.**
- [ ] **Step 3: Write failing workspace tests.** Require first-view available money, today inflow/outflow, `Record expense`, `Receive money`, `Transfer`, recent movements, progressive Treasury/reconciliation, sync state, 48px phone actions, safe-area handling, and read-only role behavior.
- [ ] **Step 4: Pin `Receive money` semantics in the test:** customer collections navigate to the existing `/customers` collection workflow; owner/opening funds use existing adjustment reasons only for roles already allowed to adjust. Never create an untyped generic inflow mutation.
- [ ] **Step 5: Confirm RED.**
- [ ] **Step 6: Implement `MoneyWorkspace` by reorganizing existing Cashbook/Treasury data/actions into decision-first + progressive surfaces without changing server summary math or mutation payloads.**
- [ ] **Step 7: Replace `/cashbook` composition and add scoped responsive styles.**
- [ ] **Step 8: Run Money-focused + existing Cashbook/Treasury tests; expect GREEN.**
- [ ] **Step 9: Commit `feat(web): redesign Money workspace`.**

### Task 3: Stock home workspace

**Files:** `components/inventory/inventory-workspace.tsx`, `.test.tsx`, `inventory-workspace.css`, `/inventory/page.tsx`.

**Interfaces:** Consumes `useProcurementData` and `buildInventoryOverview`; exports `InventoryWorkspace({ businessId, branchId, currencyCode, role })`.

- [ ] **Step 1: Write failing Stock tests.** Require tracked count, server inventory value, out-of-stock exceptions, quarantine/damaged context, highest-value items, name/SKU search, recent receipts, and `Receive stock` link to `/purchases` only for current receive-capable roles.
- [ ] **Step 2: Assert a positive-availability item is not labelled low stock and no reorder quantity is fabricated.**
- [ ] **Step 3: Confirm RED.**
- [ ] **Step 4: Implement Stock home + responsive rows/lists; do not calculate thresholds, sales velocity or reorder recommendations.**
- [ ] **Step 5: Replace `/inventory` composition.**
- [ ] **Step 6: Run Stock + procurement model/hook tests; expect GREEN.**
- [ ] **Step 7: Commit `feat(web): ship Stock operating workspace`.**

### Task 4: Professional Purchases workspace

**Files:** `components/procurement/purchases-workspace.tsx`, `.test.tsx`, focused extracted procurement mutation components, `purchases-workspace.css`, `/purchases/page.tsx`.

**Interfaces:** Consumes procurement hook/model. Preserves `PURCHASE_RECEIVE_CREATE`, `SUPPLIER_PAYMENT_CREATE`, `PURCHASE_RETURN_CREATE`; supplier create/patch stay current online API writes. Exports `PurchasesWorkspace({ businessId, branchId, currencyCode, role, catalog })`.

- [ ] **Step 1: Add characterization tests before extraction.** Assert receipt lines submit only item/purchase unit/quantity/unit cost; settlement methods include immediate methods + `SUPPLIER_CREDIT`; supplier payment cannot exceed payable; purchase return submits original purchase-line id, quantity and source location.
- [ ] **Step 2: Confirm characterization tests GREEN against current behavior.**
- [ ] **Step 3: Write failing Purchases workspace tests.** Require supplier/payable summary, primary `Receive stock`, supplier context/search, recent receipts, progressive supplier/payment/return actions, phone-native surfaces, role-safe read-only behavior and durable pending/rejected status.
- [ ] **Step 4: Confirm RED.**
- [ ] **Step 5: Extract existing mutation flows into focused components without changing payload semantics. Remove `convertQuantity` from the UI; only same-unit quantity may be shown directly, otherwise show `Server converts after sync`.**
- [ ] **Step 6: Implement `PurchasesWorkspace` + responsive styles. Receipt flow order: supplier → lines → settlement/reference → durable receive result; unrelated administration stays secondary.**
- [ ] **Step 7: Replace `/purchases` composition.**
- [ ] **Step 8: Run Purchases UI tests plus existing API purchase/inventory and purchase-return integration tests in the repository full test gate; expect GREEN.**
- [ ] **Step 9: Commit `feat(web): ship professional Purchases workspace`.**

### Task 5: Retire combined legacy composition

**Files:** `route-composition.test.tsx`, `layout.tsx`, legacy `purchases-inventory.tsx` / dead CSS.

**Interfaces:** `/cashbook` → `MoneyWorkspace`; `/inventory` → `InventoryWorkspace`; `/purchases` → `PurchasesWorkspace`.

- [ ] **Step 1: Write failing composition/dead-code tests requiring the three workspaces and prohibiting route imports of `PurchasesInventory`.**
- [ ] **Step 2: Confirm RED if legacy composition remains.**
- [ ] **Step 3: Remove the unreferenced combined component and dead CSS responsibility.**
- [ ] **Step 4: Run web tests/typecheck; expect GREEN.**
- [ ] **Step 5: Commit `refactor(web): retire legacy money stock procurement composition`.**

### Task 6: Full regression, responsive acceptance and stacked integration

- [ ] **Step 1: Run `pnpm --filter @tradeos/web test`.**
- [ ] **Step 2: Run `pnpm typecheck && pnpm lint`.**
- [ ] **Step 3: Run `pnpm --filter @tradeos/web build`.**
- [ ] **Step 4: Run `pnpm test`.**
- [ ] **Step 5: Verify 360, 390/393, 430, 768, 1024, 1280, 1440 for OWNER, CASHIER, INVENTORY, ACCOUNTANT, VIEWER as relevant: no page overflow, no tiny normal labels, >=48px critical phone controls, safe areas, truthful offline states.**
- [ ] **Step 6: Verify business/branch changes reset scoped data and stale async responses cannot cross session/business boundaries.**
- [ ] **Step 7: Verify existing Cashbook/Treasury totals, Inventory server values, purchase receiving, supplier credit/payment and purchase returns via the full API integration suite.**
- [ ] **Step 8: Create stacked PR `feat/tradeos-money-stock-purchases` → `feat/tradeos-crud-pos-architecture`; squash only after exact final head passes migrations, typecheck, lint, whitespace, full tests, production build and authenticated sync smoke.**
- [ ] **Step 9: After squash, verify the architecture-branch squash commit with a fresh complete CI run; PR #33 then automatically carries the slice toward `main`.**

## Self-Review Result

- Spec coverage: Money §11 and Stock/Purchases §12 are mapped; Product Detail remains deliberately out of this route-home slice because no detail route/threshold/velocity contract exists yet.
- Type consistency: Stock and Purchases share one `ProcurementSnapshot`/hook; Money remains separate from procurement state.
- Domain safety: no new financial/inventory formula is introduced; the existing client purchase conversion preview is explicitly removed rather than propagated.
- Review-focus coverage: each of the five failure classes is pinned to Tasks 1–4 and final acceptance.
- Execution: Native, continuing in this session per the owner’s standing project instruction.
