# TradeOS 2.0 Foundation, Adaptive Shell & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first working TradeOS 2.0 vertical slice: one coherent design foundation, a phone-first adaptive authenticated shell with role-aware bottom navigation, and an intelligent dashboard command center while preserving existing domain and offline behavior.

**Architecture:** Keep the existing Next.js App Router, workspace provider, route map and backend APIs. Semantic tokens feed reusable presentation primitives; the shell consumes the existing role authorization model plus a derived mobile-priority model; the dashboard consumes existing deterministic financial-summary, credit-aging and cash-forecast APIs through a dedicated read/view-model layer. Unmigrated routes may retain feature CSS temporarily, but the new shell/dashboard must not depend on `workspace-polish.css` source-order overrides.

**Tech Stack:** Next.js 16.3.8, React 19.3.0, TypeScript 5.9, Vitest 3.2.4, CSS, existing TradeOS client API/offline/workspace infrastructure.

**Spec:** `docs/superpowers/specs/2026-10-08-tradeos-2-design-system-ux-architecture.md`; route/state/domain constraints also inherit from `docs/superpowers/specs/2026-10-07-tradeos-multipage-ux-design.md`.

## Global Constraints

- Preserve authentication, tenancy, roles, business/branch context, offline queue behavior, server pricing, inventory, returns/refunds, cashbook, credit, reporting, CFO, reconciliation and audit semantics.
- Keep the existing route map; do not create mobile-only domain routes.
- Mobile body/default controls: 15–16px. Normal business context/navigation/role labels: never 9–10px.
- Primary mobile touch targets: at least 48px high. Icon-only touch targets: at least 44x44px.
- Breakpoints: `<480`, `480–767`, `768–1099`, `>=1100`.
- Owner/manager mobile priority: Home, Sell, Money, Stock, More; other role variants follow the spec.
- No page-level horizontal overflow at 360px.
- Respect `env(safe-area-inset-bottom)`.
- Dashboard comparisons must state their baseline.
- AI interpretation is optional; deterministic observations must remain useful without AI.
- Never recreate server accounting/forecast calculations on the client.
- No new animation library; respect reduced motion.
- New shell/dashboard styling may not rely on generic `workspace-polish.css` overrides.
- Node `>=22`; pnpm `10.17.1`.

## Review Focus

1. **Unknown/uncommon role** — navigation fails closed: no route may appear unless `visibleWorkspaceNav(role)` already exposes it; an unknown role may therefore receive no direct route tabs beyond the non-route `More` control. Task 3 pins this.
2. **Single vs multi business/branch context** — no oversized selector when there is nothing to switch, but switching remains intact when choices exist. Task 4 pins this.
3. **Offline dashboard with partial/no cached evidence** — show available cached evidence and coverage limitations; never invent numbers or collapse to a fatal page. Task 5 pins this.
4. **Large/negative/non-GHS money** — readable, signed correctly, and never hard-code `₵` for other currencies. Task 2 pins this.
5. **360px + phone safe area** — bottom navigation and first-viewport actions do not clip or sit behind device UI. Tasks 4 and 6 pin this.

---

## File Structure

**Create**
- `apps/web/app/tradeos-tokens.css` — semantic design tokens.
- `apps/web/app/components/ui/button.tsx` — button primitive.
- `apps/web/app/components/business/money-value.tsx`
- `apps/web/app/components/business/quick-action.tsx`
- `apps/web/app/components/business/attention-item.tsx`
- `apps/web/app/components/business/business-pulse.tsx`
- `apps/web/app/components/business/business-components.test.tsx`
- `apps/web/app/components/workspace/mobile-bottom-nav.tsx`
- `apps/web/app/components/workspace/mobile-more-sheet.tsx`
- `apps/web/app/components/dashboard/dashboard-model.ts`
- `apps/web/app/components/dashboard/dashboard-model.test.ts`
- `apps/web/app/components/dashboard/dashboard-data.tsx`
- `apps/web/app/components/dashboard/dashboard-command-center.tsx`
- `apps/web/app/components/dashboard/dashboard-command-center.test.tsx`
- `apps/web/app/dashboard.css`

