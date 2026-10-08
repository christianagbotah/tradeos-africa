# TradeOS 2.0 Foundation, Adaptive Shell & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first working TradeOS 2.0 vertical slice: one coherent design foundation, a phone-first adaptive authenticated shell with role-aware bottom navigation, and an intelligent dashboard command center that preserves all existing domain logic and offline behavior.

**Architecture:** Keep the existing Next.js App Router, workspace provider, route map and backend APIs. Replace transitional visual contracts progressively: semantic tokens feed shared primitives, the shell consumes a role-aware navigation model, and the dashboard composes deterministic existing report endpoints into a dedicated view model rather than re-implementing accounting logic. Legacy module CSS remains only for routes not yet migrated; the new shell/dashboard must not depend on `workspace-polish.css` source-order overrides.

**Tech Stack:** Next.js 16.3.8, React 19.3.0, TypeScript 5.9, Vitest 3.2.4, CSS, existing TradeOS client API/offline/workspace infrastructure.

**Spec:** `docs/superpowers/specs/2026-10-08-tradeos-2-design-system-ux-architecture.md` (controlling presentation architecture) plus `docs/superpowers/specs/2026-10-07-tradeos-multipage-ux-design.md` for route/state/domain-preservation constraints.

## Global Constraints

- Preserve authentication, tenancy, roles, business/branch context, offline queue behavior, pricing, inventory, returns/refunds, cashbook, credit, reports, CFO actions, reconciliation and audit semantics.
- Keep routes `/dashboard`, `/sell`, `/sales`, `/customers`, `/purchases`, `/inventory`, `/catalog`, `/returns`, `/cashbook`, `/operations`, `/reports`; do not create mobile-only domain routes.
- Normal mobile body/default-control text is 15–16px; normal business context/navigation/role labels must not use 9–10px text.
- Primary mobile touch targets are at least 48px high; icon-only touch targets are at least 44x44px.
- Reference breakpoints: compact phone `<480px`; phone `480–767px`; tablet `768–1099px`; desktop `>=1100px`.
- Mobile owner/manager priority navigation is Home, Sell, Money, Stock, More; role-specific variants follow the approved spec.
- No horizontal page scrolling caused by shell, dashboard grids or forms at 360px width.
- Respect `env(safe-area-inset-bottom)` for mobile bottom navigation and future sticky transactional actions.
- Dashboard percentages/comparisons must name their baseline; never display an unexplained percentage.
- Dashboard AI copy is optional. Deterministic observations and evidence remain useful when no AI service is available.
- Do not replace server financial calculations with client-side accounting calculations; use existing report/aging/forecast endpoints as evidence sources.
- Do not add an animation library for basic shell/dashboard interaction; honor reduced-motion preferences.
- Existing feature CSS may remain for unmigrated routes, but the new shell/dashboard must not depend on generic `workspace-polish.css` overrides.
- Node remains `>=22` and pnpm remains `10.17.1`.

## Review Focus

1. **Unknown or uncommon role string** — navigation must fail safe to Home plus only routes the existing authorization model explicitly exposes; it must never accidentally grant management destinations. Covered in Task 3 navigation-model tests.
2. **Single business / single branch versus multi-context user** — shell must avoid oversized selectors when there is nothing to switch while preserving selectors when choices exist. Covered in Task 4 shell source/contract tests.
3. **Offline dashboard with partial or no cached evidence** — deterministic cards must show cached/available evidence and explicit coverage limitations rather than inventing values or collapsing the page. Covered in Task 5 model/data tests.
4. **Large/negative money values and non-GHS currency** — money display must remain readable, signed correctly where applicable and not hard-code the cedi sign for other currencies. Covered in Task 2 `MoneyValue` tests.
5. **Phone safe areas and 360px width** — bottom navigation and first-viewport quick actions must not clip, overflow or sit behind device UI. Covered in Task 4 shell CSS contract tests and Task 6 dashboard CSS contract tests.

---

## File Structure

### Create

