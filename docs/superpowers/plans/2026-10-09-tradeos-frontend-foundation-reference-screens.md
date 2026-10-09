# TradeOS Frontend Foundation and Reference Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the TradeOS web frontend foundation and six reference screens into one coherent, modern, mobile-first design system without changing backend contracts, accounting rules, permissions, offline semantics, or posted-transaction behavior.

**Architecture:** Preserve the existing Next.js App Router, `WorkspaceProvider`, thin route files, feature workspaces, domain models, API calls, caches, and offline mutation queue. Strengthen the existing semantic token/CSS layers and UI primitives first, then refactor the application shell, then migrate Dashboard, Sell/POS, Catalog, Sales, Inventory, and Customers one feature workspace at a time. The first PR stops after these reference screens and does not migrate the remaining application modules.

**Tech Stack:** Next.js 16.3.8, React 19.3.0, TypeScript 5.9.x, Vitest 3.2.4, semantic CSS, pnpm 10.17.1, Node.js >=22.

**Spec:** `docs/superpowers/specs/2026-10-09-tradeos-frontend-rebuild-design.md`

**Scope guard:** `docs/superpowers/specs/2026-10-09-tradeos-frontend-rebuild-scope-note.md`

## Global Constraints

- Start from the latest `main`; implement on a dedicated branch such as `feat/tradeos-frontend-foundation`; do not merge directly to `main`.
- First implementation slice only: design foundation, shell/navigation, Dashboard, Sell/POS, Catalog, Sales history/detail, Inventory, and Customers.
- Preserve every existing public route and the current route-level component contracts.
- Preserve API contracts, backend behavior, accounting invariants, posted-transaction immutability, inventory movement semantics, permissions, feature cache behavior, and durable offline queue behavior.
- Do not add a purchased admin template or a second frontend framework.
- Do not introduce a UI library dependency unless the existing implementation cannot satisfy an accessibility requirement; any such dependency must be proposed separately before addition.
- Normal body text remains approximately 15–16px; touch-oriented controls are at least 48px high/tall where practical.
- Validate intentionally at 360px, 390px, 768px, and a desktop width of at least 1280px.
- Mobile is not a compressed desktop layout. Dense desktop tables must have a mobile list/card representation or an intentionally scrollable evidence view.
- No `window.alert`, `window.prompt`, or `window.confirm` in touched workflows. Use sheets, dialogs, inline validation, status regions, and structured confirmations.
- Clickable web controls require pointer cursor, hover/focus/pressed/disabled states, and visible keyboard focus.
- Offline messages use business language such as “3 sales waiting to sync”, not queue or transport jargon.
- AI recommendations, where rendered, must remain visually distinct from authoritative accounting facts.
- GHS amounts continue to render with the `₵` symbol.
- TDD for each task: failing test first, minimal implementation, passing task test, then commit.
- Before PR handoff run web tests, web typecheck, web build, then repository-wide tests/typecheck/lint where feasible.

## Review Focus

1. **Permission mismatch:** a role that may view but not mutate must never receive an enabled create/correction action. Task 2 and each feature task pin this with role-aware tests.
2. **Offline with and without cached data:** the screen must distinguish saved data from unavailable data and remain understandable. Tasks 3, 6, and 7 pin this behavior.
3. **Very long business, branch, product, customer, unit, and status labels at 360px:** no horizontal page overflow; labels wrap or truncate deliberately. Tasks 2, 4, 5, 8, and 9 cover this.
4. **Products with multiple sellable units and long conversion chains:** unit selection/conversion remains legible and cannot silently default to the wrong unit. Tasks 4 and 5 cover this.
5. **Loading, empty, recoverable error, success, and offline states:** every reference screen renders an intentional state instead of a blank or collapsed area. Task 1 defines the primitive; feature tasks and Task 9 verify use.

---

## File Structure Map

### Existing foundation to strengthen

