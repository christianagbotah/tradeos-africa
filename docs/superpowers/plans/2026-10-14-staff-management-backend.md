# TradeOS Staff Management Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a secure, auditable business-scoped staff lifecycle that keeps operational staff separate from login identity, supports optional one-time invitations, and preserves owner/tenant invariants.

**Architecture:** Add a shared staff contract and reserved additive migration, then implement lifecycle logic in a focused `staff-service.ts` behind thin Fastify routes in `staff.ts`. Reuse existing `requireBusinessRole`, password hashing, identity normalization, session issuance, PostgreSQL transactions, and business audit patterns; invitation secrets are hash-only at rest and staff/membership changes are transactional.

**Tech Stack:** TypeScript, Fastify, PostgreSQL 18, `pg`, Node `crypto`, Vitest, pnpm monorepo contracts.

**Spec:** `docs/superpowers/specs/2026-10-13-staff-management-design.md`

## Global Constraints

- Backend/API/contracts/database only for this milestone; do not modify `apps/web`, `apps/system-admin`, `apps/desktop`, or `apps/mobile`.
- Canonical business roles are exactly `OWNER`, `ADMIN`, `MANAGER`, `CASHIER`, `SALES`, `INVENTORY`, `ACCOUNTANT`, `STAFF`, `VIEWER`.
- OWNER can manage every role; ADMIN can assign/manage only `MANAGER`, `CASHIER`, `SALES`, `INVENTORY`, `ACCOUNTANT`, `STAFF`, `VIEWER`; MANAGER is read-only; lower roles have no staff-management access.
- Never allow a transaction to remove the last active OWNER membership from a business.
- Staff records and login accounts remain separate; creating staff never creates `app_users` or `business_memberships`.
- Invitation tokens use high entropy; persist only SHA-256 hashes, return the raw token once, expire after 72 hours, and never log/audit raw tokens or token hashes.
- No hard-delete endpoint. Suspension/reactivation preserves historical staff, memberships, audit, financial, inventory, and shift references.
- Phase 1 is business-scoped only; do not imply or add branch-level staff authorization.
- Use `packages/db/migrations/0017_staff_management.sql`; migration `0018_account_business_control.sql` already belongs to Account & Business Control Center.
- Successful lifecycle mutations write `audit_events` in the same transaction with the authenticated staff actor.
- Preserve the approved stable error contract: `BUSINESS_REQUIRED`, `STAFF_INVALID`, `STAFF_NOT_FOUND`, `STAFF_ROLE_FORBIDDEN`, `LAST_OWNER_REQUIRED`, `STAFF_ALREADY_LINKED`, `USER_ALREADY_MEMBER`, `INVITATION_IDENTITY_REQUIRED`, `INVITATION_INVALID`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_USED`, and `INVITATION_IDENTITY_MISMATCH`; invalid/revoked token handling must not reveal secret existence.

## Review Focus

- An invitation that snapshots both email and phone must accept an existing user when either normalized identifier matches, while rejecting a user matching neither.
- A staff record already bound to a non-REMOVED membership must not be silently rebound to a different user, including when the prior membership is SUSPENDED.
- Two concurrent attempts to demote/suspend the last active OWNER must serialize and leave at least one active OWNER.
- Concurrent/replayed invitation acceptance must bind exactly once; same-user replay is idempotent, different-user replay is rejected without leaking secret material.
- Changing role/email/phone while an invitation is pending must revoke that invitation; blank contact updates must not leave an invitability/read-model state that contradicts validation.

---

### Task 1: Shared staff contract and additive schema

**Files:**
- Create: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/auth/authorization.ts`
- Create: `packages/db/migrations/0017_staff_management.sql`
- Create: `apps/api/test/staff-management.integration.test.ts`

**Interfaces:**
- Consumes: existing `DatabasePool`, canonical auth/membership schema, migration ordering through `0018`.
- Produces: `BUSINESS_ROLES`, `BusinessRole`, `StaffDirectoryItem`, `StaffCreateRequest`, `StaffUpdateRequest`, invitation request/metadata/acceptance types; `staff.updated_at`; `staff_invitations`.

