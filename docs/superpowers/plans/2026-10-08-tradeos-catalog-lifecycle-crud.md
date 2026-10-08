# TradeOS Catalog Lifecycle & CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver permission-aware, auditable, history-safe Catalog CRUD for products/services with professional TradeOS 2 management UX and deterministic online/offline behavior.

**Architecture:** Introduce shared lifecycle capability types, move catalog mutation rules into a service callable from both REST and sync, use `catalog_items.updated_at` as the optimistic-concurrency revision, and replace the create-only Catalog page with a search/filter/list/detail/edit-sheet workspace. Structural edits that require history checks are server-authoritative; safe profile/create/archive mutations may use the existing durable sync queue.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Fastify, PostgreSQL 18, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-08-tradeos-crud-pos-design.md`

## Global Constraints

- Preserve current tenant isolation, authentication, business-role authorization, server-side pricing, inventory valuation, returns/refunds, audit and offline transaction semantics.
- Catalog create/edit/archive/reactivate roles: OWNER, ADMIN, MANAGER, INVENTORY.
- Permanent catalog delete: OWNER/ADMIN only and only when the server proves no protected history/reference exists.
- Unknown roles fail closed.
- `updatedAt` is the revision token for catalog items; stale mutation => HTTP 409 / `STALE_VERSION`.
- Historical sale, purchase, return and inventory meaning must never be rewritten by catalog edits.
- Quantity on hand is never directly edited through Catalog.
- Inactive catalog items remain readable but are excluded from normal selling/receiving selectors.
- Safe-delete is online-only; history-sensitive structural edits are online-only.
- Mobile body/control text remains 15–16px; primary touch targets >=48px; icon-only touch targets >=44x44px.
- No new generic “polish” stylesheet; use TradeOS tokens and feature-local Catalog styles.

## Review Focus

1. Two devices edit the same item: the second stale write must return `STALE_VERSION`, preserve the newer server record, and present reload/review UX.
2. An item with sale/purchase/inventory/recipe history: safe-delete and history-breaking structural edits must be rejected with actionable errors while archive remains available.
3. Archived items: must remain visible in Catalog history filters but disappear from Sell and purchase candidate projections.
4. INVENTORY role vs OWNER/ADMIN: INVENTORY may create/edit/archive/reactivate but must never receive permanent-delete UI/API capability.
5. Offline queue conflict: queued profile edits retain their original `expectedUpdatedAt` and move to failed/review state on conflict rather than overwriting newer data.

---

## File Structure

**Create**
- `packages/contracts/src/master-data.ts` — typed master-data mutation names/payloads and lifecycle revision contract.
- `apps/api/src/catalog-service.ts` — authoritative catalog create/update/archive/reactivate/safe-delete/history-guard logic shared by REST and sync.
- `apps/web/app/lib/lifecycle-capabilities.ts` — role-to-lifecycle capability mapping used by UI only; mirrors server policy but never replaces API authorization.
- `apps/web/app/lib/lifecycle-capabilities.test.ts` — fail-closed role/capability tests.
- `apps/web/app/components/catalog/catalog-workspace.tsx` — Catalog page composition, search/filter state and selection.
- `apps/web/app/components/catalog/catalog-list.tsx` — responsive active/archived management list.
- `apps/web/app/components/catalog/catalog-item-sheet.tsx` — accessible detail/edit/create/duplicate sheet.
- `apps/web/app/components/catalog/catalog-actions.tsx` — permission-safe lifecycle actions and destructive confirmations.
- `apps/web/app/components/catalog/catalog-workspace.test.tsx` — UI composition/lifecycle/accessibility tests.
- `apps/web/app/catalog.css` — feature-local responsive Catalog styles.

**Modify**
- `packages/contracts/src/index.ts` — export master-data contracts.
- `apps/api/src/catalog.ts` — thin REST route layer using `catalog-service`.
- `apps/api/src/app.ts` — authorize Catalog sync mutation types and authoritative actor enrichment.
- `apps/api/src/sync.ts` — dispatch Catalog master-data sync mutations and surface typed domain errors.
- `apps/api/test/identity-onboarding-catalog.integration.test.ts` — lifecycle/history/permission/concurrency/offline tests.
- `apps/web/app/lib/offline-sync.ts` — allow branchless master-data mutations through queue readiness and preserve typed failures.
- `apps/web/app/lib/workspace-types.ts` — add catalog `createdAt`/`updatedAt` fields.
- `apps/web/app/components/workspace/workspace-provider.tsx` — consume authoritative returned catalog entity / refresh after applied Catalog mutations.
- `apps/web/app/components/workspace/workspace-provider.test.tsx` — archived/sellable projection and applied-mutation refresh tests.
- `apps/web/app/(workspace)/catalog/page.tsx` — replace `CatalogStarter` with `CatalogWorkspace`.
- `apps/web/app/layout.tsx` — import `catalog.css`.
- `apps/web/app/components/workspace/route-composition.test.tsx` — pin new Catalog composition.

## Task 1: Master-data lifecycle contracts and fail-closed UI capabilities

**Interfaces**
- Produces `MasterDataRevision = { expectedUpdatedAt: string }`.
- Produces `CatalogMutationType = "CATALOG_ITEM_CREATE" | "CATALOG_ITEM_UPDATE" | "CATALOG_ITEM_ARCHIVE" | "CATALOG_ITEM_REACTIVATE"`.
- Produces `catalogCapabilities(role: string): { canRead; canCreate; canEdit; canArchive; canReactivate; canDeleteUnused }`.

- [ ] **Step 1: Write failing contract/capability tests** in `apps/web/app/lib/lifecycle-capabilities.test.ts` asserting OWNER/ADMIN full lifecycle, INVENTORY no permanent delete, VIEWER/unknown no Catalog writes, and unknown role fails closed.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/web exec vitest run app/lib/lifecycle-capabilities.test.ts` and verify RED because helpers/contracts do not exist.
- [ ] **Step 3: Add `packages/contracts/src/master-data.ts` and export it** with the exact mutation/revision names above; add `catalogCapabilities(role)` in `apps/web/app/lib/lifecycle-capabilities.ts`.
- [ ] **Step 4: Run** focused test plus `pnpm --filter @tradeos/contracts typecheck && pnpm --filter @tradeos/web typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat(catalog): define master-data lifecycle capabilities`.