- `apps/web/app/tradeos-tokens.css` — shared semantic tokens.
- `apps/web/app/ui-primitives.css` — reusable primitive styling.
- `apps/web/app/workspace-shell.css` — shell/navigation layout.
- `apps/web/app/workspace-polish.css` — shell interaction/responsive refinements; reduce duplication into the correct layer instead of growing this as a catch-all.
- `apps/web/app/globals.css` — application-level defaults only.
- `apps/web/app/components/ui/*` — presentational primitives with no API/workspace dependencies.
- `apps/web/app/components/workspace/*` — shell, role-aware nav, mobile nav, workspace boundaries.

### Reference feature boundaries

- Dashboard: `apps/web/app/components/dashboard/*`
- POS: `apps/web/app/components/pos/*`
- Catalog: `apps/web/app/components/catalog/*`
- Sales evidence: `apps/web/app/components/sales/*` with orchestration in `apps/web/app/components/sales-returns.tsx`
- Inventory: `apps/web/app/components/inventory/*` with orchestration in `apps/web/app/components/purchases-inventory.tsx`
- Customers: `apps/web/app/components/customers/*`

### New presentational primitives in this plan

- `apps/web/app/components/ui/command-bar.tsx`
- `apps/web/app/components/ui/state-panel.tsx`
- `apps/web/app/components/ui/mobile-record-card.tsx`

These remain API-free and business-domain-free.

---

### Task 1: Consolidate the design-system foundation and missing primitives

