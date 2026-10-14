# TradeOS Africa Staff Management Backend Design

**Date:** 2026-10-13
**Status:** Approved backend sub-design, incorporated into Settings Control Center V2
**Scope:** Backend/API/contracts/database rules for staff management. The earlier frontend-ownership/out-of-scope boundary applied only to this backend sub-design; `2026-10-14-settings-control-center-v2-design.md` now owns the combined Settings + Team frontend delivery while preserving the backend invariants below.

## 1. Goal

Add a secure, auditable business-scoped staff-management backend that lets TradeOS businesses maintain staff records independently from login accounts, optionally invite a staff member to obtain app access, change roles safely, and suspend/reactivate access without destroying historical business records.

## 2. Existing Foundation

TradeOS already has:

- `staff`: business-scoped operational people used by sales, purchases, expenses, shifts, audit events, and other business records.
- `app_users`: global login identities.
- `business_memberships`: the binding from an app user to a business, optional `staff_id`, role, and lifecycle status.
- `requireBusinessRole(...)`: server-side business authorization that accepts only ACTIVE memberships on ACTIVE businesses.
- onboarding that creates the first OWNER staff record and OWNER membership together.
- `audit_events`: append-only business audit records.

The missing capability is the lifecycle for additional staff after onboarding.

## 3. Core Design Decision: Staff and Login Access Are Separate

A staff record does not imply a login account.

A business can create a cashier, salesperson, accountant, manager, inventory clerk, or other employee as a staff record even when that person will never sign into TradeOS. A login is added only when an authorized administrator explicitly invites that staff member.

This avoids fake accounts, shared passwords, placeholder credentials, and accidental identity coupling.

## 4. Roles

The canonical business roles remain:

- `OWNER`
- `ADMIN`
- `MANAGER`
- `CASHIER`
- `SALES`
- `INVENTORY`
- `ACCOUNTANT`
- `STAFF`
- `VIEWER`

The staff-management service will validate `staff.role` against this same role set so operational role and membership role cannot silently drift.

## 5. Authorization Rules

### OWNER

- Read all staff.
- Create staff with any role.
- Update any staff member, including OWNER/ADMIN roles, subject to owner invariants.
- Invite staff to app access.
- Suspend/reactivate staff.
- Promote another staff member to OWNER.

### ADMIN

- Read all staff.
- Create and update non-privileged staff.
- Invite non-privileged staff.
- Suspend/reactivate non-privileged staff.
- May assign only: `MANAGER`, `CASHIER`, `SALES`, `INVENTORY`, `ACCOUNTANT`, `STAFF`, `VIEWER`.
- Cannot create, promote, demote, suspend, reactivate, or otherwise alter an `OWNER` or `ADMIN` staff member.

### MANAGER

- Read the staff directory.
- No staff mutations in phase 1.

### All other roles

- No staff-management access in phase 1.

All authorization remains server authoritative. No client-supplied actor role or actor staff ID is trusted.

## 6. Owner Safety Invariants

The API must never allow a business to lose its last active OWNER.

Before demoting or suspending an OWNER, the service must lock/count active OWNER memberships in the business and reject the mutation if it would leave zero active owners.

OWNER protection is transactional so concurrent owner changes cannot bypass the invariant.

There is no hard-delete endpoint in phase 1. Historical staff records are retained.

## 7. Data Model

### 7.1 Existing `staff`

No destructive rewrite is required. The existing fields remain authoritative:

- `id`
- `business_id`
- `display_name`
- `phone`
- `email`
- `role`
- `is_active`
- `created_at`

A new `updated_at timestamptz NOT NULL DEFAULT now()` column will be added if not already present so optimistic/UI refresh semantics have a stable revision timestamp.

### 7.2 New `staff_invitations`

