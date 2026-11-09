# Ghana Market Pilot Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and pass a ledger-grade Ghana SME market simulation that proves TradeOS's cross-module commercial readiness before staging pilot use.

**Architecture:** Add one public-API integration journey running against a dedicated test database/schema, with explicit constants and final ledger/read-model reconciliation. Reuse normal auth/onboarding/catalog/customer/supplier/sync/report/intelligence routes; only inspect the database for invariant verification. Product fixes discovered by the journey are implemented at their owning service with focused RED→GREEN regression tests.

**Tech Stack:** TypeScript, Fastify inject, Vitest, PostgreSQL 18, existing TradeOS contracts/sync engine.

**Spec:** `docs/superpowers/specs/2026-10-26-ghana-market-pilot-readiness-design.md`

## Global Constraints

- Never point destructive tests at `tradeos_staging`; use an allow-listed test/QA database and disposable schema.
- Use public authenticated APIs/sync for user-visible business mutations.
- GHS amounts are integer minor units; expected final balances are explicit constants.
- No AI direct economic/access mutation.
- No real customer data, provider charge or live tenant mutation in the automated gate.
- Keep PR #92's verified remote head stable; market-readiness work stays on `feat/ghana-market-pilot-readiness` until integration sequencing is decided.

## Review Focus

- Duplicate sync delivery: repeated purchase/sale/payment IDs must not duplicate stock, cash or obligations; pinned in Task 2.
- Return/refund arithmetic after mixed cash/credit commerce: final revenue, stock and receivables must reconcile; pinned in Task 2.
- Phone-only Ghana identity normalization/login: no hidden email requirement; pinned in Task 1.
- Role downgrade/lower-role financial evidence: financial AI data and management mutations stay restricted; pinned in Task 3.
- AI review actions: only internal action-item state may change; economic/access ledger counts stay invariant; pinned in Task 4.

---

### Task 1: Pilot identity and master-data foundation

**Files:**
- Create: `apps/api/test/ghana-market-pilot.integration.test.ts`

**Interfaces:**
- Consumes: `buildApp(pool)`, `/v1/auth/register`, `/v1/auth/login`, `/v1/onboarding/business`, `/v1/suppliers`, `/v1/customers`, `/v1/catalog/items`.
- Produces: one continuous pilot fixture with owner token, business/branch, supplier, customer and bulk-conversion item IDs.

- [ ] **Step 1: Write the first pilot test section** asserting phone-only registration/login, Ghana/GHS business context, supplier/customer creation, and `box -> lb` catalog conversion.
- [ ] **Step 2: Run only the new pilot file on a disposable migrated schema.** Expected: pass if existing behavior is commercially coherent; otherwise a precise RED becomes the owning product defect.
- [ ] **Step 3: Fix any product defect at its source with a focused regression test.** Never weaken the pilot assertion to match incorrect behavior.
- [ ] **Step 4: Rerun the pilot section and affected existing tests.** Expected: PASS.
- [ ] **Step 5: Commit** the foundation and any required source fix.

### Task 2: Full trading-day money and stock reconciliation

**Files:**
- Modify: `apps/api/test/ghana-market-pilot.integration.test.ts`
- Modify only if RED identifies a defect: owning commerce/purchase/customer/cashbook/report service and its focused integration test.

**Interfaces:**
- Consumes: Task 1 fixture and `/v1/sync` mutations for purchase, sale, customer payment, return/refund, supplier payment and expense.
- Produces: explicit final expected stock, inventory value, revenue/refund, customer receivable, supplier payable and cash/cashbook values.

- [ ] **Step 1: Extend the pilot with purchase receipt + replay, cash sale, customer-credit sale, MoMo sale, partial customer payment, partial restocking return, supplier payment and expense.**
- [ ] **Step 2: Add negative assertions** for over-limit/invalid operations and no partial writes.
- [ ] **Step 3: Add final reconciliation assertions** using inventory/report/customer/supplier/cashbook reads plus authoritative ledger queries. Expected values must be literal test constants.
- [ ] **Step 4: Run the pilot on a fresh disposable schema and debug every RED systematically.**
- [ ] **Step 5: Rerun adjacent commerce, purchase, credit, return, exchange, cashbook and report suites.** Expected: PASS.
- [ ] **Step 6: Commit** the trading-day gate and fixes.

### Task 3: Real staff/role and offline-replay boundary

**Files:**
- Modify: `apps/api/test/ghana-market-pilot.integration.test.ts`
- Modify only on RED: staff/auth/sync authorization source + focused existing test.

**Interfaces:**
- Consumes: pilot business and normal staff invitation/acceptance/auth route where available.
- Produces: lower-role authenticated actor and replay/authorization evidence.

- [ ] **Step 1: Add a lower-role user through the supported invitation/acceptance flow.**
- [ ] **Step 2: Assert an owner/management-only mutation is denied and actor spoofing is ignored.**
- [ ] **Step 3: Replay representative accepted purchase/sale/payment mutations and assert exactly-once row/movement/obligation effects.**
- [ ] **Step 4: Run pilot + staff/auth/sync suites and fix source defects only.** Expected: PASS.
- [ ] **Step 5: Commit** role/offline hardening.

### Task 4: AI decision-support safety on real business state

**Files:**
- Modify: `apps/api/test/ghana-market-pilot.integration.test.ts`
- Modify only on RED: business-intelligence service/route + focused test.

**Interfaces:**
- Consumes: `/v1/intelligence/attention/evaluate`, `/briefing`, `/entity`, `/entity/action-items`, action-item reads.
- Produces: deterministic intelligence assertions and economic/access ledger invariants around a safe internal review-task write.

- [ ] **Step 1: Evaluate/read deterministic intelligence on the completed pilot state and assert correct tenant/branch/entity grounding.**
- [ ] **Step 2: Snapshot economic/access ledger counts/sums, create a server-owned safe entity review task, replay it, and assert idempotency.**
- [ ] **Step 3: Assert only `business_action_items` changes; sales, purchases, payments/refunds, inventory, cashbook, obligations, staff and memberships remain identical.**
- [ ] **Step 4: Assert a lower role cannot receive forbidden financial entity evidence.**
- [ ] **Step 5: Run pilot + intelligence/automation suites.** Expected: PASS.
- [ ] **Step 6: Commit** AI market-safety gate and fixes.

### Task 5: Commercial-readiness verification and staging handoff

**Files:**
- Create: `docs/uat/ghana-market-pilot-checklist.md`
- Modify: PR notes only after code is pushed.

**Interfaces:**
- Consumes: Tasks 1-4 and canonical deployment guard.
- Produces: repeatable human staging checklist and final readiness evidence.

- [ ] **Step 1: Run full API tests/typecheck/build on an allow-listed test database and disposable schema.**
- [ ] **Step 2: Run full Web tests/typecheck/production build plus 49 deployment/security contracts.**
- [ ] **Step 3: Self-review the whole market-readiness range for accounting, tenant isolation, role leakage, idempotency and AI mutation safety.**
- [ ] **Step 4: Push the market-readiness branch and require fresh GitHub CI + Visual QA.**
- [ ] **Step 5: Write the staging checklist** for login/onboarding/catalog/sell/inventory/customers/purchases/returns/reports/settings/team/AI and exact pass/fail recording.
- [ ] **Step 6: Integrate only through the canonical main-only guarded path, then run synthetic staging smoke/Visual QA before any real merchant pilot.**
