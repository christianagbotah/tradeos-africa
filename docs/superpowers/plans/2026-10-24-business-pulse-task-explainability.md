# Business Pulse Task Explainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the existing lazy, permission-filtered `Why this task?` explanation inside Business Pulse review tasks without adding backend calls on list load or nesting interactive controls inside links.

**Architecture:** Keep the existing explanation API/component unchanged. Refactor each Pulse review-task row from one all-enclosing `<Link>` into a row/card containing a workflow `<Link>` and a sibling `BusinessActionExplanation`, so explanation fetches only after an explicit click and offline fallback continues to work.

**Tech Stack:** React/Next.js, TypeScript, Vitest contract tests.

**Spec:** `docs/superpowers/specs/2026-10-24-ai-task-explainability-design.md`

## Global Constraints

- No backend/API/migration changes.
- No new eager explanation fetches or list-row N+1 calls.
- No economic/access mutation.
- `Why this task?` must not be nested inside a link.
- Offline mode shows cached reason plus reconnect guidance through the existing component.

## Review Focus

- Pulse row keeps canonical workflow navigation while explanation is separately clickable.
- Opening Pulse does not fetch task explanations.
- Context switching still closes Pulse and prevents stale task interaction.
- Offline explanation performs no network request.
- Mobile layout remains usable with the extra secondary control.

---

### Task 1: Reuse task explanation in Business Pulse

**Files:**
- Modify: `apps/web/app/components/intelligence/business-pulse-contract.test.ts`
- Modify: `apps/web/app/components/intelligence/business-pulse.tsx`
- Modify only if needed: `apps/web/app/intelligence.css`

**Interfaces:**
- Consumes: `BusinessActionExplanation({ item, businessId, online })`
- Produces: Pulse review-task cards with sibling workflow navigation and lazy explanation UI.

- [ ] **Step 1: Write the failing contract test**
  Assert Pulse imports/mounts `BusinessActionExplanation`, passes `session.businessId` and `queue.online`, and no longer wraps the explanation control inside the workflow `<Link>`.

- [ ] **Step 2: Run the focused test and observe RED**
  Run: `pnpm exec vitest run app/components/intelligence/business-pulse-contract.test.ts`
  Expected: FAIL because Pulse does not yet mount the explanation component.

- [ ] **Step 3: Implement the minimal Pulse row refactor**
  Import `BusinessActionExplanation`; render each task in a non-link row/card with the existing canonical workflow `<Link>` plus a sibling explanation component. Preserve close-on-navigation behavior.

- [ ] **Step 4: Run focused GREEN verification**
  Run: `pnpm exec vitest run app/components/intelligence/business-pulse-contract.test.ts app/components/intelligence/business-action-explanation-contract.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run Web completion gate**
  Run: `pnpm test && pnpm typecheck && pnpm build`
  Expected: all tests pass, typecheck succeeds, production build generates all routes.

- [ ] **Step 6: Review and commit**
  Verify `git diff --check`; inspect that no API/mutation paths were added; commit the Pulse follow-up.
