# TradeOS Master-Data Lifecycle Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the permission-aware lifecycle architecture to customers, suppliers, expense categories and money accounts so every existing business master-data surface supports professional edit/archive/reactivate behavior with optimistic concurrency, audit and consistent UX.

**Architecture:** Reuse the lifecycle contracts/capability patterns introduced by Catalog, add revision-aware service functions to existing customer/supplier/cashbook/treasury modules, and progressively replace ad-hoc editing controls with entity-specific TradeOS sheets/actions. Historical financial records remain immutable; physical delete is avoided unless explicitly proven safe by domain rules.

**Tech Stack:** TypeScript, Next.js 16, React 19, Fastify, PostgreSQL 18, Vitest, TradeOS sync queue/design foundation.

**Spec:** `docs/superpowers/specs/2026-10-08-tradeos-crud-pos-design.md`

**Depends on:** Slice A lifecycle contracts/patterns and Slice B POS customer-selection behavior.

## Global Constraints

- Existing role sets remain authoritative; UI never exposes an action direct API would reject.
- Customer general create/edit uses existing customer-write roles; credit limit/terms/activation use existing credit-control roles only.
- Supplier general create/edit/archive/reactivate uses existing supplier-write roles; payment terms use existing supplier-terms roles only.
- Expense-category lifecycle follows current cashbook administration permissions; system categories may not be physically deleted.
- Money-account create/edit/activate/deactivate follows treasury permissions; accounts with financial history are never physically deleted.
- Customers/suppliers with historical financial/transaction references are never physically deleted in this program.
- `updatedAt` revision token is mandatory for migrated edits; stale writes return 409 `STALE_VERSION`.
- Add `created_at`/`updated_at` to expense categories and `updated_at` to money-account default mappings because those current records lack a usable revision token.
- Audit meaningful lifecycle changes with actor, entity, changed fields and safe before/after delta.
- Offline queue may support deterministic create/profile edits; history/default-sensitive deactivation remains online where server validation is required.
- Posted transactions remain immutable; corrections use existing return/refund/adjustment/reconciliation workflows.

## Review Focus

1. CASHIER/SALES editing customer profile vs credit controls: profile writes may succeed where allowed, but credit limit/terms/status controls must remain hidden/403.
2. Supplier deactivation with open payable: must block new purchases while historical obligations remain payable/readable.
3. Expense-category stale edit/system category behavior: must reject stale revision and never allow unsafe physical deletion of seeded/system categories.
4. Money-account deactivation when configured as default or with constraints: existing treasury guard must remain authoritative and UI must explain replacement/default requirement.
5. Offline queued profile edit conflict: must preserve failed mutation and prompt reload/review instead of last-write-wins.

---

## File Structure

**Create**
- `packages/db/migrations/0014_master_data_revisions.sql` — add `created_at`/`updated_at` to expense categories, add `updated_at` to money-account default mappings, and add only the revision-supporting indexes needed by this slice.
- `apps/api/src/customer-service.ts` — revision-aware customer create/update/status logic and audit delta.
- `apps/api/src/supplier-service.ts` — revision-aware supplier create/update/status logic and audit delta.
- `apps/web/app/components/customers/customer-workspace.tsx` — professional customer management composition.
- `apps/web/app/components/customers/customer-sheet.tsx` — customer edit/detail sheet with permission-separated credit fields.
- `apps/web/app/components/customers/customer-workspace.test.tsx`.
- `apps/web/app/components/suppliers/supplier-workspace.tsx` — supplier management composition embedded/used by Purchases.
- `apps/web/app/components/suppliers/supplier-sheet.tsx`.
- `apps/web/app/components/suppliers/supplier-workspace.test.tsx`.
- `apps/web/app/components/settings/master-data-actions.tsx` — shared archive/reactivate action presentation for category/account surfaces, without genericizing entity forms.
- `apps/web/app/master-data.css` — feature-local lifecycle interaction styles.

