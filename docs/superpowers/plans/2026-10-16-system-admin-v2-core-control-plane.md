# System Admin V2 Core Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing secure System Admin read plane into a complete, easy-to-use control plane for administrator account security, tenant 360 management, plans/subscriptions, SaaS billing, platform administrators, and live platform metrics.

**Architecture:** Keep the dedicated System Admin host and `/api/admin/*` security boundary. Split domain logic into focused `platform-admin/*-service.ts` modules, keep route handlers thin, and make every privileged mutation server-authorized and append-only audited. Reuse the existing plan/subscription tables and add a separate SaaS billing ledger instead of mixing platform billing with tenant POS/cashbook payments.

**Tech Stack:** TypeScript 5.9, Fastify 5, PostgreSQL 17, Next.js 16 App Router, React 19, Vitest 3, existing `@tradeos/contracts`, existing platform-admin cookie/session model.

**Spec:** `docs/superpowers/specs/2026-10-16-system-admin-v2-ai-automation-design.md`

## Global Constraints

- System Admin remains isolated from tenant/business workspace administration and continues to use `/api/admin/*` plus the dedicated admin host.
- Tenant POS/customer/supplier payments must never be reused as TradeOS SaaS subscription payments.
- All monetary amounts are integer minor units; no floating-point money enters service or persistence contracts.
- Role authorization is enforced server-side; hidden UI controls are never the security boundary.
- Every privileged write records actor, target, previous/new state where applicable, reason/correlation context, and timestamp in `platform_audit_events`.
- The last active `SUPER_ADMIN` cannot be deactivated or demoted.
- Sensitive mutations use stale-write/revision protection where concurrent edits matter.
- Mobile/narrow-screen System Admin views must remain usable; tables need meaningful card fallbacks or responsive layouts.
- Existing `__Host-tradeos_admin_session` HttpOnly/Secure/SameSite=Strict behavior and dedicated-host runtime must not regress.
- No route or audit payload may expose passwords, session tokens, provider secrets, or payment credentials.

## Review Focus

- Last-active-`SUPER_ADMIN` protection: concurrent role/deactivation attempts must leave at least one active `SUPER_ADMIN`; pinned in Task 8 integration tests.
- Duplicate provider payment callbacks: replaying the same provider event/reference must not create a second subscription payment; pinned in Task 6 integration tests.
- Stale subscription/tenant mutation: an outdated `expectedUpdatedAt` must fail with a typed conflict instead of overwriting newer state; pinned in Tasks 3 and 5.
- Session revocation: changing password must revoke every other session but preserve the current session only if the service explicitly rotates/reissues it; pinned in Task 1.
- Role mismatch: `SUPPORT`, `DEVELOPER`, `OPERATIONS`, and `BILLING` must not gain adjacent write permissions merely because the UI exposes a page; pinned across Tasks 3, 5, 6, and 8.

---

### Task 1: Administrator profile, password, and own-session API

**Files:**
- Modify: `packages/contracts/src/platform-admin.ts`
- Create: `apps/api/src/platform-admin/profile-service.ts`
- Modify: `apps/api/src/platform-admin/routes.ts`
- Test: `apps/api/test/platform-admin-profile.integration.test.ts`

**Interfaces:**
- Consumes: `authenticatePlatformAdmin(pool, cookieToken)`, existing `hashPassword`/`verifyPassword`, `PlatformAdminContext`.
- Produces: `getAdminProfile(pool, actor)`, `updateAdminProfile(pool, actor, input)`, `changeAdminPassword(pool, actor, input)`, `listOwnAdminSessions(pool, actor)`, `revokeOwnAdminSession(pool, actor, sessionId)` and contracts `AdminProfile`, `AdminSessionSummary`.

- [ ] **Step 1: Write failing profile/security integration tests**
  - Assert `GET /api/admin/profile` returns id/email/displayName/role/lastLoginAt without password/session token fields.
  - Assert profile update lowercases/uniquely validates email and audits `ADMIN_PROFILE_UPDATED`.
  - Assert password change rejects wrong current password, accepts valid current password, updates the hash, audits `ADMIN_PASSWORD_CHANGED`, and revokes all other active sessions.
  - Assert own-session listing marks the current session and another session can be revoked only when it belongs to the same platform user.

