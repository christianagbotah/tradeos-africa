# Team and Access End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Settings → Team & Access into a complete business staff/access management experience with secure invitation acceptance for existing and new TradeOS accounts.

**Architecture:** Implement the already-approved staff-management backend first using migration `0017_staff_management.sql`, shared contracts, thin Fastify routes, and a transactional service. Then connect Settings to the new endpoints with role-aware staff directory/cards, one inline editor, invitation controls, suspend/reactivate actions, and a public invite-acceptance page whose secret lives only in a URL fragment and component memory.

**Tech Stack:** PostgreSQL, Fastify 5, Node crypto, TypeScript contracts, Next.js 16, React 19, Vitest, Playwright Visual QA.

**Spec:** `docs/superpowers/specs/2026-10-14-settings-control-center-v2-design.md` and `docs/superpowers/specs/2026-10-13-staff-management-design.md`

## Global Constraints

- Staff records and login accounts are separate concepts.
- OWNER has full staff management; ADMIN cannot manage/grant OWNER or ADMIN; MANAGER is read-only; lower roles have no Team access.
- Never allow the business to lose its last active OWNER; enforce transactionally under concurrency.
- Invitation lifetime is 72 hours; only SHA-256 token hashes are stored.
- Raw invitation tokens never enter DB logs, audit events, browser storage, query strings, analytics, or referrer-visible URLs.
- Suspension affects only the membership for that business; global sessions remain valid for other businesses.
- No branch-level staff authorization in this milestone.

## Review Focus

- Two concurrent last-owner demotion/suspension attempts: at least one must fail with `LAST_OWNER_REQUIRED`.
- Existing user already bound to another staff row in the business: invitation acceptance must fail without rebinding history.
- Staff contact/role edited after invitation: pending invitation is revoked and old token becomes unusable.
- Invite page refresh after fragment is scrubbed: do not recover or persist the secret; show a safe “link no longer available in this tab” state.
- ADMIN attempting to alter OWNER/ADMIN through any endpoint: server rejects even if client UI is bypassed.

---

### Task 1: Shared contracts and staff schema

**Files:**
- Create: `packages/db/migrations/0017_staff_management.sql`
- Create: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/src/index.ts`
- Create/modify contract tests as needed.

- [ ] Write RED migration/contract tests for `updated_at`, `staff_invitations`, role/status constraints, one live pending invitation per staff, and no raw token column.
- [ ] Implement migration + DTO types.
- [ ] Build/typecheck contracts and apply all migrations fresh in filename order, proving `0017`, `0018`, `0019` coexist.
- [ ] Commit `feat(db): add staff access schema`.

---

### Task 2: Staff directory/create/update authorization

**Files:**
- Create: `apps/api/src/staff/staff-service.ts`
- Create: `apps/api/src/staff/routes.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/staff-management.integration.test.ts`

**Interfaces:**
- `GET /v1/staff?businessId=`
- `POST /v1/staff`
- `PATCH /v1/staff/:staffId`

- [ ] Write RED role/tenant tests for OWNER/ADMIN/MANAGER/lower roles and cross-business denial.
- [ ] Implement read model + create/update; synchronize membership role atomically when linked.
- [ ] Revoke pending invite when contact or role changes.
- [ ] Audit only safe before/after metadata.
- [ ] Run targeted tests and commit `feat(api): add staff directory management`.

---

### Task 3: Invitation creation and existing-account acceptance

**Files:** same service/routes/test files.

**Interfaces:**
- `POST /v1/staff/:staffId/invitations`
- `POST /v1/staff/invitations/accept`

- [ ] Write RED tests for 72-hour expiry, token hashing, previous-pending revocation, identity match, idempotent same-user acceptance, already-linked conflicts, stale role/contact, and token non-leakage.
- [ ] Implement high-entropy token creation + SHA-256 lookup and transactionally bind membership.
- [ ] Run tests and commit `feat(api): add staff invitations`.

---

### Task 4: New-account invitation registration

**Interfaces:**
- `POST /v1/staff/invitations/accept/register`

- [ ] Write RED tests for new-account creation, normal password/platform/device/session validation, duplicate identifier -> `ACCOUNT_EXISTS`, and no duplicated crypto/session logic.
- [ ] Reuse `hashPassword`, `assertPlatform`, and `issueSession` in one transaction.
- [ ] Run tests and commit `feat(api): add invited account registration`.

---

### Task 5: Suspend/reactivate and last-owner safety

**Interfaces:**
- `POST /v1/staff/:staffId/suspend`
- `POST /v1/staff/:staffId/reactivate`

- [ ] Write RED tests for membership synchronization, pending-invite revocation, global-session preservation, OWNER/ADMIN restrictions, reactivation rules, last-owner protection, and concurrent owner changes.
- [ ] Implement locking/invariants and audits.
- [ ] Run targeted + full API suite and commit `feat(api): add staff access suspension controls`.

---

### Task 6: Settings Team & Access UX

**Files:**
- Create: `apps/web/app/components/settings/team-access.tsx`
- Create: `apps/web/app/components/settings/staff-editor.tsx`
- Modify: `apps/web/app/components/settings/settings-workspace.tsx`
- Modify: `apps/web/app/workspace-shell.css`
- Modify: `apps/web/app/components/settings/settings-workspace.test.ts`

- [ ] Write RED UI contract tests for loading/error/empty states, OWNER/ADMIN/MANAGER behavior, desktop table/mobile cards, one inline editor, invite/pending/suspend/reactivate controls, and no fake controls for forbidden roles.
- [ ] Implement fetch/actions against staff API, explicit local modes, non-destructive feedback, and accessible action menus/buttons.
- [ ] At <=768px use stacked cards; desktop uses compact table.
- [ ] Run Web tests/typecheck/build and commit `feat(web): implement team access settings`.

---

### Task 7: Invite acceptance page

**Files:**
- Create: `apps/web/app/invite/team/page.tsx`
- Create: `apps/web/app/components/settings/team-invite-acceptance.tsx`
- Add tests.

- [ ] Write RED tests for fragment-only token intake, immediate `history.replaceState` scrub, no browser storage, existing-account acceptance path, new-account registration path, and safe missing-token state.
- [ ] Implement page without logging or persisting token.
- [ ] Run Web tests/typecheck/build and commit `feat(web): add secure team invite acceptance`.

---

### Task 8: End-to-end acceptance and deployment

- [ ] Recreate disposable DB and apply all migrations in order.
- [ ] Run staff integration suite, full API suite/build/typecheck/lint, full Web suite/build/typecheck, and root gates in the correct execution identity.
- [ ] Capture Settings Team at 390/768/1280 and invite page at mobile/desktop widths.
- [ ] Diff/security audit for raw token/hash/password/session leakage and cross-tenant paths.
- [ ] Push PR; merge only on exact-head CI/Visual QA green.
- [ ] Deploy exact merge SHA, apply pending additive migrations, restart API safely, run public HTTPS UAT with seeded demo identities.
- [ ] After merge, mark Staff Management IMPLEMENTED in `docs/frontend-architecture/API-GAP-REGISTER.md`.