## Task 2: Authoritative catalog service with concurrency and history guards

**Interfaces**
- Consumes authenticated `BusinessAccess` and existing catalog validation/conversion rules.
- Produces `createCatalogItem(pool, access, input, context?)`.
- Produces `updateCatalogItem(pool, access, itemId, input)` where input contains `businessId`, `expectedUpdatedAt`, mutable fields, and optional `active`.
- Produces `deleteUnusedCatalogItem(pool, access, businessId, itemId, expectedUpdatedAt)`.
- Any unit/price/conversion mutation is atomic with the parent item update and must bump `catalog_items.updated_at`; the parent `updatedAt` is the single revision token for the whole aggregate.
- History-free structural updates replace the validated unit/conversion set in one transaction; once protected history exists, only forward-safe fields such as display metadata, unit labels/eligibility and future prices may change.
- Produces domain errors `CATALOG_ITEM_IN_USE`, `CATALOG_STRUCTURE_LOCKED`, `STALE_VERSION`, existing validation codes.

- [ ] **Step 1: Extend API integration tests** for GET detail, safe display-name/price update, stale update 409, archive/reactivate, INVENTORY permanent-delete denial, OWNER unused-delete success, and audit before/after payload.
- [ ] **Step 2: Add history tests** proving delete rejection after sale history, after purchase/inventory history, and structural stock-unit/conversion edit rejection after history.
- [ ] **Step 3: Run** `DATABASE_URL=postgresql://tradeos@127.0.0.1:55432/tradeos_ci pnpm --filter @tradeos/api exec vitest run test/identity-onboarding-catalog.integration.test.ts --no-file-parallelism`; verify RED on missing routes/service behavior.
- [ ] **Step 4: Create `apps/api/src/catalog-service.ts`** and move create validation/persistence there; implement detail load, profile-safe update, structural-history detection, optimistic `updated_at` predicate, archive/reactivate audit events, and safe-delete reference checks.
- [ ] **Step 5: Keep historical safety simple**: if any stock/sale/purchase/return/recipe reference exists, reject changes to `kind`, `trackStock`, `stockUnitCode`, removal/redefinition of historically used units, or conversion meaning; guide duplicate/replacement instead.
- [ ] **Step 6: Refactor `apps/api/src/catalog.ts`** into REST wrappers for GET list/detail, POST create, PATCH update/archive/reactivate, DELETE safe-delete; response always returns authoritative entity including `createdAt`/`updatedAt` except DELETE success.
- [ ] **Step 7: Run** the focused API test and API typecheck; expect PASS.
- [ ] **Step 8: Commit** `feat(api): add history-safe catalog lifecycle service`.

