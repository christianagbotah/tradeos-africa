# TradeOS Multi-Page UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated single-page TradeOS workspace with real route-level pages in a persistent professional application shell, using the Cashbook & Expenses route as the first fully modernized reference page while preserving existing business behavior.

**Architecture:** Keep `/` as the public authentication/onboarding entry. Add an App Router `(workspace)` route group with a shared client `WorkspaceProvider` and `AppShell`; route pages consume the provider rather than mounting every feature at once. Existing domain components remain the source of mutation/API logic; combined modules receive route-specific view props/wrappers instead of duplicated implementations.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Vitest, existing TradeOS client API/offline-sync utilities and CSS stack.

**Spec:** `docs/superpowers/specs/2026-10-07-tradeos-multipage-ux-design.md`

## Global Constraints

- Authenticated TradeOS must use real URL routes, not sidebar hash anchors, for major modules.
- `/` remains public login/registration/first-business setup; authenticated users with a usable business are redirected to `/dashboard`.
- Preserve authentication, business/branch context, role/staff context, offline mutation queues, API semantics and all existing money calculations.
- Do not duplicate business mutations when splitting combined modules across routes.
- Desktop: >=1280px; tablet: 768–1279px; mobile: <768px.
- Controls use label-above-field treatment and 44–48px minimum interactive height; no raw browser-default form presentation.
- Major pages must not create horizontal viewport overflow; tables scroll within their own containers when necessary.
- Navigation uses `aria-current="page"`, remains role-aware, and backend authorization remains authoritative.
- Cashbook redesign changes presentation/composition only; accounting and money semantics are unchanged.

## Review Focus

- **Direct navigation to a workspace URL with no valid session:** redirect to `/` without rendering protected module content. Test in Task 2.
- **Business/branch changes while staying on or moving between routes:** provider state and persisted active business remain coherent without re-authentication. Test in Task 2.
- **Role navigation drift:** CASHIER/VIEWER must not be shown management destinations/actions they cannot meaningfully use. Test in Task 3 and Task 8.
- **Offline Cashbook entry during route-based rendering:** pending count, queueing and rejected-sync states must still work. Test in Task 5.
- **Responsive data-heavy pages:** shell/content must not overflow the viewport; Cashbook tables/forms must collapse/scroll locally. Test in Task 6 and visual verification in Task 9.

---

### Task 1: Extract public entry from the authenticated workspace

**Files:**
- Create: `apps/web/app/components/public-entry.tsx`
- Create: `apps/web/app/lib/workspace-types.ts`
- Modify: `apps/web/app/components/tradeos-web-app.tsx`
- Modify: `apps/web/app/page.tsx`
- Test: `apps/web/app/components/public-entry.test.tsx`

**Interfaces:**
- Produces: exported `PublicEntry` component that owns session resolution for `/`, login/register, first-business onboarding, and redirects an already configured authenticated user to `/dashboard`.
- Produces: shared exported types `Membership`, `MePayload`, `BusinessContext`, `CatalogUnit`, `CatalogItem` in `workspace-types.ts` for the provider and feature pages.
- Consumes: existing `/api/session/*`, onboarding API, demo account selector, `getActiveBusinessId`/`setActiveBusinessId` behavior.

- [ ] **Step 1: Write failing public-entry tests**

Add tests named `redirects_configured_session_to_dashboard`, `keeps_unauthenticated_user_on_public_auth`, and `keeps_member_without_business_context_in_onboarding`. Assert `/dashboard` navigation only occurs after a configured business context is resolved.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm --filter @tradeos/web test -- public-entry.test.tsx`
Expected: FAIL because `PublicEntry` and extracted workspace types do not exist.

- [ ] **Step 3: Extract public-only behavior**

Move `AuthScreen`, `BusinessOnboarding`, public session probing and relevant helpers out of `tradeos-web-app.tsx` into `public-entry.tsx`. Export shared types from `workspace-types.ts`. Make `app/page.tsx` render `PublicEntry`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @tradeos/web test -- public-entry.test.tsx && pnpm --filter @tradeos/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/page.tsx apps/web/app/components/public-entry.tsx apps/web/app/components/tradeos-web-app.tsx apps/web/app/lib/workspace-types.ts apps/web/app/components/public-entry.test.tsx
git commit -m "refactor: separate TradeOS public entry from workspace"
```