- [ ] **Step 1: Write the failing schema/contract test**

Add a first `staff-management.integration.test.ts` case that imports `BUSINESS_ROLES`, asserts the exact nine-role list, then queries PostgreSQL to assert `staff.updated_at` and `staff_invitations` exist with a 72-hour-capable `expires_at`, status constraint, and only one live PENDING invitation per staff member.

- [ ] **Step 2: Run the focused test to verify RED**

Run after building contracts:
`pnpm --filter @tradeos/contracts build && DATABASE_URL=<disposable-db> pnpm --filter @tradeos/api exec vitest run test/staff-management.integration.test.ts --no-file-parallelism`

Expected: FAIL because `@tradeos/contracts` has no staff export and migration `0017_staff_management.sql` has not been applied.

- [ ] **Step 3: Add the shared contract**

In `packages/contracts/src/staff.ts`, define:
- `export const BUSINESS_ROLES = [...] as const`
- `export type BusinessRole = (typeof BUSINESS_ROLES)[number]`
- `StaffMembershipStatus = "ACTIVE" | "SUSPENDED"`
- `StaffInvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"`
- `StaffDirectoryItem` exactly matching the approved read model.
- `StaffCreateRequest` with `businessId`, `displayName`, optional nullable `email`/`phone`, and `role`.
- `StaffUpdateRequest` with `businessId` plus optional `displayName`, `email`, `phone`, `role`.
- `StaffInvitationCreateRequest`, `StaffInvitationMetadata`, `StaffInvitationCreateResponse` with one-time `acceptanceToken`.
- `StaffInvitationAcceptRequest`, `StaffInvitationRegisterRequest`, `StaffInvitationAcceptanceResult`, and registration acceptance response types sufficient for the route responses without exposing hashes.

Export the module from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Make API authorization consume the shared role type**

Replace the local role union in `apps/api/src/auth/authorization.ts` with an import from `@tradeos/contracts`, and re-export `BusinessRole` from the authorization module so existing API files continue compiling without broad churn.

- [ ] **Step 5: Add migration `0017_staff_management.sql`**

Migration must:
- `ALTER TABLE staff ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()`.
- Create `staff_invitations` with the approved columns/FKs/status/role checks and `CHECK (invited_email IS NOT NULL OR invited_phone_e164 IS NOT NULL)`.
- Create a unique index on `token_hash` and a partial unique index on `staff_id` where `status='PENDING'`.
- Add business/staff/status lookup indexes needed by directory/invitation reads.
- Remain additive and transaction-wrapped.

- [ ] **Step 6: Recreate the disposable database and apply all migrations in filename order**

Expected: every migration present, including `0017` then `0018`, applies successfully to a fresh database.

- [ ] **Step 7: Run focused tests/typecheck to verify GREEN**

Run: contracts build/typecheck plus the focused staff test.
Expected: PASS.

- [ ] **Step 8: Commit**

`git commit -m "feat(api): add staff management contracts and schema"`

---

### Task 2: Staff directory, create, update, and role authorization

**Files:**
- Create: `apps/api/src/staff-service.ts`
- Create: `apps/api/src/staff.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/staff-management.integration.test.ts`

**Interfaces:**
- Consumes: shared `BusinessRole`/staff DTOs from Task 1, `requireBusinessRole(...)`, `normalizeEmail`, `normalizePhone`, `withTransaction`.
- Produces: `listStaff`, `createStaff`, `updateStaff`, and HTTP routes `GET /v1/staff`, `POST /v1/staff`, `PATCH /v1/staff/:staffId`.

- [ ] **Step 1: Add RED tests for read/create/update authorization**

