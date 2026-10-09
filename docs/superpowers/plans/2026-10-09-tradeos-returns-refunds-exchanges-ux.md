# TradeOS Returns, Refunds & Exchanges UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Apply test-driven development for each behavioral slice and verification-before-completion before handoff.

**Goal:** Recompose the existing TradeOS returns, refunds, and exchanges experience into a premium evidence-first correction workflow that matches the rebuilt shell, Dashboard, POS, Sales, Catalog, Inventory, and Customers while preserving the authoritative return/exchange engine, immutable posted-sale history, permissions, accounting effects, stock movement semantics, and durable offline queue.

**Architecture:** Keep `SalesAndReturns` as the orchestration boundary and keep the existing API/domain/offline contracts unchanged. Strengthen the presentation by migrating the returns workspace and correction sheets onto the shared TradeOS primitives (`CommandBar`, `StatePanel`, `MobileRecordCard`, `Button`, `StatusBadge`, transaction-evidence components), then harden responsive/accessibility behavior. Returns/refunds/exchanges remain linked correction events against posted sales; the original sale is never edited.

**Tech Stack:** Next.js 16.3.8, React 19.3.0, TypeScript 5.9.x, Vitest 3.2.4, semantic CSS, pnpm 10.17.1, existing TradeOS offline mutation queue and contracts.

**Authoritative design:** `docs/superpowers/specs/2026-10-09-tradeos-frontend-rebuild-design.md`

**Behavioral authority:** `docs/superpowers/specs/2026-10-08-tradeos-transaction-operations-design.md`

**Starting point:** branch `feat/tradeos-returns-refunds-ux`, created from corrected frontend-foundation head `87485fe52fe0ad632190362d5b6de39deb0413fe`. Do not modify or merge PR #37 from this slice.

## Global Constraints

- Preserve posted-sale immutability. Never add edit/delete/reprice behavior to completed sales.
- Preserve `RETURN_CREATE` and `EXCHANGE_CREATE` payloads, refund/payment semantics, server-side financial calculations, inventory movements, tax/COGS/receivable effects, and provider-refund status handling.
- Preserve `SalesAndReturns` public props and route contracts.
- Preserve `ReturnRefundSheet` and `ExchangeSheet` external props unless a strictly optional presentational prop is required and all callers/tests are updated.
- Preserve durable offline queue/idempotency behavior. Offline copy must use business language and rejected corrections must remain reviewable.
- VIEWER/read-only users must never receive enabled correction actions. Backend authorization remains authoritative.
- GHS renders with `₵`.
- Normal body text remains approximately 15–16px. Touch-oriented controls are at least 48px where practical.
- No `window.alert`, `window.prompt`, or `window.confirm`.
- Desktop command controls stay on one deliberate row where space permits; mobile reflows to touch-safe stacked/scroll-free composition.
- At 360px and 390px, long receipt/customer/item/unit/status names must not create horizontal page overflow.
- Do not introduce a UI framework or duplicate the shared design-system layer.
- Do not change backend/domain code in this frontend slice. If a genuine backend gap is discovered, document a proposal instead of silently changing contracts.

## Review Focus

1. **Evidence integrity:** original receipt remains visibly authoritative and read-only; corrections are linked evidence, not edits.
2. **Stock disposition correctness:** refund-only never returns stock; services have no stock return; prepared items are not silently restocked; physical products expose available/quarantine/discard choices only when applicable.
3. **Provider truthfulness:** MoMo/card/bank reversals remain processing until confirmed; UI never labels a pending external reversal as completed.
4. **Permissions/offline safety:** read-only roles do not get mutation affordances; offline submissions stay durable and rejected corrections remain visible for review.
5. **Mobile correction usability:** line selection, quantities, disposition, replacement selection, settlement, summary, and final action remain understandable and touch-safe at 360/390px.

## Existing File Structure

### Orchestration and routes
- `apps/web/app/components/sales-returns.tsx`
- `apps/web/app/(workspace)/returns/page.tsx`
- `apps/web/app/(workspace)/sales/page.tsx`

### Returns / refunds / exchanges
- `apps/web/app/components/returns/return-refund-workspace.tsx`
- `apps/web/app/components/returns/return-refund-workspace.test.tsx`
- `apps/web/app/components/returns/return-refund-sheet.tsx`
- `apps/web/app/components/returns/return-refund-sheet.test.tsx`
- `apps/web/app/components/returns/exchange-sheet.tsx`
- `apps/web/app/components/returns/exchange-sheet.test.tsx`

