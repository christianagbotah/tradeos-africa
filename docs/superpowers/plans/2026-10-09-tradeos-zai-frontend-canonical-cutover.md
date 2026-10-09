# TradeOS Z.ai Frontend Canonical Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hybrid/legacy authenticated web frontend and make the corrected Z.ai frontend foundation the only canonical TradeOS workspace UI while preserving backend, domain, accounting, permissions, offline-sync, and route contracts.

**Architecture:** Start from Z.ai corrected head `87485fe52fe0ad632190362d5b6de39deb0413fe`. Keep API/domain/offline code unchanged. Migrate every remaining authenticated route into the Z.ai design system (`tradeos-tokens.css`, shared primitives, Z.ai application shell, reference-screen patterns), then delete superseded legacy coordinators and global polish layers once no route imports or class contracts depend on them.

**Tech Stack:** Next.js 16.3.8, React 19.3, TypeScript 5.9, Vitest 3.2.4, semantic CSS, pnpm 10.17.1, Node >=22.

**Spec:** `docs/superpowers/specs/2026-10-09-tradeos-frontend-rebuild-design.md`

## Global Constraints

- Z.ai corrected frontend head is the visual/interaction baseline; do not reintroduce the previous assistant-authored workspace look.
- Preserve all backend/API/domain/accounting contracts and route URLs.
- Posted sales and purchases remain immutable evidence; corrections remain linked transactions.
- Inventory balances remain movement-derived; no direct on-hand overwrite UI.
- Offline mutations remain durable and idempotent.
- Permissions remain server-authoritative; VIEWER stays read-only.
- Normal text remains 15–16px and mobile touch controls remain at least 48px.
- Desktop search/filter/primary actions share a command row; mobile reflows intentionally.
- No browser `alert`, `prompt`, or `confirm` transaction flows.
- Final root layout must not import legacy workspace-polish/global module layers that only exist to skin old components.

## Canonical frontend files

The new authenticated frontend must converge on:

- `apps/web/app/tradeos-tokens.css`
- `apps/web/app/ui-primitives.css`
- `apps/web/app/workspace-shell.css`
- module-specific Z.ai-aligned styles (`dashboard.css`, `catalog.css`, `pos.css`, and migrated equivalents)
- `apps/web/app/components/ui/*`
- `apps/web/app/components/workspace/*`
- Z.ai reference screen component patterns for Dashboard, POS, Catalog, Sales, Inventory, Customers

## Legacy layers to eliminate from authenticated workspace

These may remain temporarily on this isolated branch only while their consuming screens are migrated; none may survive the final cutover if still acting as legacy skinning layers:

- `apps/web/app/workspace-polish.css`
- `apps/web/app/real-app.css` workspace-specific rules (auth/onboarding styles must be split if still needed publicly)
- `apps/web/app/pos-workspace.css` after required POS rules are consolidated into canonical POS styling
- legacy monolithic/coordinator UI that duplicates migrated workspace components, including old purchase, return, cashbook, operations, and report presentation layers
- duplicate global `.panel`, `.metric-card`, `.primary-button`, `.ghost-button`, `.topbar`, `.sidebar`, `.app-shell`, `.workspace` presentation contracts once their routes use Z.ai primitives/shell

## Review Focus

- No route silently falls back to an old global class after its migration.
- Public login/onboarding does not break when workspace-only legacy CSS is removed.
- Long business/branch/customer names do not create horizontal overflow at 360/390/768.
- VIEWER/read-only roles never receive promoted mutation actions after component migration.
- Offline pending/rejected/applied states remain truthful and visible through the new UI.

---

### Task 1: Establish the canonical Z.ai frontend boundary

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: canonical CSS files as needed
- Test: `apps/web/app/components/workspace/frontend-reference-screens.test.ts`

- [x] Add a regression test that inventories root CSS imports and fails when forbidden legacy workspace skinning imports survive the final cutover.
- [x] Consolidate reference-screen styles so Dashboard/POS/Catalog/Sales/Inventory/Customers do not depend on `workspace-polish.css`.
- [x] Consolidate `pos-workspace.css` behavior into canonical `pos.css`, update tests, remove its root import, then delete the file.
- [x] Split public auth/setup styles out of `real-app.css` before removing its workspace-wide import.
- [x] Verify six Z.ai reference screens still pass tests/typecheck/build.

### Task 2: Migrate Returns / Refunds / Exchanges to Z.ai patterns

