# Contextual Intelligence Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one evidence-backed contextual intelligence system to Inventory, Customers, Purchases, Reports, and Settings, with safe contextual Ask TradeOS handoff.

**Architecture:** A pure selector maps a workflow surface to relevant `BusinessBriefing` sections and produces a compact view model. A reusable client component fetches the existing briefing for the current tenant/branch, renders the view model, and dispatches a typed browser event to the existing global Ask TradeOS drawer. AppShell translates that event into drawer state and a prefilled question; target workspaces only mount the shared component.

**Tech Stack:** Next.js/React, TypeScript, Vitest, existing `useWorkspace`, `useApiFetch`, `@tradeos/contracts`, existing `app/intelligence.css`.

**Spec:** `docs/superpowers/specs/2026-10-23-contextual-intelligence-workflows-design.md`

## Global Constraints

- Reuse `/v1/intelligence/briefing`; do not add new backend endpoints in this slice.
- Requests must use current `session.businessId` and `session.branchId`.
- Contextual panel is read-only; no economic or access mutation endpoints.
- Recommendation actions remain navigation links into existing human-controlled workflows.
- Ask TradeOS is disabled offline and uses the existing query drawer/route.
- Reports contextual intelligence uses briefing range `month`; other surfaces use `today`.
- Do not write a second incompatible payload into the existing business-intelligence cache key.

## Review Focus

- Wrong tenant/branch after workspace switching → request path must be recomputed from the current session.
- Duplicate urgent/recommendation evidence appearing across selected sections → selector must deduplicate by stable item/recommendation identity.
- Malformed/unknown surface usage → TypeScript surface union and exhaustive definitions prevent silent fallback.
- Offline click path → contextual Ask button must be disabled and no event dispatched.
- Page integration drift → contract test must assert all five target workspace source files mount the shared component with the expected surface id.

---

### Task 1: Contextual intelligence selector

**Files:**
- Create: `apps/web/app/components/intelligence/contextual-intelligence.ts`
- Create: `apps/web/app/components/intelligence/contextual-intelligence.test.ts`

**Interfaces:**
- Consumes: `BusinessBriefing`, `BusinessBriefingSectionCode`, `BusinessAttentionItem`, `BusinessRecommendation` from `@tradeos/contracts`.
- Produces: `ContextualIntelligenceSurface`, `ContextualIntelligenceView`, `contextualIntelligenceDefinition(surface)`, `selectContextualIntelligence(briefing, surface)`, and `contextualWorkflowHref(actionType)`.

- [ ] **Step 1: Write failing selector tests** for the five surface mappings, severity ordering, deduplication, settings readiness metadata, and safe workflow href mapping.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/web exec vitest run app/components/intelligence/contextual-intelligence.test.ts` and verify RED because the module is absent.
- [ ] **Step 3: Implement the pure selector** with exact surface definitions from the spec; order `CRITICAL > HIGH > MEDIUM > LOW > INFO`; dedupe attention by `id` and recommendations by `code`.
- [ ] **Step 4: Rerun the focused test** and require GREEN.
- [ ] **Step 5: Commit** `feat(ai): add contextual intelligence selector`.

### Task 2: Reusable contextual intelligence panel

**Files:**
- Create: `apps/web/app/components/intelligence/contextual-intelligence-panel.tsx`
- Create: `apps/web/app/components/intelligence/contextual-intelligence-panel-contract.test.ts`
- Modify: `apps/web/app/intelligence.css`

**Interfaces:**
- Consumes: Task 1 selector; `useWorkspace`; `useApiFetch<BusinessBriefing>`.
- Produces: `<ContextualIntelligencePanel surface: ContextualIntelligenceSurface />` and browser event `tradeos:ask` with `{ question: string }` detail.

- [ ] **Step 1: Write failing contract tests** asserting briefing path, current tenant/branch scope, surface selector usage, explicit offline state, disabled offline Ask button, `tradeos:ask` dispatch, recommendation workflow links, and absence of economic mutation routes.
- [ ] **Step 2: Run the focused contract test** and verify RED because the component is absent.
- [ ] **Step 3: Implement the panel** using `range=month` only for Reports and `range=today` otherwise; render section summaries, top attention/recommendations, confidence/data quality, and contextual Ask button.
- [ ] **Step 4: Add responsive `.tos-context-ai*` styles** to `app/intelligence.css` without changing unrelated page layouts.
- [ ] **Step 5: Rerun Task 1 + Task 2 tests** and require GREEN.
- [ ] **Step 6: Commit** `feat(ai): add contextual intelligence panel`.

### Task 3: Contextual Ask TradeOS handoff

**Files:**
- Modify: `apps/web/app/components/intelligence/ask-tradeos-drawer.tsx`
- Modify: `apps/web/app/components/workspace/app-shell.tsx`
- Modify: `apps/web/app/components/intelligence/business-intelligence-contract.test.ts`

**Interfaces:**
- Consumes: `tradeos:ask` browser event from Task 2.
- Produces: `AskTradeOSDrawer` optional `initialQuestion?: string`; AppShell event listener that opens the drawer and supplies that question.

- [ ] **Step 1: Add failing contract assertions** for `initialQuestion`, `tradeos:ask` listener, and global topbar Ask TradeOS continuing to open without forced contextual text.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/web exec vitest run app/components/intelligence/business-intelligence-contract.test.ts` and verify RED.
- [ ] **Step 3: Implement AppShell event handling** with cleanup on unmount/path change; contextual events set the prompt, topbar opening clears it.
- [ ] **Step 4: Implement drawer prefilling** on contextual open while preserving normal typing and existing answer/evidence/recommendation behavior.
- [ ] **Step 5: Rerun the focused contract suite** and require GREEN.
- [ ] **Step 6: Commit** `feat(ai): connect contextual Ask TradeOS prompts`.

### Task 4: Mount across tenant workflows and verify

**Files:**
- Modify: `apps/web/app/components/inventory/inventory-workspace.tsx`
- Modify: `apps/web/app/components/customers/customer-workspace.tsx`
- Modify: `apps/web/app/components/purchases/supplier-workspace.tsx`
- Modify: `apps/web/app/components/reports/financial-reports.tsx`
- Modify: `apps/web/app/components/settings/settings-workspace.tsx`
- Create: `apps/web/app/components/intelligence/contextual-intelligence-workspaces-contract.test.ts`

**Interfaces:**
- Consumes: `<ContextualIntelligencePanel surface=... />` from Task 2.
- Produces: contextual intelligence visible in all five target workflows immediately after each page header/hero.

- [ ] **Step 1: Write failing workspace contract test** asserting imports and exact surface mounts for inventory/customers/purchases/reports/settings, plus ordering before the primary dense table/form content.
- [ ] **Step 2: Run the contract test** and verify RED.
- [ ] **Step 3: Mount the component** once in each target workspace with the exact spec surface id.
- [ ] **Step 4: Run all contextual intelligence tests** and strict web typecheck.
- [ ] **Step 5: Run full** `pnpm --filter @tradeos/web test`, `pnpm --filter @tradeos/web typecheck`, and `git diff --check`.
- [ ] **Step 6: Review safety** by searching the contextual files for payment/refund/sale/purchase/stock-write-off/access mutation routes; there must be none.
- [ ] **Step 7: Commit** `feat(ai): embed intelligence across tenant workflows`, push the existing feature branch, update draft PR #92, and inspect CI/Visual QA registration.