- `apps/web/app/tradeos-tokens.css` — semantic color, typography, spacing, radius, elevation, motion and breakpoint custom properties.
- `apps/web/app/components/ui/button.tsx` — shared button primitive and variants.
- `apps/web/app/components/business/money-value.tsx` — money formatting/display primitive.
- `apps/web/app/components/business/quick-action.tsx` — route/action affordance used by dashboard and later modules.
- `apps/web/app/components/business/attention-item.tsx` — priority/evidence/action row.
- `apps/web/app/components/business/business-pulse.tsx` — deterministic insight presentation with evidence/coverage state.
- `apps/web/app/components/business/business-components.test.tsx` — static-render contracts for business components.
- `apps/web/app/components/workspace/mobile-bottom-nav.tsx` — role-aware phone priority navigation.
- `apps/web/app/components/workspace/mobile-more-sheet.tsx` — structured remaining-module/account sheet.
- `apps/web/app/components/dashboard/dashboard-model.ts` — pure transformation of report/aging/forecast evidence into a dashboard view model.
- `apps/web/app/components/dashboard/dashboard-model.test.ts` — deterministic view-model tests.
- `apps/web/app/components/dashboard/dashboard-data.tsx` — dashboard read/cache hook using existing APIs.
- `apps/web/app/components/dashboard/dashboard-command-center.tsx` — dashboard composition.
- `apps/web/app/components/dashboard/dashboard-command-center.test.tsx` — static/source contracts for command-center hierarchy.
- `apps/web/app/dashboard.css` — route-local TradeOS 2 dashboard layout.

### Modify

- `apps/web/app/layout.tsx` — import semantic tokens once and dashboard stylesheet; retain only still-needed legacy feature imports.
- `apps/web/app/globals.css` — base/reset rules consume semantic tokens; remove duplicated shell-level visual constants where encountered.
- `apps/web/app/ui-primitives.css` — migrate primitive sizing/typography to semantic tokens.
- `apps/web/app/components/ui/ui-primitives.test.tsx` — assert token source and updated primitive contracts.
- `apps/web/app/components/workspace/workspace-navigation.ts` — add explicit mobile navigation model without changing authoritative route permissions.
- `apps/web/app/components/workspace/app-shell.tsx` — desktop/tablet shell rewrite and phone shell integration.
- `apps/web/app/components/workspace/app-shell.test.tsx` — role/mobile navigation contracts.
- `apps/web/app/components/workspace/professional-shell.test.tsx` — replace obsolete expectations that require the old polish override architecture.
- `apps/web/app/workspace-shell.css` — new adaptive shell styling and safe-area behavior.
- `apps/web/app/workspace-polish.css` — remove shell/dashboard-specific override responsibility while leaving compatibility selectors for unmigrated modules.
- `apps/web/app/(workspace)/dashboard/page.tsx` — replace count-first first viewport with `DashboardCommandCenter`; keep deep report drill-down accessible below or via Reports.

---

### Task 1: Establish the semantic TradeOS design foundation

**Files:**
- Create: `apps/web/app/tradeos-tokens.css`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/ui-primitives.css`
- Modify/Test: `apps/web/app/components/ui/ui-primitives.test.tsx`

**Interfaces:**
- Consumes: existing class contracts (`tradeos-*`) used by routed pages.
- Produces: CSS variables prefixed `--tos-*`, including `--tos-font-body`, `--tos-text-body`, `--tos-text-supporting`, `--tos-text-meta`, `--tos-touch-mobile`, `--tos-touch-icon`, `--tos-radius-sm/md/lg`, semantic surface/text/border/accent/status tokens, spacing tokens and motion tokens.

- [ ] **Step 1: Write failing token/import tests**

Add assertions that `layout.tsx` imports `./tradeos-tokens.css` before shell/primitive CSS; `tradeos-tokens.css` defines the required `--tos-*` contracts; and `ui-primitives.css` consumes them rather than embedding 9–10px normal-label sizes.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/ui/ui-primitives.test.tsx`

Expected: FAIL because `tradeos-tokens.css` and `--tos-*` contracts do not exist yet.

- [ ] **Step 3: Implement tokens and migrate base primitive sizing**

Create the semantic token source with approved typography/touch/radius hierarchy. Update `globals.css` and `ui-primitives.css` so body/control text, focus states, numerals and primitive spacing consume the token source. Keep feature-specific selectors out of the token file.

- [ ] **Step 4: Run focused test and typecheck**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/ui/ui-primitives.test.tsx && pnpm --filter @tradeos/web typecheck`

Expected: PASS, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/tradeos-tokens.css apps/web/app/layout.tsx apps/web/app/globals.css apps/web/app/ui-primitives.css apps/web/app/components/ui/ui-primitives.test.tsx
git commit -m "feat(web): establish TradeOS design foundation"
```

### Task 2: Add reusable business-facing presentation components

**Files:**
- Create: `apps/web/app/components/ui/button.tsx`
- Create: `apps/web/app/components/business/money-value.tsx`
- Create: `apps/web/app/components/business/quick-action.tsx`
- Create: `apps/web/app/components/business/attention-item.tsx`
- Create: `apps/web/app/components/business/business-pulse.tsx`
- Create/Test: `apps/web/app/components/business/business-components.test.tsx`
- Modify: `apps/web/app/ui-primitives.css`