**Modify**
- `apps/web/app/layout.tsx`
- `apps/web/app/globals.css`
- `apps/web/app/ui-primitives.css`
- `apps/web/app/components/ui/ui-primitives.test.tsx`
- `apps/web/app/components/workspace/workspace-navigation.ts`
- `apps/web/app/components/workspace/app-shell.tsx`
- `apps/web/app/components/workspace/app-shell.test.tsx`
- `apps/web/app/components/workspace/professional-shell.test.tsx`
- `apps/web/app/workspace-shell.css`
- `apps/web/app/workspace-polish.css`
- `apps/web/app/(workspace)/dashboard/page.tsx`

---

### Task 1: Semantic design foundation

**Files:** create `tradeos-tokens.css`; modify `layout.tsx`, `globals.css`, `ui-primitives.css`, `ui-primitives.test.tsx`.

**Interfaces:** produce `--tos-*` tokens for font, text scale, spacing, surfaces, text, borders, accents/status, 12/16/20 radii, elevation, motion, `--tos-touch-mobile`, and `--tos-touch-icon`.

- [ ] **Step 1: Write failing tests** asserting `layout.tsx` imports `tradeos-tokens.css` before shell/primitives, required `--tos-*` variables exist, and primitive CSS consumes them rather than embedding 9–10px normal labels.
- [ ] **Step 2: Verify RED** with `pnpm --filter @tradeos/web exec vitest run app/components/ui/ui-primitives.test.tsx`.
- [ ] **Step 3: Implement tokens/base migration**; keep feature selectors out of token CSS.
- [ ] **Step 4: Verify GREEN** with `pnpm --filter @tradeos/web exec vitest run app/components/ui/ui-primitives.test.tsx && pnpm --filter @tradeos/web typecheck`.
- [ ] **Step 5: Commit** `feat(web): establish TradeOS design foundation`.

### Task 2: Business-facing presentation components

**Files:** create `button.tsx`, `money-value.tsx`, `quick-action.tsx`, `attention-item.tsx`, `business-pulse.tsx`, `business-components.test.tsx`; modify `ui-primitives.css`.

**Interfaces:**
- `Button({ variant, size, ...buttonProps })`
- `MoneyValue({ minor, currencyCode, sign?, emphasis? })`
- `QuickAction({ href, label, description?, icon })`
- `AttentionItem({ title, detail, priority, href, actionLabel, evidence? })`
- `BusinessPulse({ headline, summary, evidence, actions, coverage? })`

- [ ] **Step 1: Write failing static-render tests** for GHS, USD, negative values, semantic actions, evidence/coverage, stable touch classes.
- [ ] **Step 2: Verify RED** with `pnpm --filter @tradeos/web exec vitest run app/components/business/business-components.test.tsx`.
- [ ] **Step 3: Implement presentational components** using `Intl.NumberFormat` for formatting only; no API/workspace imports.
- [ ] **Step 4: Verify GREEN** with `pnpm --filter @tradeos/web exec vitest run app/components/business/business-components.test.tsx app/components/ui/ui-primitives.test.tsx`.
- [ ] **Step 5: Commit** `feat(web): add TradeOS business UI components`.

### Task 3: Role-aware phone navigation model

**Files:** modify `workspace-navigation.ts`, `app-shell.test.tsx`.

**Interfaces:** existing `visibleWorkspaceNav`/`canAccessWorkspaceRoute` remain authoritative. Add `MobileNavItem`, `mobileWorkspaceNav(role)`, and `mobileMoreNav(role)`. Extend icon type for `more`.

