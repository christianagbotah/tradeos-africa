# TradeOS Professional Sell/POS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace QuickSale with a professional customer-aware, editable-cart, phone-first POS while preserving server-authoritative pricing, customer credit rules and durable offline sales.

**Architecture:** Build a pure cart/customer/payment state model first, then compose a responsive POS around it. Reuse the existing `SALE_CREATE` sync mutation and backend pricing/credit logic; the client only manages pre-posting interaction state and never invents accounting values or conversions.

**Tech Stack:** TypeScript, Next.js 16, React 19, Fastify, PostgreSQL 18, Vitest, existing TradeOS offline sync and design foundation.

**Spec:** `docs/superpowers/specs/2026-10-08-tradeos-crud-pos-design.md`

**Depends on:** `docs/superpowers/plans/2026-10-08-tradeos-catalog-lifecycle-crud.md` Slice A merged/green because Sell consumes authoritative catalog lifecycle state and TradeOS 2 Catalog types.

## Global Constraints

- Every new sale defaults to Walk-in; Walk-in is UI state only and sends no `customerId`.
- Any active named customer may be attached to Cash, MoMo, Card, Bank, Other or Customer Credit sales.
- Customer Credit requires active named customer, credit enabled, sufficient available credit, currency compatibility and existing server validation.
- Same `itemId + saleUnitCode` increments one cart line; different sale unit is a distinct cart line.
- Quantity > 0 only; fractional quantities remain allowed where server/catalog units support them.
- Displayed catalog price is for responsiveness only; the server remains authoritative at sale posting.
- No manual discount/price-override redesign in this slice.
- Offline sale remains durable/idempotent through existing `SALE_CREATE` queue.
- Cart clears only after durable local enqueue succeeds.
- Inactive catalog items/customers cannot be selected for new sales.
- Mobile controls >=48px, icon-only >=44x44px, no 360px horizontal overflow.

## Review Focus

1. Cash/MoMo sale with named customer: must send `customerId` and remain fully paid, without accidentally creating credit debt.
2. Walk-in + Customer Credit: checkout must block or switch to immediate payment; never send unsecured credit.
3. Quantity/unit edits: exact `itemId`, `saleUnitCode`, quantity payload must reflect the visible cart and distinct units must never collapse together.
4. Offline completion: durable enqueue clears cart and shows pending sync; rejected sync remains reviewable and must not be shown as synchronized.
5. Rapid product/customer changes on mobile: focus, sheets, sticky Charge bar and cart state must remain usable at 360px without tiny controls or lost selection.

---

## File Structure

**Create**
- `apps/web/app/components/pos/pos-model.ts` — pure cart/customer/payment state helpers.
- `apps/web/app/components/pos/pos-model.test.ts` — cart identity/quantity/customer/payment unit tests.
- `apps/web/app/components/pos/pos-workspace.tsx` — responsive Sell composition and posting orchestration.
- `apps/web/app/components/pos/product-browser.tsx` — search/filter/select sellable product/service units.
- `apps/web/app/components/pos/customer-picker.tsx` — Walk-in + named customer search sheet/panel.
- `apps/web/app/components/pos/cart-panel.tsx` — editable cart rows, quantity/unit/remove controls.
- `apps/web/app/components/pos/checkout-sheet.tsx` — payment method and final charge flow.
- `apps/web/app/components/pos/pos-workspace.test.tsx` — interaction/accessibility/offline tests.
- `apps/web/app/pos.css` — responsive phone/tablet/desktop POS layout.

**Modify**
- `apps/web/app/components/workspace/workspace-provider.tsx` — expose richer sellable unit metadata required by POS, still derived from active catalog only.
- `apps/web/app/components/workspace/workspace-provider.test.tsx` — multiple sell-unit and archived-item projection tests.
- `apps/web/app/lib/workspace-types.ts` — optional quantity-step/unit metadata only if server/catalog model already supports it; do not invent semantics.
- `apps/web/app/(workspace)/sell/page.tsx` — render `PosWorkspace`.
- `apps/web/app/layout.tsx` — import `pos.css`.
- `apps/web/app/components/workspace/route-composition.test.tsx` — pin new Sell composition.
- `apps/api/test/sync-commerce.integration.test.ts` — immediate named-customer association and credit regression tests.
- `apps/api/src/commerce/sales.ts` — only if tests reveal customer association currently restricted incorrectly; preserve authoritative price/credit behavior.