**Files:**
- Modify: `apps/web/app/tradeos-tokens.css`
- Modify: `apps/web/app/ui-primitives.css`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/components/ui/button.tsx`
- Modify: `apps/web/app/components/ui/page-header.tsx`
- Modify: `apps/web/app/components/ui/page-toolbar.tsx`
- Modify: `apps/web/app/components/ui/status-badge.tsx`
- Modify: `apps/web/app/components/ui/responsive-table.tsx`
- Create: `apps/web/app/components/ui/command-bar.tsx`
- Create: `apps/web/app/components/ui/state-panel.tsx`
- Create: `apps/web/app/components/ui/mobile-record-card.tsx`
- Modify/Test: `apps/web/app/components/ui/ui-primitives.test.tsx`

**Interfaces:**
- Preserve: `Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "default" | "compact" })`.
- Produce: `CommandBar({ ariaLabel, primaryAction, children }: { ariaLabel: string; primaryAction?: ReactNode; children: ReactNode })`.
- Produce: `StatePanel({ state, title, description, action }: { state: "loading" | "empty" | "error" | "offline" | "success"; title: string; description?: string; action?: ReactNode })`.
- Produce: `MobileRecordCard({ title, meta, status, actions, children }: { title: ReactNode; meta?: ReactNode; status?: ReactNode; actions?: ReactNode; children?: ReactNode })`.

- [ ] **Step 1: Write failing primitive-contract tests**

Add assertions in `ui-primitives.test.tsx` that render `CommandBar`, `StatePanel`, and `MobileRecordCard` and require stable classes `tradeos-command-bar`, `tradeos-state-panel`, and `tradeos-mobile-record-card`. Also assert all three source files contain no `/api/tradeos`, `clientApi`, or `useWorkspace`.

- [ ] **Step 2: Write failing token/accessibility tests**

Assert `tradeos-tokens.css` contains `--tos-text-body: 16px`, `--tos-touch-mobile: 48px`, semantic focus-ring, surface, border, positive, warning, danger, and info tokens; assert `ui-primitives.css` has visible `:focus-visible` styling and no normal-control font sizes below 12px.

- [ ] **Step 3: Run the primitive test and verify it fails**

Run: `pnpm --filter @tradeos/web test -- app/components/ui/ui-primitives.test.tsx`

Expected: FAIL because the three new primitives and/or required token contracts do not exist yet.

- [ ] **Step 4: Implement the new primitive components**

Create the three components with only semantic markup, props above, and stable class names. Do not place business labels, data fetching, routing, or workspace state inside them.

- [ ] **Step 5: Consolidate tokens and primitive CSS**

Keep the existing TradeOS midnight/gold identity restrained; define the focus ring, control heights, surfaces, spacing, typography hierarchy, mobile record-card behavior, state-panel behavior, command-bar layout, and consistent interactive states in `tradeos-tokens.css` and `ui-primitives.css`.

- [ ] **Step 6: Run the primitive test and verify it passes**

Run: `pnpm --filter @tradeos/web test -- app/components/ui/ui-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/tradeos-tokens.css apps/web/app/ui-primitives.css apps/web/app/globals.css apps/web/app/components/ui
git commit -m "feat(web): strengthen TradeOS design system primitives"
```

---

### Task 2: Rebuild the application shell and role-aware navigation presentation

**Files:**
- Modify: `apps/web/app/components/workspace/app-shell.tsx`
- Modify: `apps/web/app/components/workspace/mobile-bottom-nav.tsx`
- Modify: `apps/web/app/components/workspace/mobile-more-sheet.tsx`
- Modify: `apps/web/app/components/workspace/workspace-navigation.ts`
- Modify: `apps/web/app/workspace-shell.css`
- Modify: `apps/web/app/workspace-polish.css`
- Modify/Test: `apps/web/app/components/workspace/app-shell.test.tsx`
- Modify/Test: `apps/web/app/components/workspace/professional-shell.test.tsx`
- Modify/Test: `apps/web/app/components/workspace/route-composition.test.tsx`

**Interfaces:**
- Preserve: `AppShell({ children }: { children: ReactNode })`.
- Preserve: current `visibleWorkspaceNav(role)` and `isWorkspaceNavActive(pathname, href)` callers.
- Preserve: `MobileBottomNav` and `MobileMoreSheet` external props unless tests prove a new optional presentational prop is required.

- [ ] **Step 1: Add failing shell tests for hierarchy and active state**

Require grouped desktop navigation, exactly one active item for nested paths, business/branch context, account menu, and mobile navigation with a `More` entry rather than the full desktop navigation compressed into the phone layout.

- [ ] **Step 2: Add failing shell tests for permission presentation**

For a read-only role, assert mutation-only destinations/actions are not promoted in the primary mobile navigation. Preserve backend authority; this test covers presentation only.

- [ ] **Step 3: Add failing responsive-source assertions**

Require `workspace-shell.css` to include `min-width: 0` on content containers, a mobile breakpoint at/under 768px, bottom-nav safe-area padding, and no fixed content width that forces overflow at 360px.

- [ ] **Step 4: Run shell tests and verify failure**

Run: `pnpm --filter @tradeos/web test -- app/components/workspace/app-shell.test.tsx app/components/workspace/professional-shell.test.tsx app/components/workspace/route-composition.test.tsx`

Expected: FAIL on new hierarchy/responsive contracts.

- [ ] **Step 5: Refactor `AppShell` composition without changing workspace behavior**

Keep business switching, branch switching, profile/logout, `NetworkStatus`, `WorkspaceProvider`, and role-based navigation logic intact. Replace only visual composition and interaction hierarchy.

- [ ] **Step 6: Rework mobile navigation and More sheet**

Use a small role-aware set of highest-frequency destinations, persistent Sell prominence when permitted, and a structured More sheet for the rest. Long business/branch/user names must not widen the viewport.

- [ ] **Step 7: Rework shell CSS**

Implement deliberate desktop/tablet/mobile layout, visible keyboard focus, 48px touch controls on mobile, clear active states, calm offline indication, and content containers that allow child grids to shrink.

- [ ] **Step 8: Run shell tests and verify they pass**

Run the command from Step 4.

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/components/workspace apps/web/app/workspace-shell.css apps/web/app/workspace-polish.css
git commit -m "feat(web): rebuild TradeOS application shell"
```

---

### Task 3: Recompose Dashboard as a role-aware operational command center

