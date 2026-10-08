# TradeOS Transaction Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship professional, permission-safe Sales/Returns/Purchases/Inventory operations without allowing posted transaction history to be silently edited or deleted.

**Architecture:** Keep existing accounting engines authoritative and decompose the web monoliths into focused transaction workspaces. Add only missing domain mutations (inventory adjustments and exchanges) through the existing durable sync pipeline, with audit/idempotency and derived balances.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Fastify, PostgreSQL, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-08-tradeos-transaction-operations-design.md`

## Global Constraints
- Posted sales/purchases are immutable; corrections are event workflows.
- UI and API permissions must agree; VIEWER is read-only.
- Server owns price, stock, COGS, valuation, tax and money calculations.
- Offline mutations are durable/idempotent and rejected mutations remain visible.
- 48px minimum primary touch targets; 15–16px normal text.
- No browser prompt/alert transaction management.

## Review Focus
- Repeated/offline replay must never duplicate refunds, exchanges, purchase returns or stock adjustments.
- Concurrent returns/adjustments must not over-return or consume more source stock than exists.
- Pending MoMo/card/bank refunds must remain processing until confirmed.
- Walk-in exchange must work without manufacturing a customer-credit account.
- Archived items/suppliers remain readable in historical transaction details while blocked from new activity.

---

### Task 1: Professional Sales History Workspace
**Files:** create focused `components/sales/*`; modify `sales-returns.tsx`, `sales-returns.css`; test sales workspace/detail composition.
**Interfaces:** consumes current `/v1/sales` and `/v1/sales/:id`; produces `SalesWorkspace` and `SaleDetailSheet`.
- [ ] Write RED tests for search/filter command row, immutable receipt detail, Walk-in/named customer, payment/refund statuses, role-safe correction actions and mobile controls.
- [ ] Run focused web tests and confirm RED.
- [ ] Split sales list/detail from the monolith and implement professional responsive UI without changing posted sale data.
- [ ] Run full web tests/typecheck/lint and commit.

### Task 2: Real Return/Refund Workspace
**Files:** create `components/returns/*`; retire `returns-panel.tsx`; modify route composition and styles; tests.
**Interfaces:** consumes Sale detail snapshots and existing `RETURN_CREATE`; produces `ReturnRefundSheet` with disposition/refund preview and pending-provider state.
- [ ] RED-test removal of static example return UI and require real-sale-backed workflow.
- [ ] Implement return/refund sheet and preserve durable offline queue semantics.
- [ ] Add failed-sync/rejection guidance and processing-state copy.
- [ ] Verify web/full CI and commit.

### Task 3: Professional Purchase Receiving + Detail
**Files:** split `purchases-inventory.tsx` into `components/purchases/*`; modify CSS/tests.
**Interfaces:** consumes supplier/catalog projections and `PURCHASE_RECEIVE_CREATE`; produces `PurchaseWorkspace`, `PurchaseReceiptBuilder`, `PurchaseDetailSheet`.
- [ ] RED-test editable draft lines (quantity/unit/cost/remove), supplier/payment/account context, immutable posted detail and mobile controls.
- [ ] Implement builder/detail without moving stock math client-side.
- [ ] Preserve purchase-return correction path and offline queue.
- [ ] Verify and commit.

### Task 4: Inventory Movement Read Model
**Files:** extend inventory read API and create `components/inventory/*`; tests.
**Interfaces:** produces inventory item detail with recent movements by location/reason/reference/actor plus derived balances.
- [ ] RED API tests for tenant/branch isolation and movement history.
- [ ] Implement read endpoint and focused inventory workspace/detail sheet.
- [ ] Verify and commit.

### Task 5: Inventory Adjustment Engine
**Files:** create commerce inventory-adjustment service; modify sync/app authorization/contracts; DB migration only if adjustment metadata cannot use existing movement/audit tables; API tests.
**Interfaces:** mutation `INVENTORY_ADJUSTMENT_CREATE` with itemId, sourceLocation?, destinationLocation?, quantity, reasonCode, note?; result adjustmentId and resulting location balances.
- [ ] RED integration tests for roles, actor injection, idempotency, source sufficiency, valuation preservation, tenant/branch isolation and audit.
- [ ] Implement transactional adjustment/reclassification using inventory movements + valuation under row/advisory locks.
- [ ] Wire durable sync and error codes.
- [ ] Full CI and commit.

### Task 6: Inventory Adjustment UX
**Files:** inventory adjustment sheet/workspace/offline tests/CSS.
**Interfaces:** consumes Task 5 mutation and Task 4 movement read model.
- [ ] RED-test Count correction / Quarantine / Damage / Waste actions, required reason, preview, 48px controls and permission hiding.
- [ ] Implement sheet and durable queue; never expose direct balance editing.
- [ ] Surface rejected adjustments for review.
- [ ] Verify and commit.

### Task 7: Exchange Domain Engine
**Files:** contracts, migration for exchange linkage/case if needed, commerce exchange service, sync/app authorization, integration tests.
**Interfaces:** mutation `EXCHANGE_CREATE`: originalSaleId, returned lines/dispositions, replacement lines/units/quantities, settlement/refund method, reason. Produces exchangeCaseId, replacementSaleId, returnCaseId, netDifferenceMinor, status.
- [ ] RED tests for walk-in and named customers, over-return prevention, server repricing, replacement stock, return disposition, positive/negative/zero price difference, idempotency and audit linkage.
- [ ] Implement atomic exchange using shared sale/return primitives rather than editing either transaction.
- [ ] Wire sync and role authority.
- [ ] Full CI and commit.

### Task 8: Exchange UX
**Files:** exchange sheet under returns, sales detail action integration, tests/CSS.
**Interfaces:** consumes Task 7 mutation plus current catalog projection.
- [ ] RED-test return selection + replacement cart + difference preview + payment/refund selector + Walk-in behavior.
- [ ] Implement desktop/mobile professional exchange flow with durable queue.
- [ ] Show resulting linked receipt/correction state.
- [ ] Verify and commit.

### Task 9: Transaction Operations Consistency
**Files:** shared transaction status/action primitives; integrate Sales, Returns, Purchases, Inventory; tests.
**Interfaces:** consistent pending/applied/needs-review badges, actor/reason copy, read-only posted history language.
- [ ] RED-test consistency and role hiding across all four workspaces.
- [ ] Implement shared presentation only; keep domain forms purpose-built.
- [ ] Verify and commit.

### Task 10: Final Acceptance
- [ ] Run clean migration validation, repo typecheck, lint, whitespace, full tests, production build and authenticated sync smoke.
- [ ] Verify historical sale/purchase records have no edit/delete surface or route.
- [ ] Verify 360/390/768/1440 responsive contracts; run browser UAT if an engine is available.
- [ ] Self-review full branch, push PR, merge only when exact-head CI is green, then verify merged `main` SHA.