## Task 1: Pure cart/customer/payment state model

**Interfaces**
- `type PosLineKey = `${string}:${string}`` from `itemId:saleUnitCode`.
- `addCartItem(cart, item): CartLine[]`.
- `setCartQuantity(cart, key, quantity): CartLine[]` where quantity <= 0 removes only through explicit remove helper; direct invalid input remains rejected by UI.
- `changeCartUnit(cart, lineKey, nextUnit): CartLine[]` and merge if target `itemId + nextUnitCode` already exists.
- `removeCartLine(cart, key): CartLine[]`.
- `normalizeCustomerPayment(customer, paymentMethod)` enforces Walk-in/credit constraint.

- [ ] **Step 1: Write failing `pos-model.test.ts`** for add same unit increments, different unit creates separate line, direct quantity change, fractional quantity, invalid zero/negative rejection, remove, unit switch/merge, Walk-in default and Walk-in-credit guard.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/web exec vitest run app/components/pos/pos-model.test.ts`; verify RED.
- [ ] **Step 3: Implement `pos-model.ts`** as pure functions with no React/network dependencies.
- [ ] **Step 4: Run** focused test + web typecheck; expect PASS.
- [ ] **Step 5: Commit** `feat(pos): add deterministic cart and customer state model`.

## Task 2: Backend proof for named customers on immediate-payment sales

**Interfaces**
- Existing `SaleMutationPayload.customerId?: string` remains the contract.
- Immediate payment + active named customer writes `sales.customer_id` but no customer credit ledger entry unless payment includes `CUSTOMER_CREDIT`.

- [ ] **Step 1: Add API integration tests** creating an active customer then posting CASH and MOMO sales with `customerId`; assert sale row customer association and zero credit balance delta.
- [ ] **Step 2: Add regression tests** that Walk-in omits customer ID, inactive named customer rejects, credit sale without customer rejects, named cash sale is allowed even if customer has no credit limit.
- [ ] **Step 3: Run** isolated API test command and verify current behavior; if GREEN, do not change production server code unnecessarily.
- [ ] **Step 4: If RED, minimally adjust `apps/api/src/commerce/sales.ts`** so customer validation applies to any supplied customer while credit-specific validation runs only for credit amount.
- [ ] **Step 5: Rerun** API tests + API typecheck; expect PASS.
- [ ] **Step 6: Commit** `test(api): guarantee customer-aware immediate sales` if no code change, otherwise `fix(api): support named customers on immediate sales`.

## Task 3: Customer picker independent of payment method

**Interfaces**
- `CustomerPicker({ businessId, currencyCode, selectedCustomer, role, open, onSelect, onWalkIn, onClose })`.
- Active customer search uses `/v1/customers?businessId=...&query=...&limit=200`.
- Walk-in is always first/default.
- “Add customer” shortcut appears only for existing customer-write roles; actual creation can use current customer UI path/sheet until Slice C unifies it.

- [ ] **Step 1: Write failing POS UI tests** for Walk-in default, open picker, search name/phone, choose active customer for CASH, switch back to Walk-in, inactive not selectable, and credit details shown only when relevant.
- [ ] **Step 2: Run** focused POS test and verify RED.
- [ ] **Step 3: Implement `customer-picker.tsx`** with accessible mobile sheet/desktop panel behavior, loading/error state that does not block Walk-in cash selling, and role-safe Add customer shortcut.
- [ ] **Step 4: Implement focus rules**: focus search on open, Escape close, Tab containment in sheet mode, restore trigger focus.
- [ ] **Step 5: Run** focused tests + typecheck; expect PASS.
- [ ] **Step 6: Commit** `feat(pos): add walk-in and named customer picker`.

## Task 4: Product browser and editable cart

**Interfaces**
- `ProductBrowser({ items, query, onQueryChange, onAdd })` searches name, SKU when available, and sell-unit label.
- `CartPanel({ cart, onIncrease, onDecrease, onSetQuantity, onRemove, onChangeUnit })`.
- Each row shows item/service, selected unit, display unit price, quantity, line display total and stock context when data exists.

- [ ] **Step 1: Write failing UI tests** for name search, adding item, incrementing same line, multiple units, +/- buttons, direct numeric input, remove, and unit change.
- [ ] **Step 2: Add accessibility assertions** for 44px icon targets, quantity input label, remove accessible name, no hidden tiny controls.
- [ ] **Step 3: Run** focused tests and verify RED.
- [ ] **Step 4: Implement `product-browser.tsx` and `cart-panel.tsx`** using the pure model; do not compute stock/accounting conversions client-side.
- [ ] **Step 5: Update workspace sellable projection** to retain all active sell units and any existing SKU/stock metadata available without extra accounting logic.
- [ ] **Step 6: Run** POS + workspace tests and typecheck; expect PASS.
- [ ] **Step 7: Commit** `feat(pos): add searchable catalog and editable cart`.

## Task 5: Checkout/payment sheet and durable posting

**Interfaces**
- Supported methods mirror backend: `CASH | MOMO | CARD | BANK | OTHER | CUSTOMER_CREDIT`.
- `buildSaleMutation(...)` includes `customerId` whenever named customer selected, regardless of payment method; omits it for Walk-in.
- `lines` use visible `itemId`, `saleUnitCode`, `quantity` only; no client price override.

- [ ] **Step 1: Write failing tests** for Cash/MoMo/Card/Bank/Other methods, named immediate customer payload, Walk-in payload no customer, credit named-customer requirement, insufficient credit disabled, and exact quantity/unit payload.
- [ ] **Step 2: Write offline tests**: enqueue success clears cart + shows `Saved offline · pending sync`; enqueue failure does not lose cart; sync rejection shows needs-review, not synchronized.
- [ ] **Step 3: Run** focused test and verify RED.
- [ ] **Step 4: Implement `checkout-sheet.tsx` and posting orchestration** using `enqueueMutation`, `getOrCreateClientId`, `flushPendingMutations`; preserve current idempotent `SALE_CREATE` path.
- [ ] **Step 5: Ensure cart reset occurs immediately after durable enqueue**, not after remote server success; preserve rejected mutation in existing failed queue.
- [ ] **Step 6: Run** focused tests + offline-sync tests + typecheck; expect PASS.
- [ ] **Step 7: Commit** `feat(pos): add complete payment and offline checkout flow`.

## Task 6: Professional responsive POS composition

**Interfaces**
- `PosWorkspace({ businessId, branchId, currencyCode, role, items })`.
- Mobile hierarchy: customer row -> search/browser -> cart summary -> sticky Charge -> checkout sheet.
- Desktop >=1100px: product browser left; sticky current-customer/cart/checkout right.

- [ ] **Step 1: Write failing composition/source tests** proving route uses `PosWorkspace`, sticky `Charge` action exists, desktop two-pane classes exist, QuickSale is no longer route composition.
- [ ] **Step 2: Implement `pos-workspace.tsx`** composing Tasks 1–5 and replacing the old `QuickSale` experience rather than wrapping it.
- [ ] **Step 3: Add `pos.css`** for 360/390/430, 768/1024, 1280/1440; no overflow, large readable total, cart accessible without scrolling full product list, safe-area padding for sticky mobile action.
- [ ] **Step 4: Update `(workspace)/sell/page.tsx`, `layout.tsx`, route tests**; keep old `quick-sale.tsx` only until all tests/references are removed, then delete it in this task.
- [ ] **Step 5: Run** POS tests, route tests, web typecheck; expect PASS.
- [ ] **Step 6: Commit** `feat(web): replace QuickSale with professional TradeOS POS`.

## Task 7: Slice B regression and UAT

- [ ] **Step 1: Run** `pnpm --filter @tradeos/web test`.
- [ ] **Step 2: Run** isolated full API/repository tests using `DATABASE_URL=postgresql://tradeos@127.0.0.1:55432/tradeos_ci pnpm test`.
- [ ] **Step 3: Run** `pnpm typecheck && pnpm lint && pnpm --filter @tradeos/web build && git diff --check`.
- [ ] **Step 4: Manual role UAT** for OWNER, CASHIER, SALES, STAFF at required widths; verify customer selection, units, fractional/integer quantities, payment methods, offline pending, rejected sync review, keyboard/focus.
- [ ] **Step 5: Verify archived item/customer cannot be selected** while historical transactions still render.
- [ ] **Step 6: Commit only required hardening** as `fix(pos): harden professional selling workflow`.
- [ ] **Step 7: Record final Slice B SHA and clean worktree** before Slice C.