### Task 2: Add the shared authenticated workspace provider and route group

**Files:**
- Create: `apps/web/app/components/workspace/workspace-provider.tsx`
- Create: `apps/web/app/components/workspace/workspace-boundary.tsx`
- Create: `apps/web/app/components/workspace/use-workspace.ts`
- Create: `apps/web/app/(workspace)/layout.tsx`
- Create: `apps/web/app/(workspace)/dashboard/page.tsx`
- Test: `apps/web/app/components/workspace/workspace-provider.test.tsx`

**Interfaces:**
- Produces: `WorkspaceContextValue` with `session`, `context`, `branchId`, `activeBranch`, `catalog`, `sellableItems`, `setBusiness(businessId)`, `setBranch(branchId)`, `refreshBusiness()`, and `logout()`.
- Produces: `useWorkspace(): WorkspaceContextValue`.
- Consumes: `/api/session/me`, `/api/tradeos/v1/businesses/:id/context`, `/api/tradeos/v1/catalog/items`, existing active-business persistence, existing `QuickSaleItem` projection logic.

- [ ] **Step 1: Write failing provider tests**

Cover: unauthenticated direct workspace access redirects to `/`; selected business loads once then survives route-child rerender; business switch updates persisted active business; branch switch changes provider state without reloading session; catalog/sellable projection remains equivalent to current behavior.

- [ ] **Step 2: Run provider tests and verify RED**

Run: `pnpm --filter @tradeos/web test -- workspace-provider.test.tsx`
Expected: FAIL because workspace provider/boundary do not exist.

- [ ] **Step 3: Implement provider and boundary**

Create one client provider under the `(workspace)` layout. `WorkspaceBoundary` shows the existing loading treatment while session/business state resolves, redirects invalid sessions to `/`, and renders children only with a complete workspace context.

- [ ] **Step 4: Add the first route page**

Create `/dashboard` as a real App Router route consuming `useWorkspace()` and render only dashboard-level content for now; do not mount the other modules.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @tradeos/web test -- workspace-provider.test.tsx && pnpm --filter @tradeos/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/workspace apps/web/app/'(workspace)'/layout.tsx apps/web/app/'(workspace)'/dashboard/page.tsx
git commit -m "feat: add shared authenticated workspace routes"
```

### Task 3: Build the persistent route-aware, role-aware application shell

**Files:**
- Create: `apps/web/app/components/workspace/app-shell.tsx`
- Create: `apps/web/app/components/workspace/workspace-navigation.ts`
- Create: `apps/web/app/components/workspace/app-shell.test.tsx`
- Create: `apps/web/app/workspace-shell.css`
- Modify: `apps/web/app/(workspace)/layout.tsx`
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Produces: `WorkspaceNavItem { href, label, group, roles? }` and `visibleWorkspaceNav(role)`.
- Produces: `AppShell` consuming `useWorkspace()` plus current pathname; marks active navigation with `aria-current="page"`.
- Consumes: `NetworkStatus`, business/branch switching methods, provider logout.

- [ ] **Step 1: Write failing shell/navigation tests**

Assert: real hrefs (`/dashboard`, `/sell`, `/cashbook`, etc.) instead of hashes; `/cashbook` is active when pathname is `/cashbook`; OWNER sees all primary destinations; CASHIER and VIEWER receive the approved subsets; mobile drawer state does not alter route selection.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @tradeos/web test -- app-shell.test.tsx`
Expected: FAIL because shell/navigation modules do not exist.

- [ ] **Step 3: Implement navigation model and shell**

Use grouped navigation (`Overview`, `Commerce`, `Money`, `Operations`, `Insights`) and the spec route map. Add responsive sidebar/drawer/topbar with business/branch selectors and sync/user controls. Keep authorization enforcement in APIs; nav filtering is presentation only.

- [ ] **Step 4: Add professional shell CSS**

Implement navy/slate navigation, neutral page background, 44–48px controls, sticky top bar, desktop/sidebar and tablet/mobile drawer behavior. Scope classes to the workspace shell.