**Files:**
- Modify: `apps/web/app/components/dashboard/dashboard-command-center.tsx`
- Modify only if presentation mapping requires it: `apps/web/app/components/dashboard/dashboard-actions.ts`
- Do not change business meaning in: `apps/web/app/components/dashboard/dashboard-model.ts`
- Modify: `apps/web/app/dashboard.css`
- Modify/Test: `apps/web/app/components/dashboard/dashboard-command-center.test.tsx`
- Modify/Test if needed: `apps/web/app/components/dashboard/dashboard-actions.test.ts`

**Interfaces:**
- Preserve the current `DashboardCommandCenter` props consumed by `apps/web/app/(workspace)/dashboard/page.tsx`.
- Consume existing dashboard model/data only; do not invent metrics that the API/model does not provide.
- Reuse `StatePanel`, `StatusBadge`, `Button`, and existing dashboard model types.

- [ ] **Step 1: Add failing tests for owner/manager prioritization**

Assert the rendered hierarchy places business state and exceptions/actions before secondary trends; owner/manager output may include sales/cash/credit/stock signals only when provided by the current model.

- [ ] **Step 2: Add failing tests for cashier/frontline prioritization**

Assert frontline roles promote Sell/current-operating context and do not lead with owner-only analytical content.

- [ ] **Step 3: Add failing state tests**

Pin loading, partial cached/offline, and empty/error copy to intentional state regions rather than blank panels.

- [ ] **Step 4: Run dashboard tests and verify failure**

Run: `pnpm --filter @tradeos/web test -- app/components/dashboard/dashboard-command-center.test.tsx app/components/dashboard/dashboard-actions.test.ts`

Expected: FAIL on the new hierarchy/state assertions.

- [ ] **Step 5: Recompose the command center**

Use a small primary summary area, action/exception area, supporting trend/activity area, and AI insight area only where existing data supports it. Every metric must drill to an existing route/action or communicate a real state.

- [ ] **Step 6: Implement dashboard responsive layout**

At 360/390px use a single-column task hierarchy; at 768px use limited two-column composition; at desktop allow denser multi-column layout without tiny text.

- [ ] **Step 7: Run dashboard tests and verify pass**

Run the command from Step 4.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/components/dashboard apps/web/app/dashboard.css
git commit -m "feat(web): redesign role-aware TradeOS dashboard"
```

---

### Task 4: Rebuild Sell/POS as the flagship touch-first workflow

**Files:**
- Modify: `apps/web/app/components/pos/pos-workspace.tsx`
- Modify: `apps/web/app/components/pos/product-browser.tsx`
- Modify: `apps/web/app/components/pos/cart-panel.tsx`
- Modify: `apps/web/app/components/pos/customer-picker.tsx`
- Modify: `apps/web/app/components/pos/checkout-sheet.tsx`
- Preserve business calculations in: `apps/web/app/components/pos/pos-model.ts`
- Modify: `apps/web/app/pos.css`
- Modify: `apps/web/app/pos-workspace.css`
- Modify/Test: `apps/web/app/components/pos/pos-workspace.test.tsx`
- Modify/Test: `apps/web/app/components/pos/pos-cart.test.tsx`
- Modify/Test: `apps/web/app/components/pos/customer-picker.test.tsx`
- Modify/Test: `apps/web/app/components/pos/checkout-sheet.test.tsx`
- Preserve model tests: `apps/web/app/components/pos/pos-model.test.ts`

**Interfaces:**
- Preserve `PosWorkspace` props used by `/sell`: `businessId`, `branchId`, `currencyCode`, `role`, `items`.
- Preserve `PosSellableItem` and existing pricing/unit calculation functions from `pos-model.ts`.
- Do not change sale mutation payloads, payment semantics, or offline enqueue/flush behavior.

- [ ] **Step 1: Add failing product-browser tests**

Assert search/category controls remain easy to identify, each sellable item exposes its selected sell unit, multi-unit items allow explicit unit selection, and empty search results render an intentional empty state.

- [ ] **Step 2: Add failing cart tests**

Assert quantity and unit remain editable, totals remain visible, long product/unit names do not remove controls from the markup, and destructive cart actions use explicit buttons rather than text-only hidden affordances.

- [ ] **Step 3: Add failing checkout/customer tests**

Assert customer remains optional, payment choices remain clear, permission-dependent discount controls stay permission dependent, checkout status/error feedback uses an accessible status region, and offline-safe copy remains present.

- [ ] **Step 4: Run POS tests and verify failure**

Run: `pnpm --filter @tradeos/web test -- app/components/pos/pos-workspace.test.tsx app/components/pos/pos-cart.test.tsx app/components/pos/customer-picker.test.tsx app/components/pos/checkout-sheet.test.tsx app/components/pos/pos-model.test.ts`

Expected: FAIL on new presentation/state assertions; existing model tests must remain green.

- [ ] **Step 5: Recompose `PosWorkspace`**

Desktop: product discovery and cart/checkout must be visually balanced without hiding the running total. Mobile: product discovery and cart become intentional stacked/sheet-based flows with a persistent next action, not a squeezed two-column layout.

- [ ] **Step 6: Restyle product, cart, customer, and checkout components**

Use shared buttons/status/state patterns, 48px touch interactions, readable unit selectors, restrained visual emphasis, and no backend/domain changes.

- [ ] **Step 7: Run POS tests and verify pass**

Run the command from Step 4.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/components/pos apps/web/app/pos.css apps/web/app/pos-workspace.css
git commit -m "feat(web): rebuild TradeOS POS experience"
```