### Shared presentation and evidence
- `apps/web/app/components/ui/command-bar.tsx`
- `apps/web/app/components/ui/state-panel.tsx`
- `apps/web/app/components/ui/mobile-record-card.tsx`
- `apps/web/app/components/ui/button.tsx`
- `apps/web/app/components/ui/status-badge.tsx`
- `apps/web/app/components/business/transaction-evidence.tsx`

### Styling
- `apps/web/app/returns.css`
- `apps/web/app/sales-returns.css`
- `apps/web/app/ui-primitives.css`
- `apps/web/app/tradeos-tokens.css`

---

## Task 1: Recompose the returns workspace as an evidence-first sale selector

**Files:**
- Modify: `apps/web/app/components/returns/return-refund-workspace.test.tsx`
- Modify: `apps/web/app/components/returns/return-refund-workspace.tsx`
- Modify: `apps/web/app/sales-returns.css`
- Modify only if necessary: `apps/web/app/returns.css`

**Preserve interface:**
`ReturnRefundWorkspace({ sales, selectedId, loading, onSelect, onSearch })`.

- [ ] **Step 1: Add failing presentation-contract tests**
  - Require the workspace to use `CommandBar` for search/actions.
  - Require an intentional `StatePanel` for loading/empty/offline-compatible states rather than blank rows.
  - Require `MobileRecordCard` representation for sale evidence on narrow screens while retaining the efficient desktop list.
  - Require each sale candidate to show receipt, customer/walk-in identity, date, amount, refund state, and status without exposing edit controls.
  - Require long-name shrink/wrap contracts and 48px mobile targets in CSS.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
pnpm --filter @tradeos/web test -- app/components/returns/return-refund-workspace.test.tsx
```

Expected: FAIL on primitive usage and/or new responsive evidence contracts.

- [ ] **Step 3: Implement the workspace recomposition**
  - Replace the ad-hoc command row with `CommandBar`.
  - Keep the desktop evidence list compact and readable.
  - Add mobile sale cards using `MobileRecordCard`; do not compress the desktop row into a tiny grid.
  - Use `StatePanel` for intentional loading/empty/error-compatible states while preserving the current orchestration ownership of network messages.
  - Keep copy business-oriented: returns start from the original posted sale.

- [ ] **Step 4: Run focused test and typecheck**

```bash
pnpm --filter @tradeos/web test -- app/components/returns/return-refund-workspace.test.tsx
pnpm --filter @tradeos/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/returns/return-refund-workspace.tsx apps/web/app/components/returns/return-refund-workspace.test.tsx apps/web/app/sales-returns.css apps/web/app/returns.css
git commit -m "feat(web): modernize TradeOS returns evidence workspace"
```

---

## Task 2: Rebuild the return/refund sheet into a structured correction workflow

**Files:**
- Modify: `apps/web/app/components/returns/return-refund-sheet.test.tsx`
- Modify: `apps/web/app/components/returns/return-refund-sheet.tsx`
- Modify: `apps/web/app/returns.css`
- Modify if shared sheet rules require it: `apps/web/app/sales-returns.css`

**Preserve interface and domain types:** existing `ReturnMode`, `RefundMethod`, `ReturnDisposition`, `ReturnLineDraft`, and all existing props/callbacks.

- [ ] **Step 1: Add failing correction-workflow tests**
  - Original sale evidence is always visible and explicitly read-only.
  - Correction type is clear: Return + refund / Refund only / Exchange.
  - Remaining returnable quantity is visible per line.
  - `REFUND_ONLY` shows no stock return.
  - `SERVICE` shows stock not applicable.
  - `PREPARED_PRODUCT` communicates discard/waste semantics rather than restock.
  - Product lines expose available stock / quarantine / discard choices.
  - Reason is required and actor/reason audit evidence remains present.
  - Provider-backed refund methods communicate processing truthfully.
  - Footer action stays reachable on mobile and remains disabled until selection/reason are valid.

- [ ] **Step 2: Run tests and verify failure on new structure**

```bash
pnpm --filter @tradeos/web test -- app/components/returns/return-refund-sheet.test.tsx
```

- [ ] **Step 3: Recompose the sheet**
  - Build a deliberate hierarchy: receipt evidence → correction type → affected lines → stock disposition → refund destination/reason → effect summary → final action.
  - Keep `PostedHistoryNote`, `TransactionStatusBadge`, and `ActorReasonEvidence` prominent but not visually noisy.
  - Add a compact effect summary explaining what changes (refund amount, selected lines, stock outcome) without performing new client-side accounting.
  - Preserve focus trap, Escape, outside-click, and focus restoration.

- [ ] **Step 4: Implement responsive sheet CSS**
  - Desktop: readable side sheet with stable summary/footer.
  - 768px: controlled single/limited-two-column sections.
  - 390/360px: full-width sheet, stacked fields, 48px controls, no overflow, sticky footer with primary action.

- [ ] **Step 5: Run focused regression**

```bash
pnpm --filter @tradeos/web test -- app/components/returns/return-refund-sheet.test.tsx app/components/returns/return-refund-workspace.test.tsx
pnpm --filter @tradeos/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/returns/return-refund-sheet.tsx apps/web/app/components/returns/return-refund-sheet.test.tsx apps/web/app/returns.css apps/web/app/sales-returns.css
git commit -m "feat(web): rebuild return and refund correction sheet"
```

---

## Task 3: Recompose Exchange as one linked correction journey

**Files:**
- Modify: `apps/web/app/components/returns/exchange-sheet.test.tsx`
- Modify: `apps/web/app/components/returns/exchange-sheet.tsx`
- Modify: `apps/web/app/returns.css`
- Reuse without business changes: `apps/web/app/components/pos/product-browser.tsx`, `cart-panel.tsx`, `pos-model.ts`

**Preserve:** `EXCHANGE_CREATE` payload, `buildExchangePayload`, server-authoritative repricing, offline queue behavior, linked-result semantics, settlement methods.

- [ ] **Step 1: Add failing exchange UX tests**
  - Three stages are visually understandable: items coming back → replacements → difference/settlement.
  - Original receipt remains read-only and linked.
  - Returnable quantities and stock disposition remain explicit.
  - Replacement browser/cart continue to use explicit sell units.
  - Difference clearly states `Customer pays`, `Customer receives`, or `No difference`.
  - Final price is identified as server-authoritative; client estimate is not presented as posted accounting fact.
  - Linked replacement receipt + return correction evidence is visible after apply.
  - Offline, pending, rejected, and provider-processing copy remains truthful.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm --filter @tradeos/web test -- app/components/returns/exchange-sheet.test.tsx
```