## Task 3: Catalog lifecycle through the durable sync pipeline

**Interfaces**
- Consumes Task 1 mutation types and Task 2 catalog service.
- `CATALOG_ITEM_CREATE` may omit `branchId`; opening stock still requires a valid branch in payload.
- `CATALOG_ITEM_UPDATE/ARCHIVE/REACTIVATE` carry `itemId` + `expectedUpdatedAt`.
- Permanent DELETE remains REST/online only.

- [ ] **Step 1: Add sync integration tests** for branchless Catalog create/profile update/archive, authoritative staff actor, idempotent replay, stale queued update => REJECTED `STALE_VERSION`, and cross-tenant/role denial.
- [ ] **Step 2: Run focused API sync tests** and verify RED on unsupported mutation types.
- [ ] **Step 3: Extend `rolesForMutation()` and `authoritativeActorPayload()`** in `apps/api/src/app.ts` for Catalog mutations using OWNER/ADMIN/MANAGER/INVENTORY and server staff actor.
- [ ] **Step 4: Split `applyEconomicMutation` dispatch** so master-data mutations do not require `branchId`; call Task 2 service from `apps/api/src/sync.ts` and include catalog domain errors in typed rejection codes.
- [ ] **Step 5: Modify `isServerReady()` in `apps/web/app/lib/offline-sync.ts`** to require branch UUID only for mutation types that actually need a branch; Catalog profile mutations become flushable without one.
- [ ] **Step 6: Add offline-sync unit/source contract tests** pinning branchless Catalog readiness and preservation of `expectedUpdatedAt` in failed mutations.
- [ ] **Step 7: Run** focused API/web tests + typechecks; expect PASS.
- [ ] **Step 8: Commit** `feat(sync): support conflict-safe catalog master-data mutations`.

## Task 4: Catalog workspace data model and sellable projection

**Interfaces**
- `CatalogItem` gains `createdAt: string; updatedAt: string`.
- `projectSellableItems(catalog)` must exclude inactive records exactly as today and preserve each `itemId + unitCode` combination.
- Applied Catalog sync events trigger `refreshBusiness()` or authoritative local replacement.

- [ ] **Step 1: Add failing workspace tests** for `updatedAt`, archive removing an item from sellable projection, reactivate restoring it, and Catalog mutation-applied event causing refresh.
- [ ] **Step 2: Run** workspace provider tests and verify RED.
- [ ] **Step 3: Update API list mapping and web workspace types/provider** to carry revisions and refresh on Catalog applied mutations without duplicating accounting state.
- [ ] **Step 4: Run** workspace tests + web typecheck; expect PASS.
- [ ] **Step 5: Commit** `feat(web): carry catalog lifecycle state through workspace`.

## Task 5: Professional Catalog list/search/filter composition

**Interfaces**
- `CatalogWorkspace({ businessId, branchId, currencyCode, role, items, onRefresh })`.
- Filters: `ALL | PRODUCT | SERVICE | ARCHIVED` plus text search.
- `CatalogList` displays name, type, primary sell unit/price, stock-tracked state, active badge, role-safe action entry.