---

### Task 5: Rebuild Catalog around product/service lifecycle and unit clarity

**Files:**
- Modify: `apps/web/app/components/catalog/catalog-workspace.tsx`
- Modify: `apps/web/app/components/catalog/catalog-list.tsx`
- Modify: `apps/web/app/components/catalog/catalog-actions.tsx`
- Modify: `apps/web/app/components/catalog/catalog-item-sheet.tsx`
- Modify: `apps/web/app/catalog.css`
- Modify/Test: `apps/web/app/components/catalog/catalog-workspace.test.tsx`
- Modify/Test: `apps/web/app/components/catalog/catalog-actions.test.tsx`
- Modify/Test: `apps/web/app/components/catalog/catalog-item-sheet.test.tsx`

**Interfaces:**
- Preserve `CatalogWorkspace` props consumed by `/catalog`: `businessId`, `branchId`, `currencyCode`, `role`, `items`, `onRefresh`.
- Preserve create/edit/archive/reactivate API behavior and existing item/unit data types.
- Consume `CommandBar`, `MobileRecordCard`, `StatePanel`, `StatusBadge`, and `Button` from Task 1.

- [ ] **Step 1: Add failing list/workspace tests**

Assert the command row exposes search/filter and primary action coherently; product/service type, active/archive state, pricing context, stock/base/selling-unit summary, and empty state are legible.

- [ ] **Step 2: Add failing multi-unit tests**

Use a fixture with a long conversion chain and multiple sell units; assert the UI renders conversion meaning explicitly and does not collapse it to an ambiguous single unit.

- [ ] **Step 3: Add failing permission tests**

For a role without catalog mutation permission, assert create/edit/archive controls are absent or disabled while catalog information remains readable.

- [ ] **Step 4: Run catalog tests and verify failure**

Run: `pnpm --filter @tradeos/web test -- app/components/catalog/catalog-workspace.test.tsx app/components/catalog/catalog-actions.test.tsx app/components/catalog/catalog-item-sheet.test.tsx`

Expected: FAIL on new command/mobile/unit assertions.

- [ ] **Step 5: Recompose catalog workspace/list**

Desktop uses a concise command row and information-dense records; mobile uses record cards. Use progressive disclosure for conversion/price/lifecycle detail rather than displaying every field in the list.

- [ ] **Step 6: Recompose item sheet**

Group identity, item kind, buying/stocking/selling units, pricing/cost, and lifecycle into clear form sections. Keep all existing data and mutation behavior.

