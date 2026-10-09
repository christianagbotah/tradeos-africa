# Promote Z.ai Canonical Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Z.ai canonical commit `062c100` the presentation authority for the entire authenticated TradeOS web app while preserving current correctness and backend/domain contracts.

**Architecture:** Replay Z.ai's seven canonical presentation commits onto current `main`. Resolve conflicts by taking Z.ai for JSX/CSS/composition and current `main` for public-entry/login, multi-currency money helpers, optimistic concurrency, offline/sync behavior and API/domain contracts. Bump the service-worker cache version so existing browsers invalidate stale frontend assets.

**Tech Stack:** Next.js 16, React, TypeScript, Vitest, CSS, service worker.

**Spec:** `docs/superpowers/specs/2026-10-09-tradeos-frontend-rebuild-design.md`

## Global Constraints
- Z.ai canonical frontend is the only authenticated presentation authority.
- Preserve current login/register/onboarding design and multi-currency correctness.
- Preserve backend/API/domain/accounting/offline-sync behavior.
- No legacy `tradeos-app.css` authenticated skin beneath canonical module styles.
- 360/390/768/1280 responsive verification; no horizontal overflow.
- All clickable desktop controls use pointer cursor; dropdown/popover surfaces opaque.

## Tasks
- [ ] Replay `6174f7f` canonical boundary and resolve root CSS/public-entry conflicts.
- [ ] Replay `5949d84` Returns migration, preserving current orchestration/sync semantics.
- [ ] Replay `cee1d81` Procurement migration, preserving current money/concurrency rules.
- [ ] Replay `739b336` Cashbook/Treasury migration, preserving currency-exponent parsing.
- [ ] Replay `6fb406f` Operations migration, preserving server-authoritative operational contracts.
- [ ] Replay `6560702` Reports/AI migration.
- [ ] Replay `062c100` canonical interaction polish.
- [ ] Bump service-worker shell cache and add anti-regression boundary tests.
- [ ] Run full tests/typecheck/lint/build/diff-check and rendered browser QA.
- [ ] Push PR, require green GitHub CI, merge, deploy, verify live authenticated UI.
