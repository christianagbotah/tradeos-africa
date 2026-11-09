# Entity Intelligence Safe Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized user turn record-level TradeOS Intelligence into one idempotent internal review task without enabling any economic or access mutation.

**Architecture:** Extend `business_action_items` with explicit entity provenance and creator audit, derive a role-safe action descriptor from the existing entity intelligence service, and add a dedicated POST service/route that creates only server-owned review tasks. The shared entity panel calls that route only after a human click and continues using the existing action queue for completion/snooze/workflow navigation.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React/Next.js, Vitest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-23-entity-intelligence-safe-actions-design.md`

## Global Constraints

- Supported entity types remain exactly `CATALOG_ITEM`, `CUSTOMER`, `SUPPLIER`, `PURCHASE`.
- Direct entity actions write only internal `business_action_items` records.
- Client must not choose title, reason, evidence, assignment, due time, or effective action type.
- Entity/business/branch ownership must be revalidated server-side for every POST.
- Financial evidence keeps the current role filter; contact values stay excluded.
- No offline replay for entity task creation.
- No list-row entity intelligence or action calls.
- Active duplicate creation must be database-backed and idempotent.

## Review Focus

- Two simultaneous clicks for the same active entity task must return one durable task, not two.
- Completing an earlier entity task must allow a later new task for the same entity/action.
- A foreign-tenant or wrong-branch entity must not disclose whether the record exists.
- A role without an eligible mapped action must see no create control and receive a server denial if it posts manually.
- Entity task creation must not change economic/access ledgers even when the source entity has attention or financial evidence.

---

### Task 1: Entity action contracts and database provenance

**Files:**
- Modify: `packages/contracts/src/business-intelligence.ts`
- Create: `packages/db/migrations/0024_entity_action_items.sql`
- Modify: `apps/api/test/business-intelligence-schema.integration.test.ts`
- Modify: `apps/api/test/apply-migrations.integration.test.ts`
- Modify: `packages/contracts/src/business-intelligence-contract.test.ts`

**Interfaces:**
- Produces: `BusinessEntitySafeAction`, `BusinessEntityActionItemRequest`, `BusinessEntityActionItemResponse`.
- Extends: `BusinessEntityIntelligence.safeAction: BusinessEntitySafeAction | null`.
- Extends: `BusinessActionItem` with nullable `sourceEntityType`, `sourceEntityId`, and `createdByUserId`.

- [ ] **Step 1: Write failing contract/schema tests**

Pin the four entity types, `safeAction` response shape, entity action request/response, provenance columns, all-or-nothing entity constraint, creator FK, and active duplicate unique partial index. Extend migration-runner coverage to include `0024_entity_action_items.sql`.

- [ ] **Step 2: Run focused tests and observe RED**

Run:
`pnpm --filter @tradeos/contracts test -- business-intelligence-contract.test.ts`
`pnpm --filter @tradeos/api exec vitest run test/business-intelligence-schema.integration.test.ts test/apply-migrations.integration.test.ts --no-file-parallelism`

Expected: failures for missing contract fields/migration 0024 schema.

- [ ] **Step 3: Implement contracts and migration**

Migration adds nullable `source_entity_type`, `source_entity_id`, `created_by_user_id`, scope/type constraints, creator FK, and a unique expression partial index covering active `OPEN`/`SNOOZED` entity/action tasks while treating null branch as one business-wide scope.

- [ ] **Step 4: Re-run focused tests and build contracts**

Expected: all focused tests PASS and `pnpm --filter @tradeos/contracts build` exits 0.

- [ ] **Step 5: Commit**

`git commit -m "feat(ai): add entity action provenance"`

### Task 2: Server-owned safe action mapping

**Files:**
- Modify: `apps/api/src/business-intelligence/entity-service.ts`
- Modify: `apps/api/test/business-entity-intelligence.integration.test.ts`

**Interfaces:**
- Produces: `businessEntitySafeAction(role: BusinessRole, entityType: BusinessEntityType): BusinessEntitySafeAction | null`.
- Updates: `getBusinessEntityIntelligence(...)` to return `safeAction` using the validated actor role and entity type.

- [ ] **Step 1: Write failing mapping tests**

Assert exact mappings from the spec, including `CATALOG_ITEM` inventory roles, customer financial/general follow-up role split, supplier/purchase operational roles, and null for ineligible roles.

- [ ] **Step 2: Run the entity integration test and observe RED**

Run: `pnpm --filter @tradeos/api exec vitest run test/business-entity-intelligence.integration.test.ts --no-file-parallelism`

Expected: missing `safeAction`/mapping failures.

- [ ] **Step 3: Implement `businessEntitySafeAction` and include it in entity intelligence**

Use fixed server copy and default `dueInHours: 24`; do not infer from model text or client input.

- [ ] **Step 4: Re-run the focused test and API typecheck**

Expected: PASS; `pnpm --filter @tradeos/api typecheck` exits 0.

- [ ] **Step 5: Commit**

`git commit -m "feat(ai): derive safe entity review actions"`

### Task 3: Idempotent entity-to-action-item service

**Files:**
- Create: `apps/api/src/business-intelligence/entity-action-service.ts`
- Create: `apps/api/test/business-entity-actions.integration.test.ts`
- Modify: `apps/api/src/business-intelligence/automation-service.ts`

**Interfaces:**
- Consumes: `getBusinessEntityIntelligence(...)`, `businessEntitySafeAction(...)`, and existing `BusinessActionItem` contract.
- Produces: `createBusinessEntityActionItem(pool, actor, input): Promise<{ item: BusinessActionItem; created: boolean }>`.
- Produces: exported reusable action-row mapping/select helper only if needed to avoid duplicate mapping logic.

- [ ] **Step 1: Write failing service integration tests**

Cover each entity action mapping, creator/self assignment, evidence preservation, highest-priority source attention linkage, wrong tenant/branch not-found behavior, role denial, retry returning `{created:false}`, concurrent duplicate requests producing one row, and recreate-after-DONE.

Add before/after counts for sales, payments, returns, purchases, inventory movements, cashbook, memberships, staff, and access/role tables and assert unchanged.

- [ ] **Step 2: Run the new service suite and observe RED**

Run: `pnpm --filter @tradeos/api exec vitest run test/business-entity-actions.integration.test.ts --no-file-parallelism`

Expected: module/function missing.

- [ ] **Step 3: Implement `createBusinessEntityActionItem`**

Revalidate the entity through the existing entity intelligence service, derive the server action, generate title/reason, use bounded authoritative evidence, assign the actor, set due time to +24h, and insert with entity/creator provenance. On active-duplicate unique conflict, load and return the existing scoped row with `created:false`.

- [ ] **Step 4: Re-run service + existing automation/entity suites**

Run:
`pnpm --filter @tradeos/api exec vitest run test/business-entity-actions.integration.test.ts test/business-entity-intelligence.integration.test.ts test/business-automation.integration.test.ts --no-file-parallelism`

Expected: all PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(ai): create safe entity review tasks"`