**Interfaces:**
- Produces: `Button({ variant, size, ...buttonProps })`; `MoneyValue({ minor, currencyCode, sign?, emphasis? })`; `QuickAction({ href, label, description?, icon })`; `AttentionItem({ title, detail, priority, href, actionLabel, evidence? })`; `BusinessPulse({ headline, summary, evidence, actions, coverage? })`.
- `MoneyValue` is presentation-only and must not perform ledger/accounting calculations.

- [ ] **Step 1: Write failing static-render tests**

Assert: GHS renders `₵`; USD renders `USD` rather than `₵`; negative values retain the minus sign; business components expose semantic headings/links; evidence and coverage text render; button/touch classes are stable.

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/business/business-components.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the presentational interfaces**

Use `Intl.NumberFormat` only for formatting. Keep API/workspace imports out of these files. Use shared token-backed classes and semantic HTML.

- [ ] **Step 4: Run component tests**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/business/business-components.test.tsx app/components/ui/ui-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ui/button.tsx apps/web/app/components/business apps/web/app/ui-primitives.css
git commit -m "feat(web): add TradeOS business UI components"
```

### Task 3: Define role-aware phone navigation as a pure model

**Files:**
- Modify: `apps/web/app/components/workspace/workspace-navigation.ts`
- Modify/Test: `apps/web/app/components/workspace/app-shell.test.tsx`

**Interfaces:**
- Existing `visibleWorkspaceNav(role)` and `canAccessWorkspaceRoute(role, href)` remain authoritative for route visibility.
- Produce `type MobileNavItem = WorkspaceNavItem | { href: "#more"; label: "More"; icon: "more" }` (extend icon type accordingly).
- Produce `mobileWorkspaceNav(role: string): MobileNavItem[]` returning exactly five priority entries when the role has enough destinations, with `More` last.
- Produce `mobileMoreNav(role: string): WorkspaceNavItem[]` returning visible routes not already represented by a direct mobile tab.

- [ ] **Step 1: Add failing role matrix tests**

Assert exact direct tabs:
- OWNER/MANAGER: `/dashboard`, `/sell`, `/cashbook`, `/inventory`, `#more`.
- CASHIER: `/dashboard`, `/sell`, `/sales`, `/cashbook`, `#more`.
- INVENTORY: `/dashboard`, `/inventory`, `/purchases`, `/catalog`, `#more`.
- ACCOUNTANT: `/dashboard`, `/cashbook`, `/customers`, `/reports`, `#more`.
- VIEWER: `/dashboard`, `/sales`, `/inventory`, `/reports`, `#more`.
Also assert an unknown role cannot gain a destination that `visibleWorkspaceNav(unknown)` did not expose.

- [ ] **Step 2: Run navigation tests and verify RED**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/workspace/app-shell.test.tsx`

Expected: FAIL because mobile model functions do not exist.

- [ ] **Step 3: Implement mobile navigation functions using existing authorization visibility**

Never maintain a second permission list. Priority templates select only from `visibleWorkspaceNav(role)`; `More` contains only remaining visible destinations.

- [ ] **Step 4: Run test and typecheck**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/workspace/app-shell.test.tsx && pnpm --filter @tradeos/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/workspace/workspace-navigation.ts apps/web/app/components/workspace/app-shell.test.tsx
git commit -m "feat(web): add role-aware mobile navigation model"
```

### Task 4: Replace desktop-shrunk mobile navigation with the adaptive shell

**Files:**
- Create: `apps/web/app/components/workspace/mobile-bottom-nav.tsx`
- Create: `apps/web/app/components/workspace/mobile-more-sheet.tsx`
- Modify: `apps/web/app/components/workspace/app-shell.tsx`
- Modify: `apps/web/app/workspace-shell.css`
- Modify: `apps/web/app/components/workspace/app-shell.test.tsx`
- Modify: `apps/web/app/components/workspace/professional-shell.test.tsx`
- Modify: `apps/web/app/workspace-polish.css`

**Interfaces:**
- `MobileBottomNav({ role, pathname, onOpenMore })` consumes Task 3 model and renders direct route tabs plus More.
- `MobileMoreSheet({ open, role, pathname, onClose, businessContext, onLogout })` renders remaining modules/context/account actions; it owns focus trap, Escape close and focus restoration.
- `AppShell` keeps the existing `useWorkspace()` session/business/branch/logout interfaces unchanged.