Add an additive migration with:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE`
- `staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE`
- `invited_email text`
- `invited_phone_e164 text`
- `role text NOT NULL` constrained to the canonical business roles
- `token_hash char(64) NOT NULL UNIQUE`
- `status text NOT NULL` constrained to `PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`
- `expires_at timestamptz NOT NULL`
- `created_by_user_id uuid NOT NULL REFERENCES app_users(id)`
- `created_by_staff_id uuid REFERENCES staff(id)`
- `accepted_by_user_id uuid REFERENCES app_users(id)`
- `accepted_at timestamptz`
- `revoked_at timestamptz`
- `created_at timestamptz NOT NULL DEFAULT now()`

At least one of `invited_email` or `invited_phone_e164` must be present.

Only one live PENDING invitation may exist for a staff member. Creating a new invitation revokes an older pending invitation for that staff member in the same transaction.

Invitation tokens are random high-entropy secrets. Only a SHA-256 hash is persisted. The raw token is returned once on invitation creation because outbound email/SMS delivery is not yet implemented.

Default invitation lifetime: **72 hours**.

## 8. Staff Read Model

`GET /v1/staff?businessId=...`

Returns:

```ts
interface StaffDirectoryItem {
  id: string;
  businessId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: BusinessRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  access: {
    membershipId: string | null;
    userId: string | null;
    membershipStatus: "ACTIVE" | "SUSPENDED" | null;
    invitationId: string | null;
    invitationStatus: "PENDING" | "EXPIRED" | null;
    invitationExpiresAt: string | null;
  };
}
```

The read model must not expose password hashes, auth-session tokens, invitation token hashes, or other secrets.

## 9. API Surface

### 9.1 List staff

`GET /v1/staff?businessId=:businessId`

Allowed roles: OWNER, ADMIN, MANAGER.

### 9.2 Create staff

`POST /v1/staff`

Body:

```json
{
  "businessId": "uuid",
  "displayName": "Ama Mensah",
  "email": "ama@example.com",
  "phone": "+233...",
  "role": "CASHIER"
}
```

Creates only a staff record. It does not create `app_users` or `business_memberships`.

### 9.3 Update staff

`PATCH /v1/staff/:staffId`

Body contains `businessId` and any of:

- `displayName`
- `email`
- `phone`
- `role`

If a staff member already has a membership and the role changes, `staff.role` and `business_memberships.role` are updated atomically.

If identity/contact fields or the staff role change while a PENDING invitation exists, the pending invitation is revoked. A new invitation is required so the invitation identity and role snapshot remain trustworthy.

### 9.4 Create invitation

`POST /v1/staff/:staffId/invitations`

Body:

```json
{ "businessId": "uuid" }
```

Requirements:

- staff must be active;
- staff must have email and/or phone;
- staff must not already be linked to an ACTIVE membership;
- inviter must satisfy OWNER/ADMIN role constraints.

Response includes invitation metadata and a one-time `acceptanceToken`.

### 9.5 Accept invitation with an existing authenticated account

`POST /v1/staff/invitations/accept`

Authorization: Bearer access token.

Body:

```json
{ "acceptanceToken": "secret" }
```

The authenticated user's normalized email or phone must match the invitation identity snapshot. At acceptance time the staff record must still be active and its current role must still equal the invitation role snapshot. Acceptance creates or activates the business membership and binds it to the invited staff record.

If the user is already an ACTIVE member of that business bound to the same staff record, acceptance is idempotently successful. If the user is already bound to another staff record in that business, reject with conflict.

### 9.6 Accept invitation while creating a new account

`POST /v1/staff/invitations/accept/register`

Body:

```json
{
  "acceptanceToken": "secret",
  "displayName": "Ama Mensah",
  "password": "...",
  "platform": "WEB",
  "deviceKey": "...",
  "appVersion": "..."
}
```

The invitation's email/phone identity becomes the new account identifier. At acceptance time the staff record must still be active and its current role must still equal the invitation role snapshot. The endpoint creates `app_users`, activates the membership bound to the invited staff record, marks the invitation ACCEPTED, and issues a normal TradeOS session using the existing session machinery. If an `app_users` record already owns the invited email or phone, registration acceptance rejects with `ACCOUNT_EXISTS` and the user must sign in and use the authenticated acceptance endpoint instead.

It must reuse the existing password hashing, platform validation, device validation, and session issuance code rather than duplicating cryptographic logic.

### 9.7 Suspend staff

`POST /v1/staff/:staffId/suspend`

Body:

```json
{ "businessId": "uuid" }
```

Effects, atomically:

- `staff.is_active=false`
- linked ACTIVE membership becomes `SUSPENDED`
- pending invitations become `REVOKED`
- audit event is written

Global auth sessions are not revoked because an app user may belong to multiple businesses. Existing business authorization immediately denies this business because membership is no longer ACTIVE.

### 9.8 Reactivate staff

`POST /v1/staff/:staffId/reactivate`

Effects, atomically:

- `staff.is_active=true`
- linked SUSPENDED membership becomes `ACTIVE`
- audit event is written

A removed membership is not silently resurrected in phase 1.

## 10. Error Contract

Use stable error codes with HTTP status aligned to existing API conventions. Required codes include:

- `BUSINESS_REQUIRED` — 400
- `STAFF_INVALID` — 400
- `STAFF_NOT_FOUND` — 404
- `STAFF_ROLE_FORBIDDEN` — 403
- `LAST_OWNER_REQUIRED` — 409
- `STAFF_ALREADY_LINKED` — 409
- `USER_ALREADY_MEMBER` — 409
- `INVITATION_IDENTITY_REQUIRED` — 400
- `INVITATION_INVALID` — 400/404 without leaking token existence details
- `INVITATION_EXPIRED` — 410
- `INVITATION_ALREADY_USED` — 409
- `INVITATION_IDENTITY_MISMATCH` — 403

Invitation-token lookup failures must not reveal token hashes or secret material in logs or responses.

## 11. Audit Trail

Every staff lifecycle mutation writes `audit_events` in the same database transaction.

Event types:

- `STAFF_CREATED`
- `STAFF_UPDATED`
- `STAFF_ROLE_CHANGED`
- `STAFF_INVITED`
- `STAFF_INVITATION_ACCEPTED`
- `STAFF_INVITATION_REVOKED`
- `STAFF_SUSPENDED`
- `STAFF_REACTIVATED`

Audit payloads contain only business-safe metadata: affected fields, before/after role/status, invitation ID, and target staff ID. Raw invitation tokens, token hashes, password material, and auth tokens are never audited.

## 12. Contracts Package

Add shared backend/client types under `packages/contracts/src/staff.ts` and export them from `packages/contracts/src/index.ts`.

The contracts will define:

- `BusinessRole`
- staff directory DTOs
- create/update request types
- invitation metadata/response types
- invitation acceptance request/response types

The API authorization layer should import/reuse the shared `BusinessRole` type rather than maintaining a divergent role union.

## 13. Service Structure

Keep route wiring thin.

Planned backend files:

- `apps/api/src/staff.ts` — Fastify route registration and HTTP error mapping.
- `apps/api/src/staff-service.ts` — validation, authorization-sensitive staff lifecycle, transactional invariants, invitation token handling, audit writes.
- `apps/api/test/staff-management.integration.test.ts` — end-to-end API coverage.
- additive DB migration for invitations and staff revision timestamp.

No frontend files are modified in this milestone.

## 14. Idempotency and Concurrency

- Staff creation is not silently idempotent; duplicate people are a business decision, not safely inferable by name/contact.
- Invitation acceptance is idempotent only when the same invitation has already been accepted by the same user and bound to the same staff record.
- Owner-count checks use row locking/transactional protection so concurrent demotion/suspension requests cannot both remove the last owner.
- A pending invitation is consumed exactly once.

## 15. Branch Access — Explicitly Deferred

Phase 1 is business-scoped only.

No `staff_branches` table is introduced yet because current authorization is business-scoped. Claiming branch restriction without enforcing it consistently in POS, inventory, purchases, treasury, reports, operations, and sync would create a false security boundary.

A later branch-access milestone must introduce both the mapping and centralized branch authorization across every branch-sensitive API.

## 16. Out of Scope

This milestone does not implement:

- frontend staff-management screens;
- platform/system-admin identities;
- payroll or HR records;
- shift scheduling changes;
- branch-level staff restrictions;
- email/SMS invitation delivery;
- SSO/MFA/biometric login;
- hard deletion of staff or memberships;
- organization-level groups/teams.

## 17. Required Test Matrix

Integration coverage must prove at minimum:

1. OWNER can create/list/update/invite/suspend/reactivate staff.
2. ADMIN can manage ordinary roles but cannot manage OWNER/ADMIN or grant OWNER/ADMIN.
3. MANAGER can list but cannot mutate.
4. Lower roles cannot access staff management.
5. Creating a staff record does not create an app user or membership.
6. Existing-user invitation acceptance binds the correct staff and membership.
7. New-user invitation registration creates the account, membership, and session correctly.
8. Invitation identity mismatch is rejected.
9. Expired/revoked/used invitations cannot be reused.
10. A role or invited-identity change revokes the pending invitation, and acceptance re-checks active staff/current role.
11. New-user invitation registration rejects an identifier that already belongs to an existing account.
12. Suspended staff lose business access immediately while retaining global session validity for other businesses.
13. Reactivation restores only a SUSPENDED membership.
14. Last active OWNER cannot be demoted or suspended.
15. Role change keeps staff and membership roles synchronized.
16. Every successful mutation produces the expected audit event without secrets.
17. No cross-business staff access or mutation is possible.

## 18. Documentation Update

Update `docs/frontend-architecture/API-GAP-REGISTER.md` so Staff Management reflects the real API convention (`/v1/staff`) and moves from NOT IMPLEMENTED to IMPLEMENTED only after the backend milestone is merged.

## 19. Release Gate

The milestone is mergeable only when all of the following pass on the exact head SHA:

- database migrations from a fresh PostgreSQL instance;
- API typecheck/lint;
- staff-management integration tests;
- full existing API test suite;
- API build;
- root CI/domain gate;
- no files changed in Z.ai-owned frontend applications.