### Task 4: Authenticated entity action route

**Files:**
- Modify: `apps/api/src/business-intelligence/routes.ts`
- Modify: `apps/api/test/business-entity-intelligence-routes.integration.test.ts`

**Interfaces:**
- Adds: `POST /v1/intelligence/entity/action-items`.
- Accepts: `BusinessEntityActionItemRequest` fields only; effective action content remains server-owned.
- Returns: `BusinessEntityActionItemResponse`, status 201 for new and 200 for existing active task.

- [ ] **Step 1: Write failing route tests**

Pin successful creation, duplicate retry status, unsupported entity type, foreign entity, ineligible role, and rejection/ignoring of attempted `actionType`, `title`, `reason`, `evidence`, `assignedUserId`, or `dueInHours` injection. Prefer explicit rejection of extra sensitive action-shaping fields.

- [ ] **Step 2: Run route test and observe RED**

Run: `pnpm --filter @tradeos/api exec vitest run test/business-entity-intelligence-routes.integration.test.ts --no-file-parallelism`

Expected: route not found/new assertions fail.

- [ ] **Step 3: Add route parsing/authentication**

Authenticate, require `READ_ROLES` membership, parse only business/branch/context, build actor from the authenticated membership, delegate to the entity action service, and preserve safe not-found semantics.

- [ ] **Step 4: Re-run route/service tests and API typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(ai): expose entity review task route"`

### Task 5: One-click entity task UX

**Files:**
- Create: `apps/web/app/components/intelligence/entity-action-items.ts`
- Create: `apps/web/app/components/intelligence/entity-action-items.test.ts`
- Modify: `apps/web/app/components/intelligence/entity-intelligence-panel.tsx`
- Modify: `apps/web/app/components/intelligence/entity-intelligence-panel-contract.test.ts`
- Modify: `apps/web/app/intelligence.css`

**Interfaces:**
- Produces: `createEntityActionItem(fetcher, input)` returning `BusinessEntityActionItemResponse`.
- Consumes: `BusinessEntityIntelligence.safeAction` from the entity GET.

- [ ] **Step 1: Write failing helper/panel tests**

Assert exact POST path/body, server error propagation, 201-created and 200-existing responses, action button rendered only when `safeAction` exists, online-only behavior, pending disablement, success/duplicate copy, and `type="button"`. Keep the existing no-list-row contract.

- [ ] **Step 2: Run focused Web tests and observe RED**

Run:
`pnpm --filter @tradeos/web exec vitest run app/components/intelligence/entity-action-items.test.ts app/components/intelligence/entity-intelligence-panel-contract.test.ts app/components/intelligence/entity-intelligence-workspaces-contract.test.ts`

Expected: missing helper/action UX failures.

- [ ] **Step 3: Implement helper and panel UI**

Use current authenticated online fetch only after a click. POST only `businessId`, `branchId`, and entity `context`; never queue offline. Render server-owned label and feedback while preserving Ask TradeOS and canonical navigation.

- [ ] **Step 4: Re-run focused Web tests and strict typecheck**

Expected: PASS; `pnpm --filter @tradeos/web typecheck` exits 0.

- [ ] **Step 5: Commit**

`git commit -m "feat(ai): add one-click entity review tasks"`

### Task 6: Full verification and review

**Files:**
- Review all files changed since Task 1.
- Update: PR #92 description with this slice and verification evidence after push.

**Interfaces:** None new; this task proves the slice as a whole.

- [ ] **Step 1: Run fresh full API verification in a disposable PostgreSQL schema**

Apply all migrations there, then run the full API test package and production build. Verify the schema is dropped afterward.

- [ ] **Step 2: Run full Web verification**

Run full Web tests, strict typecheck, and production build; revert generated `next-env.d.ts` if Next touches it.

- [ ] **Step 3: Run contracts and VPS/deployment/security checks**

Run the VPS tests under the intended non-root test identity so the production root override guard remains active.

- [ ] **Step 4: Safety/review scan**

Confirm the new entity action service writes only `business_action_items`; route cannot accept action-shaping fields; panel has no economic/access mutation route; `git diff --check` is clean. Review tenant/branch isolation, role mapping, concurrent idempotency, audit provenance, and ledger invariants.

- [ ] **Step 5: Push and verify GitHub gates**

Push the branch, update draft PR #92, then require both CI and Visual QA to complete successfully before calling the slice complete. Keep PR #92 draft.