- [ ] **Step 7: Run catalog tests and verify pass**

Run the command from Step 4.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/components/catalog apps/web/app/catalog.css
git commit -m "feat(web): redesign TradeOS catalog and unit UX"
```

---

### Task 6: Rebuild Sales as immutable transaction evidence with responsive history/detail

**Files:**
- Prefer not to modify orchestration: `apps/web/app/components/sales-returns.tsx`
- Modify: `apps/web/app/components/sales/sales-workspace.tsx`
- Modify: `apps/web/app/components/sales/sale-detail-sheet.tsx`
- Modify: `apps/web/app/sales-returns.css`
- Modify: `apps/web/app/transaction-evidence.css`
- Modify/Test: `apps/web/app/components/sales/sales-workspace.test.tsx`
- Modify/Test: `apps/web/app/components/sales/sale-detail-sheet.test.tsx`

**Interfaces:**
- Preserve `SalesWorkspace` callback contract: `onSelect(saleId)` and `onSearch(search)`.
- Preserve `SaleDetailSheet` sale data and `canProcessReturns` contract.
- `SalesAndReturns` continues to own fetching, cache fallback, offline messaging, detail loading, and return/refund orchestration.

- [ ] **Step 1: Add failing sales-history tests**

Assert search sits in a clear command area; each record exposes receipt reference, date/operator or party context where available, amount, payment/status state, and a detail action. Mobile markup must use a record-card representation rather than rely solely on the desktop table.

- [ ] **Step 2: Add failing evidence-detail tests**

Assert the detail sheet renders the posted sale as evidence, contains no generic edit/delete affordance for posted history, and shows return/correction action only when `canProcessReturns` is true.

- [ ] **Step 3: Add failing offline/message presentation test**

Pin cached/offline/error messages to an accessible status region without altering `SalesAndReturns` fetching behavior.

- [ ] **Step 4: Run sales tests and verify failure**

Run: `pnpm --filter @tradeos/web test -- app/components/sales/sales-workspace.test.tsx app/components/sales/sale-detail-sheet.test.tsx`

Expected: FAIL on new evidence/mobile/state assertions.

- [ ] **Step 5: Recompose history and detail presentation**

Use shared command/status/record patterns. Keep transaction evidence immutable; correction actions are separate and contextual.

- [ ] **Step 6: Update sales/evidence CSS**

Desktop may use table/detail density; mobile must remain readable without full-page horizontal overflow. Receipt evidence that genuinely needs width may scroll inside its own bounded region.

- [ ] **Step 7: Run sales tests and verify pass**

Run the command from Step 4.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/components/sales apps/web/app/sales-returns.css apps/web/app/transaction-evidence.css
git commit -m "feat(web): redesign sales history and evidence views"
```

---

### Task 7: Rebuild Inventory around movement-derived stock and correction workflows

**Files:**
- Prefer not to modify orchestration/data loading: `apps/web/app/components/purchases-inventory.tsx`
- Modify: `apps/web/app/components/inventory/inventory-workspace.tsx`
- Modify: `apps/web/app/components/inventory/inventory-detail-sheet.tsx`
- Modify: `apps/web/app/components/inventory/inventory-adjustment-sheet.tsx`
- Modify: `apps/web/app/purchases-inventory.css`
- Modify/Test: `apps/web/app/components/inventory/inventory-workspace.test.tsx`
- Modify/Test: `apps/web/app/components/inventory/inventory-detail-sheet.test.tsx`
- Modify/Test: `apps/web/app/components/inventory/inventory-adjustment-sheet.test.tsx`

**Interfaces:**
- Preserve `InventoryWorkspace` props currently supplied by `PurchasesInventory`.
- Preserve inventory detail/movement types and `INVENTORY_ADJUSTMENT_CREATE` mutation semantics.
- Never introduce an “edit balance” operation.

- [ ] **Step 1: Add failing inventory-list tests**