- [ ] **Step 2: Run tests and verify RED**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-profile.integration.test.ts --no-file-parallelism`
  - Expected: FAIL because profile/session endpoints and service do not exist.

- [ ] **Step 3: Implement the service and thin routes**
  - Add exact service signatures listed above.
  - Add routes: `GET/PATCH /api/admin/profile`, `POST /api/admin/profile/password`, `GET /api/admin/profile/sessions`, `DELETE /api/admin/profile/sessions/:sessionId`.
  - Use transactions for profile/password mutations and append `platform_audit_events` in the same transaction.

- [ ] **Step 4: Verify GREEN and typecheck**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-profile.integration.test.ts --no-file-parallelism && pnpm --filter @tradeos/api typecheck && pnpm --filter @tradeos/contracts build`
  - Expected: all pass.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin): add profile and session security APIs`

### Task 2: My Account & Security UI

**Files:**
- Modify: `apps/system-admin/app/components/nav.ts`
- Modify: `apps/system-admin/app/components/platform-admin-session.tsx`
- Create: `apps/system-admin/app/console/profile/page.tsx`
- Modify: `apps/system-admin/app/admin-components.css`
- Test: `apps/system-admin/app/components/profile-security-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 profile/password/session endpoints through `apiFetch`.
- Produces: `/console/profile` UI and `refreshAdminUser(): Promise<void>` on the session context so topbar identity updates after profile edits.

- [ ] **Step 1: Write failing UI contract tests**
  - Assert nav contains `/console/profile`.
  - Assert page references all four profile endpoints, includes current-password/new-password fields, active-session list, revoke action, loading/error/success states, and never renders password values back to the user.
  - Assert responsive markup uses existing admin page/card/button primitives instead of a raw wide table-only layout.

- [ ] **Step 2: Run tests and verify RED**
  - Run: `pnpm --filter @tradeos/system-admin exec vitest run app/components/profile-security-contract.test.ts`
  - Expected: FAIL because the page and context refresh method are absent.

- [ ] **Step 3: Implement profile page and context refresh**
  - Add `refreshAdminUser()` to `AdminSessionContextValue` by reusing `/api/admin/session/me`.
  - On successful profile update, call `refreshAdminUser()` so the shell/topbar reflects the new display name/email immediately.
  - Password form clears secret fields after success/failure; session revocation removes only the revoked row after a fresh reload.

- [ ] **Step 4: Verify GREEN, typecheck, build**
  - Run: `pnpm --filter @tradeos/system-admin test && pnpm --filter @tradeos/system-admin typecheck && pnpm --filter @tradeos/system-admin build`
  - Expected: pass.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin): add account and security workspace`

### Task 3: Tenant 360 read model and lifecycle API

**Files:**
- Modify: `packages/contracts/src/platform-admin.ts`
- Create: `apps/api/src/platform-admin/tenant-service.ts`
- Modify: `apps/api/src/platform-admin/read-service.ts`
- Modify: `apps/api/src/platform-admin/routes.ts`
- Test: `apps/api/test/platform-admin-tenant-management.integration.test.ts`

**Interfaces:**
- Consumes: existing `getAdminTenant`, businesses/branches/staff/memberships/devices/subscriptions/audit tables, authenticated `PlatformAdminContext`.
- Produces: `getTenant360(pool, actor, businessId): Promise<AdminTenant360>`, `changeTenantStatus(pool, actor, businessId, input: { status: "ACTIVE"|"SUSPENDED"; reason: string; expectedUpdatedAt: string }): Promise<AdminTenant360>`.

- [ ] **Step 1: Write failing tenant-management tests**
  - Assert tenant 360 includes business metadata, branches, membership/staff role counts, devices, subscription, entitlement override count, billing summary placeholder fields, and recent platform activity.
  - Assert `OPERATIONS`, `PLATFORM_ADMIN`, and `SUPER_ADMIN` can suspend/reactivate; `SUPPORT`, `BILLING`, `DEVELOPER` cannot mutate tenant lifecycle.
  - Assert blank reason and stale `expectedUpdatedAt` are rejected with typed 400/409 errors.
  - Assert mutation writes before/after status plus reason to audit.

- [ ] **Step 2: Run tests and verify RED**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-tenant-management.integration.test.ts --no-file-parallelism`
  - Expected: FAIL because tenant 360/write API does not exist.