- [ ] **Step 5: Run tests, typecheck and build**

Run: `pnpm --filter @tradeos/web test -- app-shell.test.tsx && pnpm --filter @tradeos/web typecheck && pnpm --filter @tradeos/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/workspace apps/web/app/workspace-shell.css apps/web/app/layout.tsx apps/web/app/'(workspace)'/layout.tsx
git commit -m "feat: add professional TradeOS application shell"
```

### Task 4: Add real route pages for all major modules without duplicating mutations

**Files:**
- Create: `apps/web/app/(workspace)/sell/page.tsx`
- Create: `apps/web/app/(workspace)/sales/page.tsx`
- Create: `apps/web/app/(workspace)/customers/page.tsx`
- Create: `apps/web/app/(workspace)/purchases/page.tsx`
- Create: `apps/web/app/(workspace)/inventory/page.tsx`
- Create: `apps/web/app/(workspace)/catalog/page.tsx`
- Create: `apps/web/app/(workspace)/returns/page.tsx`
- Create: `apps/web/app/(workspace)/cashbook/page.tsx`
- Create: `apps/web/app/(workspace)/operations/page.tsx`
- Create: `apps/web/app/(workspace)/reports/page.tsx`
- Create: `apps/web/app/components/catalog-starter.tsx`
- Modify: `apps/web/app/components/purchases-inventory.tsx`
- Modify: `apps/web/app/components/sales-returns.tsx`
- Modify: `apps/web/app/components/financial-reports.tsx`
- Test: `apps/web/app/components/workspace/route-composition.test.tsx`

**Interfaces:**
- Produces: route-specific composition only; no new API mutation implementations.
- `PurchasesInventory` gains a presentation prop `view: "purchases" | "inventory"` while retaining shared internal API/mutation logic.
- `SalesAndReturns` gains `view: "sales" | "returns"` while retaining shared sale/refund mutation logic.
- `FinancialReports` gains `view: "dashboard" | "reports"` if necessary to separate executive dashboard content from full reports without duplicating data logic.
- `CatalogStarter` moves unchanged business behavior out of the legacy 600-line app component into its own feature file.

- [ ] **Step 1: Write route composition tests**

Assert each route mounts only its intended major feature and does not render the legacy all-module workspace. Assert `/purchases` and `/inventory` use the same component with distinct view props; `/sales` and `/returns` likewise.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @tradeos/web test -- route-composition.test.tsx`
Expected: FAIL because routes/view props are not implemented.

- [ ] **Step 3: Extract `CatalogStarter` and add presentation-only view props**

Move catalog starter code without changing API payload behavior. Split render branches in combined feature components behind `view` props; shared hooks/state/mutations remain in the original feature module or a single extracted internal hook.

- [ ] **Step 4: Create all route pages**

Each page consumes `useWorkspace()` and passes business/branch/currency/role/staff/catalog props to exactly the feature(s) it owns.

- [ ] **Step 5: Run route tests and full web tests**

Run: `pnpm --filter @tradeos/web test && pnpm --filter @tradeos/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/'(workspace)' apps/web/app/components/catalog-starter.tsx apps/web/app/components/purchases-inventory.tsx apps/web/app/components/sales-returns.tsx apps/web/app/components/financial-reports.tsx apps/web/app/components/workspace/route-composition.test.tsx
git commit -m "feat: split TradeOS modules into real routes"
```

### Task 5: Recompose Cashbook & Expenses into professional page sections

**Files:**
- Modify: `apps/web/app/components/cashbook-expenses.tsx`
- Create: `apps/web/app/components/cashbook/cashbook-summary.tsx`
- Create: `apps/web/app/components/cashbook/cashbook-entry-form.tsx`
- Create: `apps/web/app/components/cashbook/expense-category-card.tsx`
- Create: `apps/web/app/components/cashbook/cashbook-history.tsx`
- Create: `apps/web/app/components/cashbook/cashbook-expenses.test.tsx`

**Interfaces:**
- `CashbookExpenses` remains the feature coordinator and owner of existing load/filter/offline queue state.
- Presentational child components receive explicit values/callbacks; they do not call accounting APIs independently except category creation if kept in the coordinator callback.
- Existing `Treasury` component remains the only treasury behavior source.

- [ ] **Step 1: Write failing Cashbook behavior/composition tests**

Cover: toolbar Method/From/To/Today; four summary cards; expense mode fields; balance-adjustment reason/explanation fields; offline queued entry increments pending presentation; rejected sync message remains visible; category creation disabled when blank/busy and preserves online-only helper copy; recent movement/expense empty states.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @tradeos/web test -- cashbook-expenses.test.tsx`
Expected: FAIL because new section composition does not exist.