Assert each item communicates available/on-hand context, unit, risk/empty state, and detail action; mobile renders a record-card representation.

- [ ] **Step 2: Add failing movement-detail tests**

Assert the detail sheet leads with current item state then movement evidence, and movement history remains distinguishable from editable fields.

- [ ] **Step 3: Add failing adjustment tests**

Assert adjustment UI language frames the operation as a correction/reclassification with reason, not direct balance editing; permission-restricted roles must not receive an enabled adjustment action.

- [ ] **Step 4: Add failing offline-detail test**

When movement detail has not been cached and the device is offline, require an intentional offline state. When cached, require saved movement evidence to remain readable.

- [ ] **Step 5: Run inventory tests and verify failure**

Run: `pnpm --filter @tradeos/web test -- app/components/inventory/inventory-workspace.test.tsx app/components/inventory/inventory-detail-sheet.test.tsx app/components/inventory/inventory-adjustment-sheet.test.tsx`

Expected: FAIL on new presentation/state assertions.

- [ ] **Step 6: Recompose inventory list/detail/adjustment presentation**

Use shared command, status, state, and mobile-card patterns; preserve all existing load/cache/mutation ownership in `PurchasesInventory`.

- [ ] **Step 7: Run inventory tests and verify pass**

Run the command from Step 5.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/components/inventory apps/web/app/purchases-inventory.css
git commit -m "feat(web): redesign movement-derived inventory UX"
```

---

### Task 8: Rebuild Customers as the representative master-data pattern

**Files:**
- Modify: `apps/web/app/components/customers/customer-workspace.tsx`
- Modify: `apps/web/app/components/customers/customer-sheet.tsx`
- Preserve types: `apps/web/app/components/customers/customer-types.ts`
- Modify: `apps/web/app/customers-credit.css`
- Modify: `apps/web/app/master-data.css`
- Modify/Test: `apps/web/app/components/customers/customer-workspace.test.tsx`
- Modify/Test: `apps/web/app/components/customers/customer-sheet.test.tsx`

**Interfaces:**
- Preserve `CustomerWorkspace({ businessId, branchId, currencyCode, role })` as consumed by `/customers`.
- Preserve customer lifecycle, receivable/credit, payment, and history API behavior.
- Use this feature as the reusable visual pattern for later Supplier and other master-data migrations, but do not migrate them in this PR.

- [ ] **Step 1: Add failing workspace tests**

Assert the workspace provides a clear search/command row, customer identity, balance/credit state, lifecycle state, recent context, empty state, and a mobile record representation.

- [ ] **Step 2: Add failing role/lifecycle tests**

Assert users without mutation permission can inspect customer data but do not receive enabled create/edit/payment/lifecycle actions that their role cannot perform.

- [ ] **Step 3: Add failing sheet tests**

Assert create/edit/detail sections use business language, long customer names/contact values remain structurally contained, and action/status regions are accessible.

- [ ] **Step 4: Run customer tests and verify failure**

Run: `pnpm --filter @tradeos/web test -- app/components/customers/customer-workspace.test.tsx app/components/customers/customer-sheet.test.tsx`

Expected: FAIL on the new master-data pattern assertions.

- [ ] **Step 5: Recompose customer workspace and sheet**

Create a clear identity + balance/credit + activity/history + lifecycle hierarchy. Avoid generic CRUD-table presentation and preserve posted transaction history semantics.

- [ ] **Step 6: Run customer tests and verify pass**

Run the command from Step 4.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/customers apps/web/app/customers-credit.css apps/web/app/master-data.css
git commit -m "feat(web): establish TradeOS master-data UX with customers"
```

---

### Task 9: Run cross-screen responsive, accessibility, interaction, and regression hardening

**Files:**
- Modify/Test: `apps/web/app/components/workspace/release-hardening.test.ts`
- Modify/Test: `apps/web/app/components/workspace/route-composition.test.tsx`
- Create/Test: `apps/web/app/components/workspace/frontend-reference-screens.test.ts`
- Create: `docs/qa/2026-10-09-tradeos-frontend-reference-screens.md`
- Modify only when failures identify a real issue: CSS/component files from Tasks 1–8.