- [ ] **Step 3: Implement tenant service and routes**
  - Add `GET /api/admin/tenants/:id/overview` and `PATCH /api/admin/tenants/:id/status`.
  - Keep the existing `GET /api/admin/tenants/:id` backward-compatible; it may delegate to the richer read model if contract shape remains additive.
  - Use `updated_at` as the initial revision token and return the new value after mutation.

- [ ] **Step 4: Verify GREEN and regression suite**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-tenant-management.integration.test.ts test/platform-admin-read-plane.integration.test.ts --no-file-parallelism && pnpm --filter @tradeos/api typecheck`
  - Expected: pass.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin): add tenant 360 lifecycle service`

### Task 4: Tenant 360 UI

**Files:**
- Modify: `apps/system-admin/app/console/tenants/page.tsx`
- Create: `apps/system-admin/app/console/tenants/[id]/page.tsx`
- Modify: `apps/system-admin/app/components/admin-table.tsx` only if row-link support is missing
- Modify: `apps/system-admin/app/admin-components.css`
- Test: `apps/system-admin/app/components/tenant-360-contract.test.ts`

**Interfaces:**
- Consumes: Task 3 tenant overview/status API.
- Produces: clickable tenant rows and a seven-section Tenant 360 workspace: Overview, Branches & access, Subscription & entitlements, Billing, Devices & sync, Platform activity, AI insights placeholder.

- [ ] **Step 1: Write failing UI contract tests**
  - Assert tenant rows link to `/console/tenants/${id}`.
  - Assert detail page requests `/api/admin/tenants/${id}/overview` and renders status, branches/access, subscription, devices, audit activity, and lifecycle confirmation form with mandatory reason.
  - Assert no support impersonation/tenant workspace embedding is introduced.

- [ ] **Step 2: Run tests and verify RED**
  - Run: `pnpm --filter @tradeos/system-admin exec vitest run app/components/tenant-360-contract.test.ts`

- [ ] **Step 3: Implement responsive Tenant 360**
  - Use progressive disclosure: summary cards + section navigation; identifiers/provider references go in secondary detail blocks.
  - Lifecycle action is a confirmation sheet/dialog-style region with reason and authoritative reload after success.

- [ ] **Step 4: Verify system-admin tests/typecheck/build**
  - Run: `pnpm --filter @tradeos/system-admin test && pnpm --filter @tradeos/system-admin typecheck && pnpm --filter @tradeos/system-admin build`

- [ ] **Step 5: Commit**
  - Commit: `feat(admin): add tenant 360 workspace`

### Task 5: Plan, entitlement, and subscription service/API

**Files:**
- Modify: `packages/contracts/src/platform-admin.ts`
- Create: `apps/api/src/platform-admin/subscription-service.ts`
- Modify: `apps/api/src/platform-admin/routes.ts`
- Test: `apps/api/test/platform-admin-subscriptions.integration.test.ts`

**Interfaces:**
- Produces: `listPlans`, `createPlan`, `updatePlan`, `setPlanEntitlements`, `listSubscriptions`, `transitionSubscription` with request/response contracts. Mutation input includes `reason` and `expectedUpdatedAt` for existing records.
- Routes: `GET/POST /api/admin/plans`, `PATCH /api/admin/plans/:id`, `PUT /api/admin/plans/:id/entitlements`, `GET /api/admin/subscriptions`, `POST /api/admin/tenants/:id/subscription`, `PATCH /api/admin/subscriptions/:id`.

- [ ] **Step 1: Write failing service/API tests**
  - Cover plan money/interval/trial validation, public/active flags, entitlement replacement, initial plan assignment, trial/activate/upgrade/downgrade/pause/reactivate/cancel-at-period-end/resume transitions.
  - Assert `BILLING`, `PLATFORM_ADMIN`, `SUPER_ADMIN` may mutate; `SUPPORT`, `OPERATIONS`, `DEVELOPER` may not.
  - Assert stale writes return 409 and current-subscription uniqueness remains intact.