- [ ] **Step 1: Write failing role-matrix tests**:
  - OWNER/MANAGER: dashboard, sell, cashbook, inventory, More.
  - CASHIER: dashboard, sell, sales, cashbook, More.
  - INVENTORY: dashboard, inventory, purchases, catalog, More.
  - ACCOUNTANT: dashboard, cashbook, customers, reports, More.
  - VIEWER: dashboard, sales, inventory, reports, More.
  - Unknown role: no direct route absent from `visibleWorkspaceNav(unknown)`.
- [ ] **Step 2: Verify RED** with `pnpm --filter @tradeos/web exec vitest run app/components/workspace/app-shell.test.tsx`.
- [ ] **Step 3: Implement mobile-priority selection** strictly by filtering the existing visible route set; do not create a second permission system.
- [ ] **Step 4: Verify GREEN** with the focused test plus `pnpm --filter @tradeos/web typecheck`.
- [ ] **Step 5: Commit** `feat(web): add role-aware mobile navigation model`.

### Task 4: Adaptive application shell

**Files:** create `mobile-bottom-nav.tsx`, `mobile-more-sheet.tsx`; modify `app-shell.tsx`, `workspace-shell.css`, `workspace-polish.css`, `app-shell.test.tsx`, `professional-shell.test.tsx`.

**Interfaces:**
- `MobileBottomNav({ role, pathname, onOpenMore })`
- `MobileMoreSheet({ open, role, pathname, onClose, businessContext, onLogout })`
- `AppShell` retains current `useWorkspace()` session/business/branch/logout interfaces.

- [ ] **Step 1: Write failing shell tests** requiring bottom nav + More sheet, `aria-current`, profile/sign-out, conditional business/branch selectors, token-backed touch sizes, safe-area padding, and absence of 9–10px navigation/role labels.
- [ ] **Step 2: Verify RED** with `pnpm --filter @tradeos/web exec vitest run app/components/workspace/app-shell.test.tsx app/components/workspace/professional-shell.test.tsx`.
- [ ] **Step 3: Implement shell**: lighter persistent desktop navigation, compact tablet behavior, compact mobile top bar + bottom nav + structured More sheet. Keep `NetworkStatus` and the current business/branch remount key.
- [ ] **Step 4: Implement More-sheet focus behavior**: focus on open, trap Tab, Escape close, restore opener focus, screen-reader labeling.
- [ ] **Step 5: Prune old shell/dashboard override responsibility** from `workspace-polish.css` without removing compatibility rules still needed by unmigrated routes.
- [ ] **Step 6: Verify GREEN** with `pnpm --filter @tradeos/web exec vitest run app/components/workspace && pnpm --filter @tradeos/web typecheck`.
- [ ] **Step 7: Commit** `feat(web): ship adaptive TradeOS application shell`.

### Task 5: Deterministic dashboard evidence model and loader

**Files:** create `dashboard-model.ts`, `dashboard-model.test.ts`, `dashboard-data.tsx`.

**Interfaces:**
- `DashboardEvidence` contains only fields needed from existing financial-summary, credit-aging, cash-forecast and sync/cache evidence.
- `buildDashboardModel(evidence): DashboardViewModel` returns `today`, `pulse`, `attention[]`, `moneyPosition`, `momentum`, `dataStatus`.
- `useDashboardData({ businessId, branchId, currencyCode, branchTimezone })` returns `{ evidence, busy, message, source }` where `source` is `live | cached | partial | unavailable`.

- [ ] **Step 1: Write failing model tests** for positive/negative explicit-baseline comparisons, overdue debt, forecast shortfall, partial cache, no evidence, non-GHS data, and deterministic pulse with no AI text.
- [ ] **Step 2: Verify RED** with `pnpm --filter @tradeos/web exec vitest run app/components/dashboard/dashboard-model.test.ts`.
- [ ] **Step 3: Implement pure model** using server totals/deltas only; do not reconstruct revenue, tax, COGS or forecast formulas.
- [ ] **Step 4: Implement loader/cache hook** with `clientApi`, existing online/offline patterns and guarded localStorage. Offline/partial cache exposes coverage rather than a fatal page.
- [ ] **Step 5: Verify GREEN** with dashboard model + existing CFO/cash-forecast tests.
- [ ] **Step 6: Commit** `feat(web): add deterministic dashboard intelligence model`.

