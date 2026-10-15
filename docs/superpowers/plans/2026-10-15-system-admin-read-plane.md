# TradeOS System Admin Read Plane Implementation Plan

**Goal:** make `apps/system-admin` a real authenticated read-only operations console backed by the existing platform-control schema.

## Task 1 — Platform admin auth schema and contracts

- Add `0020_platform_admin_auth.sql` with `platform_users.password_hash` and `platform_admin_sessions`.
- Add shared platform-admin DTO/contracts.
- Add RED schema/contract tests, then implement.
- Prove fresh migration order through 0020.

## Task 2 — Platform authentication service

- Add admin password/session service reusing the existing scrypt/token helpers where safe without accepting tenant sessions.
- Implement login, refresh, me and logout routes under `/api/admin/session/*`.
- Add integration tests for success, bad password, inactive/no-password users, refresh rotation, logout, and rejection of tenant access tokens.

## Task 3 — Tenant read model

- Implement `GET /api/admin/tenants` and `GET /api/admin/tenants/:id`.
- Aggregate business status, current plan/subscription, branch/device counts and last activity.
- Add search/status filters and bounded pagination where appropriate.
- Test aggregation, empty state and tenant-not-found behavior.

## Task 4 — Operational read endpoints

- Implement authenticated read endpoints for devices, audit events, releases and feature flags.
- Use bounded query limits and stable response contracts.
- Add tests proving no auth/session/password/token secret fields leak.

## Task 5 — Bootstrap provisioner

- Add an explicit operator-only script for provisioning/updating one platform administrator password.
- Never seed or print plaintext credentials.
- Add tests for role validation and safe output.

## Task 6 — System Admin session client and login

- Add a platform-admin session store/client separate from merchant TradeOS sessions.
- Turn `/` into login when signed out.
- Guard `/console/*`; refresh platform session once on expired access token.
- Add contract tests for storage key separation and no merchant token reuse.

## Task 7 — Connect console pages

- Replace API-pending banners/zero rows in tenants, devices, audit, releases and flags with real authenticated loaders.
- Preserve loading/error/empty states and current responsive design.
- Keep this slice read-only; remove/disable any misleading mutation control.

## Task 8 — Acceptance

- Run API and system-admin typecheck/tests/build.
- Run full repository CI-relevant suites.
- Update `API-GAP-REGISTER.md` items 1–6 to distinguish implemented read plane from remaining write plane.
- Push PR, require exact-head CI/Visual QA where applicable, merge only if green.
- Do not redeploy TradeOS merchant staging solely for system-admin work unless the API release is required and migrations/environment bootstrap are prepared.