- [ ] **Step 2: Run RED**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-subscriptions.integration.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement minimal subscription service and routes**
  - Centralize transition validation in `subscription-service.ts`; route handlers only authenticate/parse/send.
  - Price changes update plans only; they never rewrite historical billing records.

- [ ] **Step 4: Verify GREEN/typecheck**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-subscriptions.integration.test.ts --no-file-parallelism && pnpm --filter @tradeos/api typecheck`

- [ ] **Step 5: Commit**
  - Commit: `feat(admin): add plan and subscription management`

### Task 6: Platform SaaS billing ledger, reconciliation, and API

**Files:**
- Create: `packages/db/migrations/0021_platform_billing.sql`
- Modify: `packages/contracts/src/platform-admin.ts`
- Create: `apps/api/src/platform-admin/billing-service.ts`
- Modify: `apps/api/src/platform-admin/routes.ts`
- Test: `apps/api/test/platform-admin-billing.integration.test.ts`

**Interfaces:**
- Produces tables `subscription_invoices`, `subscription_payments`, `subscription_payment_refunds` with statuses from the spec and provider-reference uniqueness/idempotency indexes.
- Produces `listInvoices`, `getInvoice`, `listSubscriptionPayments`, `recordProviderPayment`, `recordProviderRefund`, `reconcilePayment`.
- Routes: `GET /api/admin/billing/invoices`, `GET /api/admin/billing/invoices/:id`, `GET /api/admin/billing/payments`, plus authenticated/admin reconciliation endpoints; provider callback ingress must be separate from cookie-auth routes and protected by an adapter-specific verification boundary.

- [ ] **Step 1: Write failing migration/service tests**
  - Assert invoice totals/amount-paid/state transitions use minor units.
  - Assert duplicate provider transaction reference/event replay is idempotent.
  - Assert refund records append without rewriting original payment amount.
  - Assert tenant operational `payments`/cashbook tables are untouched.
  - Assert billing writes require `BILLING`, `PLATFORM_ADMIN`, or `SUPER_ADMIN` when invoked by administrators.

- [ ] **Step 2: Run RED**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-billing.integration.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement migration and billing service**
  - Add foreign keys/indexes for business/subscription/invoice/provider references.
  - Keep provider verification behind a narrow interface `SubscriptionPaymentProviderAdapter.verifyAndNormalize(request): Promise<NormalizedBillingEvent>` so Hubtel/others can be added without changing ledger rules.

- [ ] **Step 4: Verify migration + API GREEN**
  - Run the repository migration validation command from CI, then `pnpm --filter @tradeos/api exec vitest run test/platform-admin-billing.integration.test.ts --no-file-parallelism && pnpm --filter @tradeos/api typecheck`.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin): add SaaS billing ledger`

### Task 7: Billing, plans, and subscriptions UI