- [ ] **Step 3: Extract presentation sections without changing mutations**

Move form markup/history rendering into the four focused components. Keep current `submit`, amount/sign parsing, queueing, `flushPendingMutations`, category API call, filters and Treasury data flow intact in the coordinator.

- [ ] **Step 4: Make history structured**

Render Recent movements and Recent expenses as accessible tables/lists with explicit headers, amount alignment, dates, category/payee/description/method fields, and explanatory empty states.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @tradeos/web test -- cashbook-expenses.test.tsx && pnpm --filter @tradeos/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/cashbook-expenses.tsx apps/web/app/components/cashbook
git commit -m "refactor: structure Cashbook as page sections"
```

### Task 6: Apply the modern Cashbook visual system and responsive behavior

**Files:**
- Create: `apps/web/app/cashbook.css`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/components/cashbook/*.tsx`
- Modify: `apps/web/app/components/treasury.tsx` only for presentational class hooks if needed
- Test: `apps/web/app/components/cashbook/cashbook-layout.test.tsx`

**Interfaces:**
- Produces: Cashbook-scoped classes for page header, compact filter toolbar, KPI grid, form card/grid, category card, treasury section, data cards and responsive table wrappers.
- Consumes: existing semantic form/table markup from Task 5.

- [ ] **Step 1: Write layout-contract tests**

Assert class contracts for: `cashbook-toolbar`, four-card summary grid, two-column `cashbook-form-grid`, full-width description/action row, table scroll container, and mobile-collapse class hooks. Assert there is no Cashbook use of generic `.form-row` for primary form composition.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @tradeos/web test -- cashbook-layout.test.tsx`
Expected: FAIL because Cashbook-scoped layout classes/CSS do not exist.

- [ ] **Step 3: Implement Cashbook CSS**

Use the approved navy/gold/neutral system, 14–18px cards, restrained borders/shadows, 44–48px inputs/buttons/selects, label-above-control layout, compact desktop toolbar, two-column desktop form, one-column mobile form, and local table overflow.

- [ ] **Step 4: Add accessibility/polish states**

Ensure focus-visible styles, text+status badges, disabled/online-only category state, readable table headers, amount alignment and touch targets.

- [ ] **Step 5: Run focused tests, full web tests and build**

Run: `pnpm --filter @tradeos/web test && pnpm --filter @tradeos/web typecheck && pnpm --filter @tradeos/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/cashbook.css apps/web/app/layout.tsx apps/web/app/components/cashbook apps/web/app/components/treasury.tsx
git commit -m "feat: modernize Cashbook responsive UX"
```

### Task 7: Modernize shared page primitives and apply them to the remaining routes

**Files:**
- Create: `apps/web/app/components/ui/page-header.tsx`
- Create: `apps/web/app/components/ui/page-toolbar.tsx`
- Create: `apps/web/app/components/ui/stat-card.tsx`
- Create: `apps/web/app/components/ui/form-card.tsx`
- Create: `apps/web/app/components/ui/data-card.tsx`
- Create: `apps/web/app/components/ui/status-badge.tsx`
- Create: `apps/web/app/components/ui/responsive-table.tsx`
- Create: `apps/web/app/ui-primitives.css`
- Modify: route feature components only where needed to adopt these presentational primitives
- Test: `apps/web/app/components/ui/ui-primitives.test.tsx`

**Interfaces:**
- Produces presentational primitives only; no API/session/business logic.
- Consumes semantic children and optional title/subtitle/action/status props defined by each primitive.

- [ ] **Step 1: Write primitive tests**

Assert semantic headings/labels, class contracts, `aria` propagation, responsive table wrapper, status text and no business API imports.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @tradeos/web test -- ui-primitives.test.tsx`
Expected: FAIL because primitives do not exist.