**Modify**
- `packages/contracts/src/master-data.ts` — add customer/supplier/category/account mutation payload types.
- `apps/api/src/customers.ts` — thin routes around customer service, `expectedUpdatedAt`, 409 conflicts.
- `apps/api/src/suppliers-inventory.ts` — thin supplier routes around supplier service, revision conflict handling.
- `apps/api/src/cashbook.ts` — expense-category revisions/audit/concurrency.
- `apps/api/src/treasury.ts` — money-account revisions/audit/concurrency response shape.
- `apps/api/src/app.ts` / `apps/api/src/sync.ts` — deterministic offline customer/supplier/profile mutation types.
- `apps/api/test/customer-credit.integration.test.ts` — profile vs credit permission/concurrency/history tests.
- `apps/api/test/purchases-inventory.integration.test.ts` — supplier lifecycle/concurrency/open-payable tests.
- `apps/api/test/cashbook-expenses.integration.test.ts` — category revision/system/history tests.
- `apps/api/test/treasury.integration.test.ts` — money-account revision/deactivation/default/history tests.
- `apps/web/app/components/customers-credit.tsx` — migrate to customer workspace or focused financial subcomponent.
- `apps/web/app/components/purchases-inventory.tsx` — use supplier workspace/sheet rather than inline ad-hoc edit.
- `apps/web/app/components/cashbook-expenses.tsx` and `apps/web/app/components/cashbook/expense-category-card.tsx` — lifecycle actions/revisions.
- `apps/web/app/components/treasury.tsx` — lifecycle actions/revisions.
- `apps/web/app/(workspace)/customers/page.tsx`, `purchases/page.tsx`, `cashbook/page.tsx` as needed for composition.
- `apps/web/app/layout.tsx` — import `master-data.css`.

## Task 1: Revision schema and shared master-data contracts

**Interfaces**
- Existing `updatedAt` for customers/suppliers/money accounts becomes required mutation revision.
- Expense categories gain `createdAt` and `updatedAt`; money-account default mappings gain `updatedAt`.
- Mutation types add `CUSTOMER_CREATE`, `CUSTOMER_UPDATE`, `SUPPLIER_CREATE`, `SUPPLIER_UPDATE`; status change may use same update payload with `active` + `expectedUpdatedAt`.

- [ ] **Step 1: Write migration/contract tests or schema assertions** proving expense categories expose timestamps, money-account defaults expose `updatedAt`, and contract payloads require `expectedUpdatedAt` for updates.
- [ ] **Step 2: Run** contracts/API focused tests and verify RED.
- [ ] **Step 3: Add migration `0014_master_data_revisions.sql`** with non-null/backfill-safe timestamps for expense categories and revision timestamps for money-account defaults; do not mutate posted transaction tables.
- [ ] **Step 4: Extend `master-data.ts`** with exact customer/supplier/category/account revision payloads and exports.
- [ ] **Step 5: Apply migration to isolated CI DB and run contract/typecheck gates**; expect PASS.
- [ ] **Step 6: Commit** `feat(data): add master-data revision contracts`.

## Task 2: Customer lifecycle service and concurrency

**Interfaces**
- `createCustomer(pool, access, input)`.
- `updateCustomer(pool, access, customerId, input & { expectedUpdatedAt })`.
- General fields: name/phone/email.
- Sensitive fields: `creditLimitMinor`, `creditTermsDays`, `active` only for CREDIT_CONTROL_ROLES.
- Audit event distinguishes `CUSTOMER_UPDATED`, `CUSTOMER_DEACTIVATED`, `CUSTOMER_REACTIVATED` and includes changed-field delta.

- [ ] **Step 1: Extend `customer-credit.integration.test.ts`** for stale 409, CASHIER/SALES general profile edit success, credit/status edit 403, deactivation preserving ledger/history, inactive new-sale/customer-payment rejection, reactivation, audit delta.
- [ ] **Step 2: Run isolated customer API tests** and verify RED on revision behavior.
- [ ] **Step 3: Create `customer-service.ts`** and refactor routes to use it; update SQL with `WHERE updated_at=$expected` semantics and authoritative returned `updatedAt`.
- [ ] **Step 4: Preserve existing credit-control validation and immutable customer ledger/obligation history**.
- [ ] **Step 5: Run** focused API tests + API typecheck; expect PASS.
- [ ] **Step 6: Commit** `feat(customers): add revision-safe lifecycle service`.

## Task 3: Professional customer management UX

**Interfaces**
- `CustomerWorkspace({ businessId, currencyCode, role })` handles search/list/selection.
- `CustomerSheet({ customer, role, mode, open, onClose, onSaved })` separates Profile from Credit & terms and History.
- Profile edit actions follow customer-write roles; credit/status controls follow credit-control capability.