**Files:**
- Modify: `apps/system-admin/app/components/nav.ts`
- Create: `apps/system-admin/app/console/plans/page.tsx`
- Create: `apps/system-admin/app/console/subscriptions/page.tsx`
- Create: `apps/system-admin/app/console/billing/invoices/page.tsx`
- Create: `apps/system-admin/app/console/billing/payments/page.tsx`
- Modify: `apps/system-admin/app/admin-components.css`
- Test: `apps/system-admin/app/components/billing-workspaces-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 5–6 APIs.
- Produces: task-oriented Billing nav group and responsive management workspaces.

- [ ] **Step 1: Write failing UI contract tests**
  - Assert route/nav presence, live endpoint usage, filters, empty/error/loading states, minor-unit display formatting, plan/subscription mutation confirmations, invoice/payment drill-down, and no fake placeholder data.

- [ ] **Step 2: Run RED**
  - Run: `pnpm --filter @tradeos/system-admin exec vitest run app/components/billing-workspaces-contract.test.ts`

- [ ] **Step 3: Implement responsive billing workspaces**
  - Use forms/sheets for mutations, with reason/impact summaries for subscription changes.
  - Keep provider references and raw reconciliation metadata behind expandable detail rather than default tables.

- [ ] **Step 4: Verify full System Admin suite/build**
  - Run: `pnpm --filter @tradeos/system-admin test && pnpm --filter @tradeos/system-admin typecheck && pnpm --filter @tradeos/system-admin build`

- [ ] **Step 5: Commit**
  - Commit: `feat(admin): add billing and subscription workspaces`

### Task 8: Platform administrator lifecycle and RBAC

**Files:**
- Modify: `packages/contracts/src/platform-admin.ts`
- Create: `apps/api/src/platform-admin/admin-user-service.ts`
- Modify: `apps/api/src/platform-admin/routes.ts`
- Create: `apps/system-admin/app/console/admins/page.tsx`
- Modify: `apps/system-admin/app/components/nav.ts`
- Test: `apps/api/test/platform-admin-users.integration.test.ts`
- Test: `apps/system-admin/app/components/admin-users-contract.test.ts`

**Interfaces:**
- Produces: `listPlatformAdmins`, `createPlatformAdmin`, `updatePlatformAdminRole`, `setPlatformAdminActive` and corresponding `/api/admin/admins` routes.

- [ ] **Step 1: Write failing API/UI tests**
  - Assert only `SUPER_ADMIN` can create/deactivate/reactivate/change platform-admin roles.
  - Execute two concurrent attempts to demote/deactivate the last active `SUPER_ADMIN`; assert database locking/invariant leaves one active super admin.
  - Assert deactivating an admin revokes active sessions.
  - Assert UI hides mutations for non-super-admin users but server tests remain authoritative.

- [ ] **Step 2: Run RED**
  - Run API and System Admin targeted test files.

- [ ] **Step 3: Implement service, routes, and UI**
  - Use a transaction with a locked count/select of active `SUPER_ADMIN` rows before destructive role/active changes.
  - Never expose password hashes; initial credential provisioning follows the existing secure provision/reset pattern rather than returning plaintext passwords from list APIs.

- [ ] **Step 4: Verify GREEN plus existing session/provision tests**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-users.integration.test.ts test/platform-admin-session-contract.test.ts test/platform-admin-provision.integration.test.ts --no-file-parallelism && pnpm --filter @tradeos/system-admin test`

- [ ] **Step 5: Commit**
  - Commit: `feat(admin): add platform administrator management`

### Task 9: Live command-center metrics and end-to-end release verification

**Files:**
- Modify: `packages/contracts/src/platform-admin.ts`
- Create: `apps/api/src/platform-admin/metrics-service.ts`
- Modify: `apps/api/src/platform-admin/routes.ts`
- Modify: `apps/system-admin/app/console/page.tsx`
- Test: `apps/api/test/platform-admin-metrics.integration.test.ts`
- Modify: `apps/system-admin/app/components/live-data-contract.test.ts`

**Interfaces:**
- Produces: `getPlatformMetrics(pool, actor): Promise<AdminPlatformMetrics>` and `GET /api/admin/metrics` with active/suspended tenants, subscription status counts, MRR/ARR, open/overdue invoice value, successful/failed collections, device health, and release-health counts.

- [ ] **Step 1: Write failing metric tests**
  - Seed active/trial/past-due subscriptions and invoices/payments; assert MRR/ARR and overdue amounts derive from authoritative minor-unit values and billing intervals.
  - Assert canceled/expired subscriptions do not inflate recurring revenue.
  - Assert dashboard consumes `/api/admin/metrics` and removes placeholder em dashes for connected metrics.

- [ ] **Step 2: Run RED**
  - Run targeted API and UI contract tests.

- [ ] **Step 3: Implement metrics service and dashboard composition**
  - Keep calculations deterministic; no AI interpretation in this plan.

- [ ] **Step 4: Run complete pre-PR verification**
  - Run: `pnpm --filter @tradeos/contracts build && pnpm --filter @tradeos/api test && pnpm --filter @tradeos/api typecheck && pnpm --filter @tradeos/system-admin test && pnpm --filter @tradeos/system-admin typecheck && pnpm --filter @tradeos/system-admin build && git diff --check`
  - Expected: all green.
  - Then use existing Visual QA/CI on authenticated Overview, Tenant 360, Billing, Admin Users, and Profile at desktop/mobile widths.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin): complete v2 core control plane`