**Interfaces:**
- No new product interfaces.
- This task verifies the public route and visual-contract surface produced by Tasks 1–8.

- [ ] **Step 1: Write the cross-screen static contract test**

`frontend-reference-screens.test.ts` reads the six route files and relevant CSS/source. Assert routes still compose `DashboardCommandCenter`, `PosWorkspace`, `CatalogWorkspace`, `SalesAndReturns`, `PurchasesInventory`, and `CustomerWorkspace`; touched source contains no `window.alert(`, `window.prompt(`, or `window.confirm(`; token/shell/feature CSS retains mobile/tablet breakpoints; and reference-screen containers opt into shrink-safe layouts.

- [ ] **Step 2: Run the new hardening test and verify failure if any contract is missing**

Run: `pnpm --filter @tradeos/web test -- app/components/workspace/frontend-reference-screens.test.ts app/components/workspace/release-hardening.test.ts app/components/workspace/route-composition.test.tsx`

Expected: PASS only after every cross-screen contract is satisfied.

- [ ] **Step 3: Run the complete web test suite**

Run: `pnpm --filter @tradeos/web test`

Expected: PASS.

- [ ] **Step 4: Run web typecheck**

Run: `pnpm --filter @tradeos/web typecheck`

Expected: PASS with zero TypeScript errors.

- [ ] **Step 5: Run web production build**

Run: `pnpm --filter @tradeos/web build`

Expected: successful Next.js production build.

- [ ] **Step 6: Run repository regression checks**

Run: `pnpm test && pnpm typecheck && pnpm lint`

Expected: PASS. If an unrelated pre-existing failure exists, record exact command/output in the QA note instead of suppressing it.

- [ ] **Step 7: Perform visual responsive UAT**

Using available browser tooling, capture or inspect Dashboard, Sell/POS, Catalog, Sales, Inventory, and Customers at 360px, 390px, 768px, and at least 1280px. Check: no page-level horizontal overflow; readable 15–16px body text; 48px touch targets on mobile; command rows align on desktop; mobile nav does not obscure actions; sheets fit the viewport; long names/units wrap or truncate intentionally; focus is visible; empty/loading/error/offline states are not blank.

- [ ] **Step 8: Record QA evidence**

In `docs/qa/2026-10-09-tradeos-frontend-reference-screens.md`, record commit SHA, tested widths, routes, pass/fail results, screenshots/evidence locations when tooling supports them, and any deferred Phase 3/4 items. Do not claim screenshot evidence if the execution environment cannot capture it.

- [ ] **Step 9: Commit hardening and QA evidence**

```bash
git add apps/web/app/components/workspace docs/qa/2026-10-09-tradeos-frontend-reference-screens.md
git commit -m "test(web): harden TradeOS frontend reference screens"
```

- [ ] **Step 10: Open the review PR**

Open one PR from the dedicated branch to `main`. The PR body must link Issue #36, the frontend design spec, this implementation plan, and the QA note; list reference screens changed; state explicitly that backend/API/domain behavior was intentionally not changed; and list any backend improvements as proposals only.

---

## Explicit Non-Goals for This Plan

Do not migrate Returns, Purchases, Suppliers, Cashbook, Operations, Reports, native desktop, React Native mobile, or system-admin beyond incidental shared-token compatibility. Do not create new business-pack workflows. Do not rewrite existing API/orchestration logic merely to simplify component styling. These become follow-on plans after the reference-screen PR is reviewed and the design system is proven.

## Completion Gate

This plan is complete only when the six reference screens visibly share one coherent TradeOS design language, mobile and desktop both look intentional, existing business behavior remains unchanged, all specified tests/build checks pass or documented pre-existing failures are surfaced, and the work is available in a reviewable PR rather than merged directly to `main`.