- [ ] **Step 3: Implement the exchange recomposition**
  - Preserve the current working cart/model behavior.
  - Improve progressive disclosure so replacement browsing does not bury the return evidence or settlement summary.
  - Keep settlement controls near the difference summary.
  - Keep the linked result as auditable evidence, not a generic success toast.

- [ ] **Step 4: Run exchange + POS regression**

```bash
pnpm --filter @tradeos/web test -- app/components/returns/exchange-sheet.test.tsx app/components/pos/pos-workspace.test.tsx app/components/pos/pos-cart.test.tsx app/components/pos/pos-model.test.ts
pnpm --filter @tradeos/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/returns/exchange-sheet.tsx apps/web/app/components/returns/exchange-sheet.test.tsx apps/web/app/returns.css
git commit -m "feat(web): modernize linked exchange workflow"
```

---

## Task 4: Harden orchestration, permissions, deep links, and offline state presentation

**Files:**
- Modify/Test: `apps/web/app/components/sales-returns.tsx`
- Modify/Test: existing return workspace/sheet tests; create `apps/web/app/components/returns/returns-orchestration.test.tsx` only if focused orchestration coverage cannot be expressed cleanly in existing tests.
- Modify if needed: `apps/web/app/sales-returns.css`

- [ ] **Step 1: Add failing orchestration tests**
  - `/returns?saleId=...` still loads the intended sale.
  - `mode=exchange` still opens exchange mode.
  - Only correction-capable roles receive return/exchange affordances.
  - Cached sale list/detail remains usable offline.
  - `RETURN_CREATE` and `EXCHANGE_CREATE` mutation types/payload ownership are unchanged.
  - Applied mutation events refresh sale evidence.
  - Rejected corrections surface review language rather than silent failure.

- [ ] **Step 2: Run tests and verify any real gaps**

