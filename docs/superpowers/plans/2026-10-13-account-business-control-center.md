# Account & Business Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship secure account/profile/password/session management plus multi-business and multi-branch creation, editing, switching, and offline-safe context persistence.

**Architecture:** Keep global identity operations in auth/account services, tenant operations in a business-management service, and Web context switching in the workspace/session layer. Reuse one owned-business creation service for first onboarding and later add-business flows. Namespace Web offline queues by business so context switches preserve unsynced work without cross-tenant leakage.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL, React/Next.js, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-13-account-business-control-center-design.md`

## Global Constraints
- Preserve current route/domain/accounting semantics and tenant isolation.
- Migration is `0018_account_business_control.sql`; `0017` is reserved for parallel staff-management work.
- New password length is 8–200 characters and current password is required.
- OWNER and ADMIN are the only business/branch management roles.
- Base currency cannot change after financial or inventory activity exists.
- The last active branch cannot be deactivated.
- Business/branch history is never hard-deleted.
- Switching business must preserve business-scoped offline queues and must never flush another business's queue.
- Do not duplicate staff invitation/lifecycle APIs.

## Review Focus
- Identifier update collision or clearing both email and phone must fail without partial profile changes.
- Password change must preserve the current session while revoking all other sessions by default.
- Cross-business business/branch IDs must always be denied.
- Currency changes after any sale, purchase, cashbook, payment, or inventory activity must be rejected.
- Business switching with pending offline mutations must preserve each business queue independently and never cross-flush.

---

### Task 1: Account profile and security backend
**Files:**
- Create: `packages/db/migrations/0018_account_business_control.sql`
- Create: `apps/api/src/account-service.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Test: `apps/api/test/account-management.integration.test.ts`

**Interfaces:**
- Produces `updateOwnProfile`, `changeOwnPassword`, `listOwnSessions`, `revokeOwnSession`, `revokeOtherSessions` and the corresponding `/v1/me` and `/v1/auth/*` routes.
- Later Web settings consumes response fields `avatarUrl`, session metadata, and updated identity values.

- [ ] Write failing integration tests for profile update, password-gated identifier change, uniqueness, retaining one identifier, password change, current-session preservation, other-session revocation, session listing and targeted revocation.
- [ ] Run targeted test and verify RED because routes/migration are missing.
- [ ] Add migration columns and account-security audit table.
- [ ] Implement account service and thin routes with transactional security-event writes.
- [ ] Run targeted test, API typecheck/build, and verify GREEN.
- [ ] Commit `feat(api): add account profile and security management`.

### Task 2: Business and branch management backend
**Files:**
- Create: `apps/api/src/business-management-service.ts`
- Modify: `apps/api/src/onboarding.ts`
- Modify: `apps/api/src/businesses.ts`
- Modify: `apps/api/src/app.ts` only if route registration changes are required
- Test: `apps/api/test/business-management.integration.test.ts`

**Interfaces:**
- Produces `createOwnedBusiness`, business profile PATCH, branch create/PATCH/deactivate/reactivate, extended business context.
- Web context/settings consume business and branch DTOs from these routes.

- [ ] Write failing tests for second-business creation, shared onboarding service behavior, OWNER/ADMIN authorization, outsider denial, business profile edit, currency lock after history, branch create/edit, unique code, last-active-branch protection, deactivate/reactivate, and audit events.
- [ ] Run targeted test and verify RED.
- [ ] Implement reusable business creation service and management lifecycle.
- [ ] Extend context response with profile fields and branch details.
- [ ] Run targeted test plus existing identity/onboarding test, API typecheck/build, and verify GREEN.
- [ ] Commit `feat(api): add business and branch lifecycle management`.

### Task 3: Business-scoped Web offline queues and workspace context switching
**Files:**
- Modify: `apps/web/lib/offline-sync.ts`
- Modify: `apps/web/lib/offline-sync.test.ts`
- Modify: `apps/web/app/components/workspace/workspace-provider.tsx`
- Create/Test: `apps/web/app/components/workspace/context-switching.test.ts`

**Interfaces:**
- Produces `switchBusinessContext(session)` and `switchBranchContext(branch)` behavior through WorkspaceContext, business-scoped queue storage, and context rehydration.
- Shell/settings consume workspace methods and membership/context state.

- [ ] Write failing queue tests proving business A and B snapshots survive switches independently, sign-out does not erase them, and active business only flushes its own queue.
- [ ] Verify RED against the current single-key queue.
- [ ] Implement business-keyed queue storage with one-time legacy snapshot migration and authenticated-business access boundaries.
- [ ] Write failing workspace context tests for switching only after authoritative context load and rejecting inactive/cross-business branches.
- [ ] Implement workspace membership/context loaders and switch methods; persist last selected context.
- [ ] Run Web tests/typecheck and verify GREEN.
- [ ] Commit `feat(web): add safe multi-business workspace context`.

### Task 4: Settings control center and shell business/branch switcher
**Files:**
- Create: `apps/web/app/settings/page.tsx`
- Create: `apps/web/app/components/settings/settings-workspace.tsx`
- Create: `apps/web/app/components/settings/settings-workspace.test.tsx`
- Modify: `apps/web/app/components/workspace/app-shell.tsx`
- Modify: `apps/web/app/components/workspace/workspace-navigation.tsx`
- Modify: `apps/web/app/workspace-shell.css` and/or existing route CSS ownership files

**Interfaces:**
- Consumes Task 1 account routes, Task 2 business/branch routes, Task 3 context switch methods.
- Produces responsive Profile, Security, Business, Branches, Team placeholder, Devices UI and global context/account menus.

- [ ] Write failing component/contract tests for profile/security forms, session devices, business/branch management visibility, role gating, business/branch switcher, account menu, no alert/prompt, and 390px structural contract.
- [ ] Verify RED.
- [ ] Implement settings route and account/context menus using existing design-system primitives and inline feedback states.
- [ ] Keep Team clearly connected to the separate staff-management capability without inventing duplicate endpoints.
- [ ] Run focused tests, full Web tests, typecheck, production build, and verify GREEN.
- [ ] Commit `feat(web): add account and business control center`.

### Task 5: Final integration, docs, and acceptance gates
**Files:**
- Modify: `docs/frontend-architecture/API-GAP-REGISTER.md`
- Modify: spec status only after verified implementation
- Test: repository verification commands

**Interfaces:**
- Consumes all prior tasks; produces review-ready branch.

- [ ] Update API gap register and spec status truthfully.
- [ ] Run contracts/Web/API typecheck and lint, Web build, targeted API integration tests, `git diff --check`, and clean migration validation where local PostgreSQL credentials permit.
- [ ] Inspect `git diff origin/main...HEAD` for accidental Z.ai/frontend replacement overlap and security leaks.
- [ ] Commit `docs: mark account and business control center implemented`.
- [ ] Push feature branch and open a draft PR; do not merge until exact-head CI succeeds.