### Task 6: Business Command Center dashboard

**Files:** create `dashboard-command-center.tsx`, `dashboard-command-center.test.tsx`, `dashboard.css`; modify `(workspace)/dashboard/page.tsx`, `layout.tsx`.

**Interface:** `DashboardCommandCenter({ businessId, businessName, branchId, branchName, currencyCode, role, branchTimezone })` composes Tasks 2 and 5.

**Required first-view hierarchy:** greeting/business context → Today state → TradeOS Pulse → role-aware Quick Actions → Needs attention. Money Position and useful Momentum follow. Deep analytics stay lower or under `/reports`.

- [ ] **Step 1: Write failing composition/CSS tests** requiring Today, TradeOS Pulse, Needs attention, quick actions, money position; page must no longer begin with catalog-count cards. CSS contracts: responsive collapse, 15px+ normal text, 48px mobile actions, tabular money numerals, safe 360px layout, reduced motion.
- [ ] **Step 2: Verify RED** with `pnpm --filter @tradeos/web exec vitest run app/components/dashboard/dashboard-command-center.test.tsx`.
- [ ] **Step 3: Implement command center** from the view model; render partial/unavailable evidence honestly; omit meaningless momentum visuals when coverage is insufficient.
- [ ] **Step 4: Replace dashboard first viewport** and route quick actions only to destinations visible to the current role. Keep `FinancialReports` only if it adds non-duplicative deep analytics; otherwise direct users to `/reports`.
- [ ] **Step 5: Verify GREEN** with dashboard/workspace/business tests plus web typecheck.
- [ ] **Step 6: Commit** `feat(web): turn dashboard into TradeOS command center`.

### Task 7: Regression and acceptance gate

- [ ] **Step 1: Web tests** — `pnpm --filter @tradeos/web test`; expected zero failures.
- [ ] **Step 2: Repository type/lint** — `pnpm typecheck && pnpm lint`; expected exit 0.
- [ ] **Step 3: Production build** — `pnpm --filter @tradeos/web build`; expected exit 0.
- [ ] **Step 4: Full repository tests** — `pnpm test`; expected zero failures.
- [ ] **Step 5: Manual visual matrix** — widths 360, 390/393, 430, 768, 1024, 1280, 1440; roles OWNER, CASHIER, INVENTORY, ACCOUNTANT, VIEWER. Verify no page overflow/tiny normal text; safe-area bottom nav; focus restoration; single/multi-context behavior; network status; first viewport priority; offline/cached presentation.
- [ ] **Step 6: Commit only evidence-backed hardening fixes**, then verify clean tree with `git status --short` and record `git log -1 --oneline`.

---

## Spec Coverage / Deliberate Split

This plan fully covers the spec’s design foundation, typography/touch rules, adaptive shell/mobile navigation, dashboard command center, contextual deterministic intelligence, accessibility/performance requirements relevant to these surfaces, and the initial QA matrix. The remaining independent subsystems are intentionally deferred to separate plans rather than hidden inside this one:

1. **Sell/POS** — phone/desktop transaction flow, cart/payment, line-item unit conversion, offline-safe success.
2. **Money + Stock + Purchases** — daily money actions, inventory home/detail, receiving.
3. **Customers + Sales + Returns** — receivables-first customer experience, sales detail, refund/return/exchange flow.
4. **Reports + Operations + Entry/Secondary** — CFO/report hierarchy, reconciliation, login/onboarding/settings and final cross-platform consistency.

Every later plan must consume the tokens, primitives, business components and shell contracts created here instead of inventing a second visual system.