- [ ] **Step 1: Write failing web tests** for search, edit profile, role-hidden credit controls, OWNER credit edit, inactive badge/reactivate, stale conflict message, focus/escape/restore, customer financial history still visible.
- [ ] **Step 2: Run** focused test and verify RED.
- [ ] **Step 3: Implement `customer-workspace.tsx` and `customer-sheet.tsx`**, reusing existing receivable/obligation display logic from `customers-credit.tsx` rather than duplicating calculations.
- [ ] **Step 4: Queue deterministic profile updates offline with expected revision; require online for activation/credit-control changes if current server state is needed.**
- [ ] **Step 5: Replace old page composition while preserving customer payment workflow and event refresh behavior.**
- [ ] **Step 6: Run** customer web tests + typecheck; expect PASS.
- [ ] **Step 7: Commit** `feat(web): redesign customer lifecycle management`.

## Task 4: Supplier lifecycle service and procurement safety

**Interfaces**
- `createSupplier(pool, access, input)`.
- `updateSupplier(pool, access, supplierId, input & { expectedUpdatedAt })`.
- Payment terms remain limited to SUPPLIER_TERMS_ROLES.
- Inactive supplier cannot be selected for new purchase receive; historical payable settlement remains readable/allowed according to current accounting logic.

- [ ] **Step 1: Extend purchase/supplier tests** for stale 409, INVENTORY profile edit allowed/payment terms forbidden, ACCOUNTANT payment terms allowed, archive/reactivate, archived supplier blocked from new purchase, existing payable remains visible/payable, audit event delta.
- [ ] **Step 2: Run** focused API tests and verify RED.
- [ ] **Step 3: Create/refactor `supplier-service.ts`** with optimistic update and lifecycle audit events.
- [ ] **Step 4: Confirm `applyPurchaseReceiveMutation` still requires active supplier while supplier-payment path can settle historical obligation under the intended rule; adjust only if test exposes mismatch.**
- [ ] **Step 5: Run** focused API tests + typecheck; expect PASS.
- [ ] **Step 6: Commit** `feat(suppliers): add revision-safe supplier lifecycle`.

## Task 5: Professional supplier management UX

**Interfaces**
- `SupplierWorkspace({ businessId, branchId, currencyCode, role, onSupplierSelected? })`.
- `SupplierSheet` sections: Details, Payment terms, Payables/history, Status.

- [ ] **Step 1: Write failing web tests** for search, edit, permission-separated terms, archive/reactivate, stale conflict, inactive supplier omitted from receiving picker but visible in history.
- [ ] **Step 2: Run** focused tests and verify RED.
- [ ] **Step 3: Implement supplier workspace/sheet** and integrate with Purchases without losing receiving/return/payment workflows.
- [ ] **Step 4: Replace inline ad-hoc supplier terms editor** in `purchases-inventory.tsx` with the new sheet/action model.
- [ ] **Step 5: Run** purchase/supplier web tests + typecheck; expect PASS.
- [ ] **Step 6: Commit** `feat(web): professionalize supplier lifecycle management`.

## Task 6: Expense-category lifecycle consistency

**Interfaces**
- Category list response includes `createdAt`, `updatedAt`, `system`.
- PATCH body requires `expectedUpdatedAt` for name/active mutations.
- System categories may be renamed/deactivated only if current policy deliberately permits it; permanent delete is out of scope.

- [ ] **Step 1: Add API tests** for stale revision, current cashbook admin roles, archive/reactivate preserving historical expenses, system-category safety, audit events.
- [ ] **Step 2: Run** focused API tests and verify RED.
- [ ] **Step 3: Update `cashbook.ts`** with revision predicate, audit delta and authoritative timestamp response.
- [ ] **Step 4: Add web tests** for Edit/Archive/Reactivate role-safe actions, stale conflict messaging, inactive category unavailable for new expense but retained in history.
- [ ] **Step 5: Update `expense-category-card.tsx` / cashbook composition** to use consistent TradeOS sheet/confirmation patterns.
- [ ] **Step 6: Run** cashbook API/web tests; expect PASS.
- [ ] **Step 7: Commit** `feat(cashbook): complete expense-category lifecycle`.

## Task 7: Money-account lifecycle consistency