- [ ] **Step 1: Write failing `catalog-workspace.test.tsx`** asserting Add/Search/Product/Service/Archived controls, archived visibility only under filter, readable price/unit summary, no write controls for unauthorized role.
- [ ] **Step 2: Run** focused web test and verify RED.
- [ ] **Step 3: Implement `catalog-workspace.tsx` and `catalog-list.tsx`** using TradeOS business/UI primitives and `catalogCapabilities`; no page-wide database field dump.
- [ ] **Step 4: Add `catalog.css`** for 360/390/430 phone list, 768/1024 tablet, 1280/1440 desktop management layout; controls meet touch/type rules and no horizontal overflow.
- [ ] **Step 5: Replace route composition** in `(workspace)/catalog/page.tsx`, passing role from workspace context and importing feature CSS from layout.
- [ ] **Step 6: Run** focused Catalog tests, route-composition tests and web typecheck; expect PASS.
- [ ] **Step 7: Commit** `feat(web): redesign Catalog as a management workspace`.

## Task 6: Accessible create/edit/duplicate sheet with history-safe field behavior

**Interfaces**
- `CatalogItemSheet({ mode: "create" | "edit" | "duplicate" | "view", item, open, onClose, ... })`.
- Sections: Basics, Selling, Buying/stock, Units & conversions, Tax/configuration, Status.
- Save edit sends `expectedUpdatedAt` and the current editable draft; structural-lock errors remain visible in business language.

- [ ] **Step 1: Add failing sheet tests** for focus-on-open, Tab trap, Escape close, focus restoration, create/edit field population, duplicate starts unsaved/new, stale conflict message, locked structural field explanation, 48px mobile primary controls.
- [ ] **Step 2: Run** focused test and verify RED.
- [ ] **Step 3: Implement `catalog-item-sheet.tsx`** reusing current create validation semantics from `CatalogStarter`, but with one shared form model for create/edit/duplicate.
- [ ] **Step 4: Route create and safe queued profile edits through typed Catalog sync mutations; structural edits call online PATCH and show “requires connection” when offline.**
- [ ] **Step 5: On applied mutation**, close only after durable local acceptance, show pending/synced state accurately, refresh authoritative catalog, and never silently discard rejected conflict.
- [ ] **Step 6: Run** focused tests + web typecheck; expect PASS.
- [ ] **Step 7: Commit** `feat(web): add professional catalog create and edit sheet`.

## Task 7: Archive/reactivate/delete-unused actions and confirmations

**Interfaces**
- `CatalogActions({ item, role, onEdit, onDuplicate, onChanged })`.
- Archive/reactivate use revision-aware mutation.
- Delete unused visible only to OWNER/ADMIN and always online with named confirmation.

- [ ] **Step 1: Add failing UI tests** for INVENTORY archive/no-delete, OWNER delete action, confirmation naming entity, in-use delete message recommending Archive, stale archive conflict, and reactivation.
- [ ] **Step 2: Run** focused test and verify RED.
- [ ] **Step 3: Implement `catalog-actions.tsx`** with accessible confirmation dialog/sheet, actionable domain error mapping, and no unauthorized controls.
- [ ] **Step 4: Add API assertions** that direct unauthorized DELETE returns 403 and in-use DELETE returns `CATALOG_ITEM_IN_USE` without removing history.
- [ ] **Step 5: Run** Catalog web/API suites; expect PASS.
- [ ] **Step 6: Commit** `feat(catalog): complete archive reactivate and safe delete flows`.

## Task 8: Slice A regression and responsive acceptance

- [ ] **Step 1: Run Catalog/API focused suites** against isolated CI PostgreSQL.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/web test` and expect all web tests pass.
- [ ] **Step 3: Run** `DATABASE_URL=postgresql://tradeos@127.0.0.1:55432/tradeos_ci pnpm test` and expect full repository suite pass.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm --filter @tradeos/web build && git diff --check` and expect zero failures.
- [ ] **Step 5: Manual UAT** at 360, 390/393, 430, 768, 1024, 1280, 1440 for OWNER, INVENTORY, VIEWER/unauthorized direct-route behavior: no overflow, readable type, edit sheet keyboard/focus, archive/reactivate, stale conflict, offline pending state.
- [ ] **Step 6: Commit only evidence-backed hardening** as `fix(catalog): harden lifecycle CRUD acceptance` if changes are required.
- [ ] **Step 7: Record final Slice A SHA and clean worktree** before starting Slice B.