**Files:**
- Modify: `apps/web/app/components/returns/*`
- Modify: `apps/web/app/components/sales-returns.tsx` only as orchestration is needed
- Replace legacy return styling with a focused Z.ai-aligned module stylesheet
- Tests: existing returns/exchange tests plus responsive contracts

- [x] Replace old return list/panel styling with `CommandBar`, `MobileRecordCard`, `StatePanel`, transaction evidence and Z.ai sheet patterns.
- [x] Preserve remaining-returnable quantity, disposition, refund destination, reason, processing status, actor/audit evidence and deep links.
- [x] Preserve exchange offline queue and linked replacement/return evidence.
- [x] Remove obsolete return-specific legacy selectors after tests prove no dependency.

### Task 3: Migrate Purchases + Suppliers

**Files:**
- Modify: `apps/web/app/components/purchases/*`
- Modify: `apps/web/app/components/suppliers/*`
- Retire presentation code from `purchases-inventory.tsx` once orchestration is split
- Replace legacy purchase/inventory styling with focused canonical module styles

- [ ] Recompose purchase receiving, supplier workspace, posted purchase evidence and purchase-return entry points using Z.ai primitives.
- [ ] Preserve supplier terms, invoice/reference, multi-unit receiving, payment/account and stock conversion behavior.
- [ ] Delete duplicated old presentation code and selectors only after route-level tests pass.

### Task 4: Migrate Cashbook + Treasury

**Files:**
- Modify: `apps/web/app/components/cashbook/*`
- Modify: treasury workspace/components as needed
- Replace legacy cashbook presentation selectors with canonical module styles

- [ ] Rebuild cash position, income/expense entry, accounts, history, reconciliation and treasury surfaces on the Z.ai layout grammar.
- [ ] Preserve server-authoritative money effects and role permissions.
- [ ] Remove duplicated `panel`/table/button skinning inherited from old workspace CSS.

### Task 5: Migrate Operations

**Files:**
- Modify: `apps/web/app/components/operations-reconciliation.tsx`
- Modify: `apps/web/app/(workspace)/operations/page.tsx` only if composition requires

- [ ] Replace old form/table styling with Z.ai command/state/record patterns.
- [ ] Preserve operating day/shift/reconciliation contracts and permissions.
- [ ] Remove operations selectors from legacy global styles.

### Task 6: Migrate Reports + AI insight surfaces

**Files:**
- Refactor: `apps/web/app/components/financial-reports.tsx` into focused report components where needed
- Modify: report/cash forecast/CFO presentation components
- Add focused report styling using Z.ai tokens/primitives

- [ ] Recompose reports around business questions, summaries, drill-down evidence and action-oriented AI insight cards.
- [ ] Preserve report contracts and multi-branch behavior.
- [ ] Remove old `ai-panel`, working-capital and CFO skinning from global legacy files.

### Task 7: Remove the legacy frontend layer completely

**Files:**
- Delete/trim: `apps/web/app/workspace-polish.css`
- Delete/trim: `apps/web/app/real-app.css` after public styles are relocated
- Delete obsolete monolithic frontend components proven unused by search/tests
- Modify: `apps/web/app/layout.tsx`
- Tests: route composition + source contract tests

- [ ] Search every legacy filename/class and prove no live authenticated route depends on it.
- [ ] Delete the legacy skinning files and duplicate presentation components.
- [ ] Root layout imports only canonical Z.ai/shared styles plus explicitly migrated module styles.
- [ ] Add regression assertions preventing legacy imports/classes from returning.

### Task 8: Whole-app responsive/accessibility verification

- [ ] Run web tests.
- [ ] Run web typecheck/lint.
- [ ] Run production build.
- [ ] Verify source/layout contracts for 360, 390, 768 and >=1280 widths.
- [ ] Verify keyboard focus, Escape/Tab sheet behavior, 48px mobile targets and no horizontal overflow.
- [ ] Perform rendered browser UAT when a runnable backend/preview is available; otherwise record it explicitly as the only staging UAT item.

### Task 9: Final cutover PR

- [ ] Compare the branch against Z.ai corrected head, not against the earlier assistant UI.
- [ ] Confirm no backend/domain/accounting/offline contract drift.
- [ ] Confirm the legacy frontend deletion list is empty or every retained file has a documented non-workspace purpose.
- [ ] Open one PR for the canonical Z.ai frontend cutover and do not merge until final review is clean.