- [ ] **Step 1: Write failing shell contract tests**

Assert the source renders `MobileBottomNav` and `MobileMoreSheet`, does not use the old mobile sidebar drawer as primary phone navigation, keeps `aria-current`, conditionally renders business/branch selectors only when multiple choices exist, and retains profile/sign-out access.

Add CSS assertions for `min-height: var(--tos-touch-mobile)` (or equivalent token use), `padding-bottom: env(safe-area-inset-bottom)`, desktop/tablet/mobile breakpoint contracts and no 9–10px navigation/role labels.

- [ ] **Step 2: Run shell tests and verify RED**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/workspace/app-shell.test.tsx app/components/workspace/professional-shell.test.tsx`

Expected: FAIL on new mobile-shell contracts.

- [ ] **Step 3: Implement adaptive shell components**

Desktop: lighter persistent navigation plus compact top context. Tablet: compact/temporary navigation behavior. Mobile: compact top bar + bottom nav + structured More sheet. Preserve `NetworkStatus`, business/branch switching, profile/sign-out and `workspace-content` business/branch remount key.

- [ ] **Step 4: Prune obsolete shell/dashboard responsibility from `workspace-polish.css`**

Do not remove compatibility selectors still required by unmigrated modules. Update obsolete tests that previously required `workspace-polish.css` to normalize the entire shell.

- [ ] **Step 5: Run workspace regression tests**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/workspace && pnpm --filter @tradeos/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/workspace apps/web/app/workspace-shell.css apps/web/app/workspace-polish.css
git commit -m "feat(web): ship adaptive TradeOS application shell"
```

### Task 5: Build a deterministic dashboard evidence/view-model layer

**Files:**
- Create: `apps/web/app/components/dashboard/dashboard-model.ts`
- Create/Test: `apps/web/app/components/dashboard/dashboard-model.test.ts`
- Create: `apps/web/app/components/dashboard/dashboard-data.tsx`

**Interfaces:**
- `DashboardEvidence` accepts only the report fields needed from existing `/v1/reports/financial-summary`, `/v1/reports/credit-aging`, `/v1/reports/cash-forecast`, plus offline sync/pending state where already available.
- `buildDashboardModel(evidence: DashboardEvidence): DashboardViewModel` produces:
  - `today` (sales/revenue, transaction count, profit/cash context, explicit comparison label/value when covered);
  - `pulse` (deterministic headline/summary/evidence/actions/coverage);
  - `attention[]` sorted by severity/priority;
  - `moneyPosition` (cash, receivables, payables and only available account categories);
  - `momentum` compact series/summary;
  - `dataStatus` describing live/cached/partial/unavailable coverage.
- `useDashboardData({ businessId, branchId, currencyCode, branchTimezone })` loads the existing server endpoints, reads/writes route-specific cache, and exposes `{ evidence, busy, message, source }` without calculating ledger values.

- [ ] **Step 1: Write failing pure-model tests**

Cover: positive and negative comparisons with explicit baseline text; overdue debt attention; cash-forecast shortfall attention; partial evidence; no evidence; non-GHS values; deterministic pulse still present when no AI text exists.

- [ ] **Step 2: Run model tests and verify RED**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/dashboard/dashboard-model.test.ts`

Expected: FAIL because model functions do not exist.

- [ ] **Step 3: Implement the pure model**

Use server-returned totals and deltas only. The model may rank/phrase deterministic signals but must not reconstruct revenue, tax, COGS or forecast formulas.

- [ ] **Step 4: Implement the read/cache hook**

Use `clientApi`, existing online/offline patterns and localStorage guards. On offline/partial cache, expose coverage explicitly. Do not convert a successful cached state into a fatal error page.

- [ ] **Step 5: Run model tests plus existing financial intelligence tests**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/dashboard/dashboard-model.test.ts app/components/cfo-action-center.test.tsx app/components/cfo-action-center.partial-cache.test.tsx app/components/cash-forecast.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/dashboard/dashboard-model.ts apps/web/app/components/dashboard/dashboard-model.test.ts apps/web/app/components/dashboard/dashboard-data.tsx
git commit -m "feat(web): add deterministic dashboard intelligence model"
```

### Task 6: Replace the count-first dashboard with the Business Command Center

