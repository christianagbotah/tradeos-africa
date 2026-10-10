# Restore True Z.ai Visual Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the authenticated TradeOS web app visually match Z.ai's committed QA screenshots while preserving current backend/domain/currency/offline behavior.

**Architecture:** The screenshots under `docs/qa/evidence/tradeos-frontend-final/` are the visual contract. Restore the Z.ai single-design-system presentation boundary (`tradeos-app.css` plus the original eight CSS imports), then add the screenshot-only shell/Dashboard/POS composition that was captured in QA but not committed. Keep current data hooks and mutation contracts.

**Tech Stack:** Next.js, React, TypeScript, CSS, Vitest, Playwright/Chromium for rendered QA.

**Spec:** `docs/qa/evidence/tradeos-frontend-final/` and PR #38 QA note.

## Global Constraints
- Do not change API/domain/accounting/permissions/offline-sync semantics.
- Preserve approved split-screen login/onboarding and exponent-aware multi-currency behavior.
- Desktop and mobile must match the Z.ai visual grammar, not the later canonical dark-navy rewrite.
- 360/390/768/1280 must have no horizontal overflow.
- Buttons/links remain touch-safe and keyboard accessible.

## Review Focus
- Shell search/business/profile controls must not block mobile content.
- Role-aware navigation must preserve server-authoritative access.
- Dashboard must degrade cleanly when evidence is partial/empty.
- POS cart/customer/payment behavior must remain unchanged while layout changes.
- Currency formatting must remain 0/2/3-decimal aware.

### Task 1: Restore Z.ai shell and navigation composition
- Test: assert global search, sidebar business card, mobile business header, Z.ai nav grouping classes.
- Implement in `components/workspace/app-shell.tsx`, `workspace-navigation.ts`, `workspace-shell.css`.
- Verify focused shell tests.

### Task 2: Restore Z.ai Dashboard composition
- Test: assert Dashboard title/subtitle, action bar, AI actions section, four KPI cards, trend/money panels.
- Implement using existing dashboard model/evidence; no invented accounting data.
- Verify dashboard tests.

### Task 3: Restore Z.ai POS composition
- Test: assert product-first layout, category chips, compact customer selector, desktop right cart, mobile product-first behavior.
- Implement without changing cart/checkout mutation contracts.
- Verify POS tests.

### Task 4: Restore remaining module presentation boundary
- Restore Z.ai `tradeos-app.css` and eight-file root CSS import boundary while preserving approved public-entry styles separately if required.
- Reconcile later component behavior fixes with Z.ai classes.
- Run full web suite, typecheck, lint, build.

### Task 5: Rendered acceptance and deployment
- Capture Dashboard/POS/Purchases/Cashbook/Operations/Reports at 360/390/768/1280.
- Compare against Z.ai evidence and fix visual drift.
- Push PR, require green CI, merge, deploy exact merge, bump SW cache, verify public HTTPS.
