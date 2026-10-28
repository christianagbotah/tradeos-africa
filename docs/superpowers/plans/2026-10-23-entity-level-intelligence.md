# TradeOS Entity-Level Intelligence Implementation Plan

**Goal:** Give tenant users authoritative, record-specific intelligence for inventory items, customers, suppliers and purchases, with structured Ask TradeOS context and no economic mutation.

**Architecture:** Shared contracts + a deterministic entity evidence service/route + shared record-level UI panel. Ask TradeOS accepts the same validated entity context and grounds the model using server-selected entity evidence.

**Spec:** `docs/superpowers/specs/2026-10-23-entity-level-intelligence-design.md`

## Constraints
- No N+1 intelligence fetches from lists.
- No AI mutation of payment/refund/sale/purchase/return/stock/access/staff data.
- All entity ownership and branch scope validated server-side.
- Financial evidence remains role-gated.
- Client cannot choose database tools or arbitrary source types.
- Deterministic entity intelligence works without the AI provider.

### Task 1: Entity intelligence contracts and selector utilities
Files:
- Modify `packages/contracts/src/business-intelligence.ts`
- Add focused contract tests

- [ ] Add failing tests for supported entity context and deterministic response shape.
- [ ] Add `BusinessEntityType`, `BusinessEntityContext`, `BusinessEntityIntelligence` and optional query context.
- [ ] Run contracts build/typecheck/tests.
- [ ] Commit.

### Task 2: Server-side entity evidence collector
Files:
- Create `apps/api/src/business-intelligence/entity-service.ts`
- Create `apps/api/test/business-entity-intelligence.integration.test.ts`
- Reuse/extend `intelligence-tools.ts` only where shared primitives are genuinely reusable.

- [ ] RED integration tests for CATALOG_ITEM/CUSTOMER/SUPPLIER/PURCHASE.
- [ ] Pin tenant and branch isolation, safe not-found behavior and financial-role filtering.
- [ ] Implement repeatable-read/read-only bounded evidence queries.
- [ ] Match attention by evidence entity type/id and emit navigation-only recommendations.
- [ ] GREEN focused tests + API typecheck.
- [ ] Commit.

### Task 3: Entity route and contextual Ask TradeOS grounding
Files:
- Modify `apps/api/src/business-intelligence/routes.ts`
- Modify `apps/api/src/business-intelligence/query-service.ts`
- Add/modify API route/query tests.

- [ ] RED tests for GET entity route, unsupported types, wrong tenant/branch, and structured query context.
- [ ] Add route parsing/validation.
- [ ] When query context is present, call validated entity evidence collector and ground provider on that evidence.
- [ ] Ensure client `tools` remains rejected and context cannot bypass role scope.
- [ ] GREEN + API typecheck.
- [ ] Commit.

### Task 4: Shared EntityIntelligencePanel
Files:
- Create `apps/web/app/components/intelligence/entity-intelligence-panel.tsx`
- Add CSS to `apps/web/app/intelligence.css`
- Add contract tests.

- [ ] RED panel tests for one fetch-on-open, loading/error/offline/evidence/attention states and button safety.
- [ ] Implement one reusable panel using session business/branch scope.
- [ ] Dispatch structured `{ question, context }` through `tradeos:ask`.
- [ ] Keep recommendations navigation-only.
- [ ] GREEN + Web typecheck.
- [ ] Commit.

### Task 5: Structured context through global Ask TradeOS
Files:
- Modify `ask-tradeos-drawer.tsx`
- Modify `app-shell.tsx`
- Modify intelligence contract tests.

- [ ] RED tests proving event context is validated/stored and query body sends `context`.
- [ ] Add `initialContext`, clear context for normal top-bar Ask TradeOS, clear on route/context close as appropriate.
- [ ] Preserve contextual question behavior and offline semantics.
- [ ] GREEN.
- [ ] Commit.

### Task 6: Embed in four detail surfaces
Files:
- `inventory-adjustment-sheet.tsx`
- `customers/customer-sheet.tsx`
- `purchases/supplier-sheet.tsx`
- `purchases/purchase-detail-sheet.tsx`
- workspace contract tests

- [ ] RED tests: panel absent from list rows, present in opened detail components with correct entity type/id.
- [ ] Mount after read-only hero/stats and before mutation controls.
- [ ] Inventory embedding button must remain `type="button"` inside outer form.
- [ ] GREEN + responsive contract tests.
- [ ] Commit.

### Task 7: Full verification and review
- [ ] API focused + full tests.
- [ ] Web full tests.
- [ ] contracts/API/Web typecheck/build.
- [ ] safety grep for forbidden mutation calls in new entity intelligence files.
- [ ] `git diff --check`.
- [ ] systematic code review; fix Critical/Important findings.
- [ ] push PR #92 head and verify CI/Visual QA before declaring complete.

### Phase B (separate follow-up)
Report-metric intelligence for SALES/GROSS_MARGIN/CASH/RECEIVABLES/PAYABLES/INVENTORY with explicit report range. Do not force this symbolic context into Phase A UUID record validation.