Add HTTP integration cases proving:
- OWNER creates/lists/updates any role.
- ADMIN can create/update ordinary roles but cannot assign or alter OWNER/ADMIN.
- MANAGER can list but every mutation returns 403.
- CASHIER/SALES/INVENTORY/ACCOUNTANT/STAFF/VIEWER cannot list or mutate.
- Creating a staff record creates neither `app_users` nor `business_memberships`.
- Cross-business IDs cannot read or mutate staff.
- Staff email/phone are normalized; display name is non-blank; invalid canonical role is rejected.
- Read model exposes linked membership/invitation metadata but no auth or invitation secret fields.

- [ ] **Step 2: Run focused test and verify RED**

Expected: route 404s because `registerStaffRoutes` does not exist.

- [ ] **Step 3: Implement `listStaff(pool, auth, businessId): Promise<StaffDirectoryItem[]>`**

Use OWNER/ADMIN/MANAGER read roles. Join at most one non-REMOVED membership and current PENDING invitation; compute `invitationStatus` as `EXPIRED` when a PENDING row is past `expires_at` without mutating it. Return no token/hash/password/session fields.

- [ ] **Step 4: Implement `createStaff(pool, auth, request): Promise<StaffDirectoryItem>`**

Validate actor via OWNER/ADMIN, require an active actor staff ID, validate display name/contact/role, apply ADMIN assignment restrictions, create only the `staff` row, audit `STAFF_CREATED`, and return the directory item.

- [ ] **Step 5: Implement `updateStaff(pool, auth, staffId, request): Promise<StaffDirectoryItem>`**

Lock the target staff row. Apply actor/target/next-role rules. If role changes and a linked non-REMOVED membership exists, update `staff.role` and membership role atomically. If email/phone/role changes, revoke every PENDING invitation for that staff member in the same transaction and audit `STAFF_INVITATION_REVOKED` plus `STAFF_UPDATED`/`STAFF_ROLE_CHANGED` as applicable. Set `staff.updated_at=now()`.

- [ ] **Step 6: Add the owner-concurrency helper**

Implement a private helper that locks the business row before counting active OWNER memberships joined to active OWNER staff. Call it before a mutation would demote an active OWNER. Reject the last-owner case with `LAST_OWNER_REQUIRED` (409).

- [ ] **Step 7: Wire thin Fastify routes and stable error mapping**

Create `registerStaffRoutes(app, pool)` in `apps/api/src/staff.ts`; authenticate using `authenticateAccessToken`, call service methods, return AuthError codes verbatim, and use one generic `STAFF_MANAGEMENT_FAILED` 500 for unexpected failures. Register it in `apps/api/src/app.ts`.

- [ ] **Step 8: Run focused tests + API typecheck**

Expected: staff list/create/update/authorization tests pass.

- [ ] **Step 9: Commit**

`git commit -m "feat(api): add staff directory and lifecycle updates"`

---

### Task 3: One-time staff invitations and existing-account acceptance