```bash
pnpm --filter @tradeos/web test -- app/components/returns app/components/sales/sales-workspace.test.tsx app/components/sales/sale-detail-sheet.test.tsx
```

- [ ] **Step 3: Make only necessary orchestration/presentation changes**
  - Do not refactor working domain/network logic merely for style.
  - Centralize page-level status presentation if needed so offline/pending/rejected messages remain visible without duplicating messages in nested sheets.
  - Preserve `canAccessWorkspaceRoute` presentation gate and server authorization.

- [ ] **Step 4: Run focused and full web tests**

```bash
pnpm --filter @tradeos/web test -- app/components/returns app/components/sales/sales-workspace.test.tsx app/components/sales/sale-detail-sheet.test.tsx
pnpm --filter @tradeos/web test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/sales-returns.tsx apps/web/app/components/returns apps/web/app/sales-returns.css
git commit -m "test(web): harden returns permissions and offline orchestration"
```

---

## Task 5: Cross-width, accessibility, and interaction hardening

**Files:**
- Modify: `apps/web/app/returns.css`
- Modify: `apps/web/app/sales-returns.css`
- Modify/Test: return/exchange tests as needed
- Create: `apps/web/app/components/returns/returns-responsive-contract.test.ts` if dedicated source-contract coverage improves clarity.

- [ ] **Step 1: Add responsive/accessibility contract tests**
  - 360/390: no fixed widths that force page overflow; long labels wrap/truncate deliberately.
  - 768: sheet/workspace layout remains intentional, not squeezed desktop.
  - >=1280: search/action hierarchy and evidence density are controlled.
  - Touch targets >=48px for mobile correction controls.
  - Visible `:focus-visible`, hover, pressed, disabled states.
  - Dialog semantics remain `role="dialog"`, `aria-modal="true"`; status messages use `role="status"`/`aria-live` where appropriate.
  - No browser alert/prompt/confirm.

- [ ] **Step 2: Run and make CSS/component corrections**

```bash
pnpm --filter @tradeos/web test -- app/components/returns
```

- [ ] **Step 3: Run web quality gate**

```bash
pnpm --filter @tradeos/web test
pnpm --filter @tradeos/web typecheck
pnpm --filter @tradeos/web lint
pnpm --filter @tradeos/web build
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/returns apps/web/app/returns.css apps/web/app/sales-returns.css
git commit -m "test(web): harden returns responsive accessibility"
```

---

## Task 6: QA evidence and handoff PR

**Files:**
- Create: `docs/qa/2026-10-09-tradeos-returns-refunds-exchanges.md`

- [ ] **Step 1: Record exact automated evidence**
  - Focused return/refund/exchange tests.
  - Full web test count.
  - Typecheck/lint/build results.
  - Confirm no backend/domain files changed.
  - Confirm mutation payload names remain `RETURN_CREATE` / `EXCHANGE_CREATE` and pricing/accounting remain server-authoritative.

- [ ] **Step 2: Rendered visual UAT when an executable preview is available**
  Inspect `/returns` plus return/refund/exchange sheets at 360px, 390px, 768px and >=1280px. Exercise long names, partially refunded sale, walk-in sale, service line, prepared product, product restock/quarantine/discard, offline saved state, pending provider reversal, and exchange price difference.

  If no browser-capable preview/backend is available, state that limitation explicitly in the QA note and leave visual UAT as a staging acceptance gate. Do not call CSS tests visual QA.

- [ ] **Step 3: Commit QA note**

```bash
git add docs/qa/2026-10-09-tradeos-returns-refunds-exchanges.md
git commit -m "docs: record returns refunds exchanges QA"
```

- [ ] **Step 4: Push branch and open a new PR**
  - Base PR/branch relationship must preserve the corrected frontend foundation. If PR #37 is still unmerged, open this as a stacked PR whose base is `feat/tradeos-frontend-foundation`; after #37 merges, retarget to `main`.
  - Do not merge automatically.

## Definition of Done

This slice is complete only when the actual Returns/Refunds/Exchange implementation—not merely tests—visibly uses the rebuilt TradeOS design language; original sale evidence remains immutable; stock/refund/exchange semantics remain server-authoritative and truthful; mobile/desktop flows are deliberate; offline and permission behavior are preserved; the full web quality gate passes; and rendered UAT is either completed against a working preview or explicitly documented as an outstanding staging gate.