- [ ] **Step 3: Implement minimal primitives and CSS**

Extract visual conventions proven on Cashbook; do not introduce a new component library dependency.

- [ ] **Step 4: Adopt primitives route-by-route**

Apply to Dashboard, Sell, Sales, Customers, Purchases, Inventory, Catalog, Returns, Operations and Reports without changing domain mutations/calculations.

- [ ] **Step 5: Run full web suite and build**

Run: `pnpm --filter @tradeos/web test && pnpm --filter @tradeos/web typecheck && pnpm --filter @tradeos/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/ui apps/web/app/ui-primitives.css apps/web/app/components apps/web/app/'(workspace)'
git commit -m "feat: standardize TradeOS page UX primitives"
```

### Task 8: Remove the legacy single-page workspace and verify role/route parity

**Files:**
- Delete or reduce: `apps/web/app/components/tradeos-web-app.tsx`
- Modify: any imports still depending on the legacy component
- Create: `apps/web/app/components/workspace/workspace-parity.test.tsx`
- Modify: `apps/web/app/real-app.css` and `apps/web/app/globals.css` to remove obsolete single-page rules only after replacement classes are active

**Interfaces:**
- Produces: no authenticated code path that renders all modules together or uses `href="#..."` navigation.
- Consumes: route map/provider/shell established by Tasks 2–4.

- [ ] **Step 1: Write parity tests**

Assert no primary nav hash hrefs; all 11 route paths are represented; OWNER navigation includes all primary routes; CASHIER can access Sell and allowed money pages; VIEWER is read-only in presentation and does not receive mutation-oriented navigation/actions; root authenticated entry redirects to `/dashboard`.

- [ ] **Step 2: Run tests and verify RED if legacy workspace remains**

Run: `pnpm --filter @tradeos/web test -- workspace-parity.test.tsx`
Expected: FAIL while legacy `BusinessWorkspace`/hash navigation remains reachable.

- [ ] **Step 3: Remove legacy workspace and obsolete styles**

Delete the all-modules composition after every route has parity. Keep only public-entry helpers that were not already extracted.

- [ ] **Step 4: Run full web verification**

Run: `pnpm --filter @tradeos/web test && pnpm --filter @tradeos/web typecheck && pnpm --filter @tradeos/web build`
Expected: PASS with no legacy hash navigation.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/app
git commit -m "refactor: remove legacy single-page TradeOS workspace"
```

### Task 9: Whole-repository verification and visual UAT gate

**Files:**
- Modify only if verification finds defects.
- Test: existing root tests plus web route/UX tests from prior tasks.

**Interfaces:**
- No new interfaces; this is the release-quality gate.

- [ ] **Step 1: Run repository typecheck and complete tests**

Run from repo root with the disposable CI database configured exactly as the repository CI expects:

```bash
pnpm typecheck
pnpm test
```

Expected: all suites PASS.

- [ ] **Step 2: Run production build**

Run: `pnpm build`
Expected: exit 0; Next.js builds every workspace route.

- [ ] **Step 3: Run route/manual UAT with demo roles**

Verify OWNER can navigate all primary routes; CASHIER sees/uses Sell and permitted Cashbook functionality; VIEWER cannot see mutation-oriented controls. Confirm business/branch selectors remain selected while navigating.

- [ ] **Step 4: Visual UAT at three widths**

Check at desktop >=1280px, tablet around 1024px, and mobile around 390px. On Dashboard, Cashbook and one data-heavy route verify: no viewport horizontal overflow, no giant form gaps, no clipped cards, no browser-default-looking controls, sidebar/drawer behavior works, tables scroll locally, and Cashbook form collapses cleanly.

- [ ] **Step 5: Request independent code review**

Run the project review workflow against the branch diff, fix all Critical/Important findings, and rerun affected tests.

- [ ] **Step 6: Commit any review fixes**

```bash
git add -A
git commit -m "fix: address TradeOS multi-page UX review"
```

- [ ] **Step 7: Push branch and open PR**

Push the feature branch, open a PR against `main`, wait for CI, and do not deploy until CI is green.