**Files:**
- Modify: `apps/api/src/staff-service.ts`
- Modify: `apps/api/src/staff.ts`
- Modify: `apps/api/test/staff-management.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 staff lifecycle, `tokenHash()` and authenticated `AuthContext`.
- Produces: `createStaffInvitation`, `acceptStaffInvitation`, `POST /v1/staff/:staffId/invitations`, `POST /v1/staff/invitations/accept`.

- [ ] **Step 1: Add RED invitation tests**

Cover:
- OWNER and permitted ADMIN can invite active ordinary staff with email and/or phone.
- ADMIN cannot invite OWNER/ADMIN.
- Staff with no identity is rejected with `INVITATION_IDENTITY_REQUIRED`.
- A staff record already bound to ACTIVE or SUSPENDED non-REMOVED membership is rejected with `STAFF_ALREADY_LINKED` so suspension cannot be used to rebind identity.
- Creating a replacement invitation revokes the old PENDING invitation and returns a different one-time token.
- Persisted row contains only a hash, never the raw token.
- Existing user acceptance matches either normalized email or phone, binds/activates the membership, marks invitation ACCEPTED, and keeps staff/membership role synchronized.
- Identity mismatch, expired, revoked, and already-used tokens return the approved stable codes.
- Same-user replay returns the same accepted access result; different-user replay is rejected.
- Concurrent acceptance cannot bind twice.

- [ ] **Step 2: Run focused test and verify RED**

Expected: invitation endpoints 404.

- [ ] **Step 3: Implement `createStaffInvitation(pool, auth, staffId, request): Promise<StaffInvitationCreateResponse>`**

Inside one transaction: authorize actor, lock target staff, enforce target role and linkage rules, revoke any old PENDING invitation, generate `tos_invite_${randomBytes(32).toString("base64url")}`, store only `tokenHash(rawToken)`, snapshot normalized identity/current role, set `expires_at = now() + interval '72 hours'`, audit `STAFF_INVITED` and any replacement revocation, and return metadata plus the raw token once.

- [ ] **Step 4: Implement `acceptStaffInvitation(pool, auth, request): Promise<StaffInvitationAcceptanceResult>`**

Hash the provided token, lock invitation + target staff, fail closed for invalid/revoked tokens, return 410 for expired tokens, require staff still active/current role equal snapshot, require auth email OR phone to match a snapshotted identity, reject membership bound to another staff or target staff bound to another non-REMOVED user, then create/activate/update the membership and mark invitation accepted in one transaction. Same-user/same-staff accepted replay is idempotent.

- [ ] **Step 5: Extend thin routes**

Add authenticated invite and accept routes; never log request bodies or tokens and never include token hashes in responses/errors/audits.

- [ ] **Step 6: Run invitation tests + API typecheck**

Expected: all invitation/existing-user acceptance cases pass.

- [ ] **Step 7: Commit**

`git commit -m "feat(api): add secure staff invitations"`

---

### Task 4: Invitation registration with normal auth/session machinery

**Files:**
- Modify: `apps/api/src/staff-service.ts`
- Modify: `apps/api/src/staff.ts`
- Modify: `apps/api/test/staff-management.integration.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `assertPlatform`, `issueSession`, invitation lookup/locking from Task 3.
- Produces: `registerFromStaffInvitation` and `POST /v1/staff/invitations/accept/register`.

- [ ] **Step 1: Add RED registration-acceptance tests**

Prove:
- Valid invitation creates exactly one `app_users` row from the snapshotted email/phone, an ACTIVE membership linked to the invited staff, marks invitation ACCEPTED, and returns a normal session.
- Password length, platform, deviceKey, and appVersion use current auth/session validation behavior.
- Existing email or phone returns `ACCOUNT_EXISTS` without consuming the invitation.
- Expired/revoked/identity-changed/role-changed/inactive-staff invitations cannot register.
- Replayed registration acceptance cannot create a second account/session or leak whether a token hash exists.

- [ ] **Step 2: Run focused test and verify RED**

Expected: register-accept endpoint 404.

- [ ] **Step 3: Implement `registerFromStaffInvitation(pool, request)`**

Validate display name/platform; hash the password with `hashPassword`; transactionally lock/revalidate invitation + staff, insert `app_users` using the invitation identity snapshot, create ACTIVE membership bound to staff, mark ACCEPTED, issue session with `issueSession`, and audit `STAFF_INVITATION_ACCEPTED`. Map PostgreSQL identifier uniqueness to `ACCOUNT_EXISTS` while leaving the invitation reusable by the existing account after login.

- [ ] **Step 4: Wire the unauthenticated registration-accept route**

The route accepts only the approved token/displayName/password/platform/deviceKey/appVersion body. It must not accept caller-supplied email, phone, role, business ID, or staff ID.

- [ ] **Step 5: Run focused tests + API typecheck**

Expected: registration acceptance cases pass and normal `/v1/auth/register`/login tests remain green.

- [ ] **Step 6: Commit**

`git commit -m "feat(api): register accounts from staff invitations"`

---

### Task 5: Suspend/reactivate staff and owner safety under concurrency