**Interfaces**
- GET account response must carry `updatedAt`; GET default mappings must carry their `updatedAt`.
- PATCH account requires `expectedUpdatedAt` and keeps existing default-account/negative-balance constraints.
- PUT money-account default requires the mapping `expectedUpdatedAt`; stale default changes return `STALE_VERSION`.
- No physical delete route.
- Audit differentiates `MONEY_ACCOUNT_UPDATED`, `MONEY_ACCOUNT_DEACTIVATED`, `MONEY_ACCOUNT_REACTIVATED`, and default-assignment changes.

- [ ] **Step 1: Extend treasury tests** for stale account update, stale default-mapping update, deactivation while default blocked, replacement default then deactivate success, reactivation, history preserved, unauthorized role 403, audit delta.
- [ ] **Step 2: Run** focused treasury API tests and verify RED.
- [ ] **Step 3: Update `treasury.ts`** with revision-aware account SELECT/PATCH and default GET/PUT, returning `updatedAt` while preserving all existing balance/default guards.
- [ ] **Step 4: Add web tests and update `treasury.tsx`** for professional edit/status sheet, revision-safe default assignment, business-language default-account error, and role-safe actions.
- [ ] **Step 5: Run** treasury API/web tests + typecheck; expect PASS.
- [ ] **Step 6: Commit** `feat(treasury): complete money-account lifecycle`.

## Task 8: Customer/supplier offline sync mutations

**Interfaces**
- Deterministic profile creates/updates use existing durable queue with `expectedUpdatedAt` for updates.
- Status/credit/payment-term changes that require current server-sensitive validation may remain online-only and explicitly labeled.

- [ ] **Step 1: Add sync tests** for CUSTOMER_CREATE/UPDATE and SUPPLIER_CREATE/UPDATE: authorization, authoritative actor, idempotent replay, stale rejection, branchless readiness.
- [ ] **Step 2: Run** focused sync tests and verify RED.
- [ ] **Step 3: Extend `app.ts` mutation role mapping and `sync.ts` dispatch** to call customer/supplier services; include service domain errors in rejection code extraction.
- [ ] **Step 4: Extend web offline readiness/event refresh** for customer/supplier mutations, preserving failed conflict entries.
- [ ] **Step 5: Run** sync/API/web tests; expect PASS.
- [ ] **Step 6: Commit** `feat(sync): add conflict-safe customer and supplier mutations`.

## Task 9: Cross-module lifecycle UX consistency

**Interfaces**
- Shared `MasterDataActions` handles only action presentation/confirmations; entity forms stay entity-specific.
- Common business-language errors: `STALE_VERSION`, inactive/history constraints, default-account constraints.

- [ ] **Step 1: Write source/component tests** pinning consistent Edit/Archive/Reactivate naming, no unauthorized controls, accessible destructive confirmations, focus restoration.
- [ ] **Step 2: Implement `master-data-actions.tsx` and `master-data.css`** using TradeOS tokens; avoid generic CRUD form generator.
- [ ] **Step 3: Wire customer/supplier/category/account surfaces** to the shared action presentation where appropriate.
- [ ] **Step 4: Run** affected web suites + typecheck; expect PASS.
- [ ] **Step 5: Commit** `feat(web): unify TradeOS master-data lifecycle interactions`.

## Task 10: Slice C full regression and acceptance

- [ ] **Step 1: Apply all migrations to isolated TradeOS CI DB from a clean schema path** and verify migration chain succeeds.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/web test`.
- [ ] **Step 3: Run** `DATABASE_URL=postgresql://tradeos@127.0.0.1:55432/tradeos_ci pnpm test`.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm --filter @tradeos/web build && git diff --check`.
- [ ] **Step 5: Manual UAT** at 360, 390/393, 430, 768, 1024, 1280, 1440 for OWNER, CASHIER, SALES, INVENTORY, ACCOUNTANT, VIEWER across Customers, Purchases/Suppliers, Cashbook categories and Treasury accounts.
- [ ] **Step 6: Verify historical sales/purchases/payables/expenses/cash entries remain readable after deactivation** and no direct UI path rewrites posted transactions.
- [ ] **Step 7: Commit only evidence-backed hardening** as `fix(web): harden master-data lifecycle consistency`.
- [ ] **Step 8: Record final Slice C SHA, clean worktree, and perform whole-program branch review against the 12 Definition-of-Done items in the spec.**