**Files:**
- Create: `apps/web/app/components/dashboard/dashboard-command-center.tsx`
- Create/Test: `apps/web/app/components/dashboard/dashboard-command-center.test.tsx`
- Create: `apps/web/app/dashboard.css`
- Modify: `apps/web/app/(workspace)/dashboard/page.tsx`
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- `DashboardCommandCenter({ businessId, businessName, branchId, branchName, currencyCode, role, branchTimezone })` composes Task 2 business components and Task 5 data/model.
- First viewport order: greeting/business context → Today state → TradeOS Pulse → role-aware Quick Actions → Needs Attention. Money Position and Momentum follow; deep financial analytics remain accessible below or via `/reports`.
- Quick actions must route only to destinations allowed for the current role.

- [ ] **Step 1: Write failing dashboard composition tests**

Using static/source assertions, require headings/copy contracts for `Today`, `TradeOS Pulse`, `Needs attention`, quick actions and money position; assert the page no longer begins with catalog database-count cards; assert dashboard uses `DashboardCommandCenter`.

Add CSS contract assertions for responsive grid collapse, minimum 15px normal text, 48px mobile actions, tabular money numerals, safe 360px layout and reduced-motion behavior.

- [ ] **Step 2: Run dashboard tests and verify RED**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/dashboard/dashboard-command-center.test.tsx`

Expected: FAIL because the command center does not exist.

- [ ] **Step 3: Implement the command-center hierarchy**

Use the view model exactly; render unavailable/partial evidence states honestly; keep actions immediately reachable on phones; do not show meaningless charts when data is insufficient.

- [ ] **Step 4: Replace `/dashboard` first viewport**

Remove the four count-first `StatCard` overview cards. Pass existing workspace context into `DashboardCommandCenter`. Keep existing `FinancialReports` only as lower-page deep analytics if it remains useful without duplicating first-viewport content; otherwise link to `/reports` and leave the dedicated reports route authoritative.

- [ ] **Step 5: Run dashboard/workspace test suite and typecheck**

Run: `pnpm --filter @tradeos/web exec vitest run app/components/dashboard app/components/workspace app/components/business && pnpm --filter @tradeos/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/dashboard apps/web/app/'(workspace)'/dashboard/page.tsx apps/web/app/dashboard.css apps/web/app/layout.tsx
git commit -m "feat(web): turn dashboard into TradeOS command center"
```

### Task 7: Regression hardening and acceptance gate for the first vertical slice

**Files:**
- Modify tests only if fresh verification exposes a legitimate contract gap; do not weaken tests to obtain green.

**Interfaces:**
- Produces a verified foundation/shell/dashboard baseline for the subsequent POS plan.

- [ ] **Step 1: Run the entire web test suite**

Run: `pnpm --filter @tradeos/web test`

Expected: all Vitest tests pass with zero failures.

- [ ] **Step 2: Run repository typecheck and lint gates**

Run: `pnpm typecheck && pnpm lint`

Expected: exit 0.

- [ ] **Step 3: Run production build**

Run: `pnpm --filter @tradeos/web build`

Expected: Next.js production build exits 0.

- [ ] **Step 4: Run full repository tests**

Run: `pnpm test`

Expected: deployment configuration test and all package tests pass.

- [ ] **Step 5: Visual/manual acceptance matrix**

Verify authenticated dashboard/shell at 360, 390/393, 430, 768, 1024, 1280 and 1440px. Check OWNER plus CASHIER, INVENTORY, ACCOUNTANT and VIEWER demo roles. Required observations: no page-level horizontal overflow; no tiny normal text; bottom nav remains above safe area; More sheet restores focus; single-context users are not burdened with unnecessary selectors; multi-context switchers still work; network status remains legible; dashboard first viewport shows Today + attention + next actions before deep analytics; offline/cached state does not look like transaction failure.

- [ ] **Step 6: Commit any verified hardening fixes, then record final SHA**

```bash
git status --short
git log -1 --oneline
```

Expected: clean working tree after final commit and an auditable final SHA.

---

## Subsequent plans after this baseline

This plan intentionally stops after the shared foundation, shell and dashboard are production-ready. The approved spec should then be implemented in separate vertical plans so every subsystem remains independently testable:

1. `TradeOS 2.0 Sell/POS` — phone/desktop transactional flow, cart/payment, unit conversion and offline-safe confirmation.
2. `TradeOS 2.0 Money + Stock + Purchases` — daily money actions, inventory home/detail and receiving flow.
3. `TradeOS 2.0 Customers + Sales + Returns` — receivables-first customer experience, sales drill-down and audit-safe return/refund/exchange flow.
4. `TradeOS 2.0 Reports + Operations + Entry Experiences` — CFO/report hierarchy, reconciliation, onboarding/login/settings and final cross-platform consistency pass.

Each later plan must consume the token, primitive, business-component and shell contracts created here rather than inventing another design language.