**Files:**
- Modify: `apps/api/src/staff-service.ts`
- Modify: `apps/api/src/staff.ts`
- Modify: `apps/api/test/staff-management.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 owner-lock helper and Task 3 invitation revocation.
- Produces: `setStaffActive`, `POST /v1/staff/:staffId/suspend`, `POST /v1/staff/:staffId/reactivate`.

- [ ] **Step 1: Add RED lifecycle tests**

Cover:
- OWNER can suspend/reactivate staff and linked membership changes ACTIVE ↔ SUSPENDED atomically.
- ADMIN can do this only for ordinary roles.
- Suspension revokes pending invitations.
- A suspended membership immediately loses business authorization while its global auth session remains valid and other business memberships still work.
- Reactivation restores only a SUSPENDED linked membership and never resurrects REMOVED.
- Last active OWNER cannot be suspended.
- Two concurrent owner demotion/suspend attempts cannot leave zero active owners.
- Audit events are present for suspend/reactivate and contain no token/password material.

- [ ] **Step 2: Run focused test and verify RED**

Expected: lifecycle endpoints 404 or missing behavior.

- [ ] **Step 3: Implement `setStaffActive(pool, auth, staffId, businessId, active): Promise<StaffDirectoryItem>`**

Lock target staff in a transaction, apply OWNER/ADMIN target rules, invoke the serialized owner invariant before suspending an active OWNER, update `staff.is_active`/`updated_at`, update only linked ACTIVE→SUSPENDED or SUSPENDED→ACTIVE membership as appropriate, revoke pending invitation on suspension, and audit `STAFF_SUSPENDED`/`STAFF_REACTIVATED`.

- [ ] **Step 4: Wire suspend/reactivate routes**

Both routes require bearer auth and `{ businessId }`; no role/actor input is accepted from the client.

- [ ] **Step 5: Run the complete staff integration test**

Expected: all 17 required spec scenarios plus Review Focus concurrency/rebinding cases pass.

- [ ] **Step 6: Commit**

`git commit -m "feat(api): add staff access suspension controls"`

---

### Task 6: Whole-backend acceptance, migration proof, and merge readiness

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-10-13-staff-management-design.md` (verification status only)
- Do not mark `docs/frontend-architecture/API-GAP-REGISTER.md` as IMPLEMENTED until the backend milestone is actually merged.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: an exact-head backend release candidate ready for PR/CI.

- [ ] **Step 1: Recreate a clean disposable PostgreSQL database and apply every migration**

Apply migrations in filename order and prove `0017_staff_management.sql` then `0018_account_business_control.sql` coexist on a fresh database.

- [ ] **Step 2: Run staff integration suite on the clean database**

Expected: all staff lifecycle/invitation/authorization/concurrency tests pass.

- [ ] **Step 3: Run API and contract verification**

Run contracts build/typecheck, API typecheck/lint, full API tests, API build.
Expected: all green.

- [ ] **Step 4: Run repository/root gates required by current CI**

Run root typecheck/lint/test/build in the execution model expected by the existing VPS-platform tests; run the VPS-platform tests as an unprivileged user when their root guard applies.

- [ ] **Step 5: Audit the diff**

Verify:
- no frontend app paths changed;
- no raw token/hash/password/session material in logs/audits/test snapshots;
- no browser/client feature is claimed before a real backend contract exists;
- `git diff --check` is clean;
- no migration number collision.

- [ ] **Step 6: Update design verification status and commit**

Record exact test counts and fresh-migration evidence in the staff design doc.
Commit: `docs: record staff backend acceptance`

- [ ] **Step 7: Push PR and require exact-head CI before merge**

PR base: `main`. Merge only if exact-head CI/domain gates are green and head SHA matches the reviewed branch.

- [ ] **Step 8: After merge, update the API gap register and then integrate Settings → Team in a separate frontend milestone**

Change Staff Management to IMPLEMENTED only after the backend merge is on `main`. The frontend milestone must consume these endpoints; it must not duplicate staff backend logic.
