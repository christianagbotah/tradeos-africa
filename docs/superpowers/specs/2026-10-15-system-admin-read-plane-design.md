# TradeOS System Admin Read Plane Design

**Status:** approved by delegated project ownership for implementation
**Date:** 2026-10-15

## Goal

Make the existing `apps/system-admin` console operational without introducing destructive platform mutations. The first slice provides independent platform-admin authentication plus server-authoritative read models for tenants, devices/sync health, platform audit events, client releases, and feature flags.

## Security boundary

System administrators are not tenant users. Platform authentication uses `platform_users` and a dedicated session table; tenant `app_users`, `auth_sessions`, and business memberships are never accepted as platform-admin credentials.

Only active platform users may authenticate. Passwords use the existing scrypt implementation, but hashes are stored only on `platform_users`. Admin access/refresh tokens are random high-entropy secrets and only SHA-256 hashes are persisted. Access tokens are short lived; refresh tokens rotate. Session/device metadata is bounded and never trusted for authorization.

All `/api/admin/*` read endpoints require a valid platform-admin access token. Phase 1 permits all canonical active platform roles to read the console, while later write operations will use narrower role-specific authorization. Support impersonation, tenant mutation, subscription mutation, feature-flag writes, release writes, and user-password administration are out of scope for this read-plane slice.

## Schema

Migration `0020_platform_admin_auth.sql` adds:

- nullable `password_hash` to `platform_users` so existing records remain migration-safe until explicitly provisioned;
- `last_login_at` updates on successful login;
- `platform_admin_sessions` with user, device key, platform, access/refresh token hashes, expiry, last-used/revoked timestamps, and creation timestamp;
- active-token and user indexes.

No default production password is seeded. Initial credentials are provisioned explicitly by an operator/bootstrap script or a trusted one-time DB administration process.

## API

Authentication:

- `POST /api/admin/session/login`
- `POST /api/admin/session/refresh`
- `GET /api/admin/session/me`
- `POST /api/admin/session/logout`

Read plane:

- `GET /api/admin/tenants`
- `GET /api/admin/tenants/:id`
- `GET /api/admin/devices`
- `GET /api/admin/audit-events`
- `GET /api/admin/releases`
- `GET /api/admin/feature-flags`

### Tenant read model

Tenant list is derived from `businesses`, current `business_subscriptions`/`subscription_plans`, active branch/device counts, and latest registered-device activity. It reports authoritative raw statuses rather than inventing marketing labels. Tenant detail includes business identity, branch count/list summary, current subscription, entitlement overrides count, registered-device summary, and latest activity timestamps. No private password/session/token material is returned.

### Device/sync health

Derived from `registered_devices`. Status, platform, app version, branch, release channel, last seen, and last sync are returned. Health is descriptive, not fabricated: stale/unknown is computed from timestamps with documented thresholds and the underlying timestamps remain present.

### Audit events

Reads `platform_audit_events` newest-first with bounded pagination. Payloads are returned only as already-stored business-safe metadata; authentication secrets are never written to this table.

### Releases and feature flags

Phase 1 is read-only. Releases come from `client_releases`. Feature flags return global and tenant-scoped rows from `platform_feature_flags` with business names when applicable.

## System Admin frontend

The existing honest empty states are replaced with authenticated data loaders. A dedicated admin session client owns platform tokens; it does not share TradeOS merchant session storage. Root `/` becomes the platform login when signed out and `/console/*` redirects/guards when no admin session is available.

Console pages keep their existing design system and table composition. Loading, empty, error, unauthorized and expired-session states must be explicit. No fake rows or hard-coded platform metrics.

## Bootstrap

Add a documented operator command/script that accepts platform-admin email, display name, role and password through process environment or interactive operator invocation, hashes the password using the same scrypt helper, and upserts only the intended `platform_users` identity. It must never print the plaintext password or hash.

## Tests

Required coverage:

- migration has no plaintext token/password seed;
- login success/failure/inactive/no-password cases;
- refresh rotation and logout;
- tenant `app_users` token cannot authenticate platform routes;
- tenant list/detail aggregation and missing tenant 404;
- device, audit, release and flag reads;
- no cross-boundary secret fields;
- system-admin UI no longer renders "API pending" for implemented reads;
- signed-out console is guarded;
- full API/system-admin typecheck/test/build plus existing repository gates.

## Follow-up write plane

After this read plane is proven, a separate slice will add carefully authorized tenant status controls, feature flag writes, release management, subscription/entitlement operations and privileged audit events. No write endpoint is smuggled into this milestone.
