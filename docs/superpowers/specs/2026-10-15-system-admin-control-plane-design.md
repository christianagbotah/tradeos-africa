# TradeOS System Admin Control Plane Design

**Status:** Proposed for written review  
**Date:** 2026-10-15  
**Scope:** Platform-admin authentication, operator RBAC, tenant control, subscriptions, devices, feature flags, releases, audit, overview metrics, System Admin frontend wiring, and staging deployment.

## 1. Goal

Make `apps/system-admin` a real privileged TradeOS control plane without weakening tenant isolation or fabricating operational data.

The milestone replaces the current honest `pending backend` states in `/console/*` with server-authoritative platform data and actions. Platform operators remain a separate identity class from business users and staff.

The implementation must preserve the current Z.ai-composed System Admin UX and its no-fake-data contract.

## 2. Existing Foundation

Current `main` already provides:

- `apps/system-admin` with `/console`, `/console/tenants`, `/console/devices`, `/console/audit`, `/console/releases`, and `/console/flags`;
- `platform_users` with roles `SUPER_ADMIN`, `PLATFORM_ADMIN`, `DEVELOPER`, `SUPPORT`, `BILLING`, `OPERATIONS`;
- subscription plans, plan entitlements, business subscriptions and business entitlement overrides;
- registered devices with platform, version, channel, status, last-seen and last-sync timestamps;
- client releases with platform, version, channel, rollout and minimum-supported-version metadata;
- global/business feature flags;
- platform audit events;
- tenant `businesses.status` with `ACTIVE`, `SUSPENDED`, `CLOSED`;
- an API gap register that explicitly requires a separate platform-admin boundary.

Staging currently has zero `platform_users`, subscription plans, business subscriptions, releases, feature flags and platform audit events. No legacy operator credentials need migration.

## 3. Architecture Options Considered

### A. Reuse merchant `app_users` + `auth_sessions`

Rejected. This would collapse the tenant/user boundary into the platform-operator boundary, increase privilege-escalation blast radius, and make merchant session bugs relevant to Super Admin access.

### B. Separate platform identity + opaque server session cookie

**Selected.** Keep `platform_users` authoritative, add separate platform session storage, and use a host-only HttpOnly admin cookie on a dedicated admin origin. This gives immediate revocation, no admin token in browser JavaScript storage, independent lockout policy, and clean platform audit attribution.

### C. Separate stateless JWT admin tokens

Rejected for the first milestone. JWTs simplify API statelessness but make immediate revocation and session invalidation weaker and expose privileged bearer material to browser JavaScript if stored client-side.

## 4. Trust Boundary and Origin

The System Admin must run on a dedicated origin, proposed for staging as:

`https://admin.tradeosafrica.lightworldtech.com`

The admin origin is separate from merchant `https://tradeosafrica.lightworldtech.com` so merchant cookies/storage and privileged cookies never share an origin.

The reverse proxy on the admin host routes:

- `/api/admin/*` -> TradeOS API;
- all other paths -> `apps/system-admin`.

The browser therefore makes same-origin admin API requests and no broad CORS policy is required.

The admin app remains `robots: noindex, nofollow` and receives a tighter CSP than the merchant app.

## 5. Platform-Admin Authentication

### 5.1 Database migration

Add `0020_platform_admin_auth.sql`.

Extend `platform_users` with:

- `password_hash text` (nullable only for pre-existing/bootstrap-incomplete rows; such rows cannot log in);
- `failed_login_count integer NOT NULL DEFAULT 0`;
- `locked_until timestamptz`;
- `password_changed_at timestamptz`;
- a case-insensitive unique index on `lower(email)`.

Add `platform_admin_sessions`:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`;
- `platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE`;
- `session_token_hash char(64) NOT NULL UNIQUE`;
- `device_key text NOT NULL`;
- `created_at timestamptz NOT NULL DEFAULT now()`;
- `last_used_at timestamptz NOT NULL DEFAULT now()`;
- `expires_at timestamptz NOT NULL`;
- `revoked_at timestamptz`.

Only a SHA-256 token hash is stored. Raw admin session tokens never enter the database, logs or audit payloads.

### 5.2 Cookie

Successful login sets one opaque session cookie:

`__Host-tradeos_admin_session`

Cookie attributes:

- `HttpOnly`;
- `Secure`;
- `SameSite=Strict`;
- `Path=/`;
- no `Domain` attribute;
- host-only to the dedicated admin origin.

The cookie is never readable from client JavaScript.

### 5.3 Session lifetime

Initial policy:

- 8-hour absolute lifetime;
- 30-minute idle timeout;
- `last_used_at` updated on authenticated use;
- logout/revocation invalidates immediately.

There is no browser refresh token in this milestone. Expired privileged sessions require re-authentication.

### 5.4 Login security

- Platform admin passwords require at least 12 characters.
- Reuse the existing audited scrypt password primitive, not merchant identity/session tables.
- Five failed attempts lock the platform user for 15 minutes.
- Unknown email and wrong password return the same `ADMIN_LOGIN_REJECTED` response.
- Inactive/locked users cannot create sessions.
- Successful login resets failure counters and updates `last_login_at`.
- Login success, logout and lockout events are written to `platform_audit_events` without password/token material.

### 5.5 Mutation origin protection

All browser state-changing `/api/admin/*` requests require an `Origin` matching configured `TRADEOS_ADMIN_ORIGIN` in production. SameSite Strict host-only cookies remain the primary CSRF boundary; the explicit origin check is defense in depth.

## 6. First Super Admin Bootstrap

No platform credential is seeded in SQL and no default password is committed.

Add a one-time operator command such as:

`pnpm --filter @tradeos/api admin:bootstrap`

It:

- works only when no active platform operator exists unless a future explicit recovery mode is introduced;
- prompts for email, display name and password without echoing the password or putting it in command history;
- creates an active `SUPER_ADMIN` using the same password hashing primitive;
- writes `PLATFORM_ADMIN_BOOTSTRAPPED` to the platform audit log;
- never prints password/session material.

Platform-user CRUD UI is out of scope for this milestone.

## 7. Admin Session API

Endpoints:

- `POST /api/admin/session/login`
- `GET /api/admin/session/me`
- `POST /api/admin/session/logout`

Login body:

```ts
{
  email: string;
  password: string;
  deviceKey: string;
}
```

Login/me response:

```ts
{
  adminUser: {
    id: string;
    displayName: string;
    email: string;
    role: PlatformRole;
  };
  session: {
    expiresAt: string;
    idleExpiresAt: string;
  };
}
```

No access token or refresh token is returned to browser JavaScript.

## 8. Platform Role Capabilities

Authorization is server authoritative. Hiding a button in the console is never treated as authorization.

| Capability | SUPER_ADMIN | PLATFORM_ADMIN | DEVELOPER | SUPPORT | BILLING | OPERATIONS |
|---|---:|---:|---:|---:|---:|---:|
| Sign in / overview | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read tenant list/detail | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Suspend/reactivate tenant | ✓ | ✓ | — | — | — | — |
| Read subscriptions/plans | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Change tenant plan/status | ✓ | ✓ | — | — | ✓ | — |
| Read devices | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Revoke/reactivate device | ✓ | ✓ | — | ✓ | — | ✓ |
| Change device release channel | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Read releases | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Create/update releases | ✓ | ✓ | ✓ | — | — | ✓ |
| Read feature flags | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Mutate platform feature flags | ✓ | ✓ | ✓ | — | — | — |
| Mutate tenant entitlement override | ✓ | ✓ | — | — | ✓ | — |
| Read platform audit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`SUPER_ADMIN` and `PLATFORM_ADMIN` are intentionally distinct even though this milestone grants them the same operational control-plane capabilities. Future platform-user administration, credential recovery and security-policy changes remain SUPER_ADMIN-only.

No role receives tenant-user impersonation in this milestone.

## 9. Overview API

`GET /api/admin/overview`

Returns real control-plane metrics only. Missing data is represented explicitly rather than estimated.

Response includes:

- tenant counts by `businesses.status`;
- current subscriptions by status and plan;
- `mrrByCurrency` calculated from `ACTIVE` monthly/annual subscriptions only;
- trials and past-due counts separately;
- device counts by platform/status and recent/stale heartbeat state;
- most recent sync timestamp;
- release counts by platform/channel/status;
- recent privileged audit events;
- active platform session count.

### 9.1 MRR rules

MRR is never summed across currencies into one misleading number.

For each currency:

- `MONTHLY`: include `amount_minor`;
- `ANNUAL`: include `amount_minor / 12` using deterministic integer/minor-unit rounding documented in the service;
- `CUSTOM`: exclude from MRR and report separately as `customBillingSubscriptions`;
- `TRIALING`, `PAST_DUE`, `PAUSED`, `CANCELED`, `EXPIRED`: excluded from active MRR and reported as separate counts.

If multiple currencies exist, the UI displays the per-currency values rather than fabricating an FX conversion.

### 9.2 Device/sync truthfulness

The current schema contains `last_seen_at` and `last_sync_at` but does not contain local offline queue depth.

Therefore the console may report:

- recently seen / stale / never seen;
- last sync time;
- time since last sync;
- active/revoked/retired device state.

It must **not** label a device queue `stuck`, claim queue depth, or calculate average queue lag until clients publish that telemetry. Existing placeholder labels such as `Stuck queues` are replaced with truthful recency metrics.

## 10. Tenant Management

Endpoints:

- `GET /api/admin/tenants`
- `GET /api/admin/tenants/:businessId`
- `POST /api/admin/tenants/:businessId/suspend`
- `POST /api/admin/tenants/:businessId/reactivate`

List supports bounded search/filter/pagination:

- `q` by business name/id;
- `businessStatus`;
- `subscriptionStatus`;
- `planCode`;
- `limit` capped at 100;
- cursor-based continuation.

Tenant list/detail keeps **operational business status** and **billing subscription status** as separate fields; the UI must never collapse trial/past-due/canceled billing states into `businesses.status`.

Tenant detail returns:

- business identity and operational status;
- branch count and branch summary;
- staff count;
- current subscription and plan;
- active entitlement overrides;
- device counts and last-seen summary;
- recent platform audit events for that business.

### 10.1 Operational suspension is not billing suspension

`POST .../suspend` changes `businesses.status` to `SUSPENDED` and writes an audit event. It does **not** silently rewrite `business_subscriptions.status`.

This distinction is required because operational access control and billing lifecycle are different facts.

`reactivate` returns an operationally suspended business to `ACTIVE`. `CLOSED` is not silently reopened by this route.

Every tenant status mutation requires a non-empty operator `reason`.

No hard-delete endpoint is introduced.

## 11. Subscription and Licensing Control

Add `/console/subscriptions`, restoring the screen already described by the frontend architecture inventory.

Endpoints:

- `GET /api/admin/subscription-plans`
- `POST /api/admin/subscription-plans`
- `PATCH /api/admin/subscription-plans/:planId`
- `PUT /api/admin/subscription-plans/:planId/entitlements/:entitlementCode`
- `DELETE /api/admin/subscription-plans/:planId/entitlements/:entitlementCode`
- `GET /api/admin/subscriptions`
- `PUT /api/admin/tenants/:businessId/subscription`
- `PUT /api/admin/tenants/:businessId/entitlements/:entitlementCode`
- `DELETE /api/admin/tenants/:businessId/entitlements/:entitlementCode`

The tenant subscription mutation accepts only explicit fields such as:

```ts
{
  planCode?: string;
  status?: "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED" | "EXPIRED";
  currentPeriodStartsAt?: string | null;
  currentPeriodEndsAt?: string | null;
  trialEndsAt?: string | null;
  reason: string;
}
```

The service preserves a single current subscription under the existing partial unique index and never creates duplicate active rows.

Tenant entitlement overrides remain distinct from platform feature flags. An override records its value, reason, optional expiry and `updated_by_platform_user_id`.

Because staging currently has zero plans, the milestone must include plan-catalog management rather than ship a billing UI with nothing operable.

Plan create/update supports the existing authoritative fields: code, name, description, currency, amount, billing interval, trial days, public/active state. Plan codes are immutable after creation. Deactivation is allowed; hard deletion is not. Plan entitlement mutations use the existing `plan_entitlements` table and require an operator reason/audit event.

Plan catalog mutations are allowed to `SUPER_ADMIN`, `PLATFORM_ADMIN`, and `BILLING`.

## 12. Devices and Sync Recency

Endpoints:

- `GET /api/admin/devices`
- `POST /api/admin/devices/:deviceId/revoke`
- `POST /api/admin/devices/:deviceId/reactivate`
- `PUT /api/admin/devices/:deviceId/release-channel`

Read filters include business, platform, status, release channel and recency.

Device mutation rules:

- no admin endpoint creates arbitrary registered devices;
- revocation sets `status='REVOKED'` and requires a reason;
- reactivation may reactivate a `REVOKED` device but never silently revives `RETIRED`;
- release channel accepts only `STABLE`, `BETA`, `INTERNAL`;
- every mutation writes a platform audit event in the same transaction.

The console shows last seen and last sync explicitly. Queue-depth claims remain out of scope until client telemetry exists.

## 13. Client Release Management

Endpoints:

- `GET /api/admin/releases`
- `POST /api/admin/releases`
- `PATCH /api/admin/releases/:releaseId`

Create/update fields use the existing schema:

- platform;
- version;
- build number;
- release channel;
- status (`DRAFT`, `ROLLOUT`, `ACTIVE`, `WITHDRAWN`);
- minimum supported version;
- rollout percent;
- release notes;
- released timestamp.

Mutation requests require an operator reason even though the reason is stored in `platform_audit_events`, not duplicated on the release row.

The service rejects invalid percentages, unknown platforms/channels, and conflicting `(platform, version, channel)` identities using stable error codes.

This milestone manages release metadata; it does not upload application binaries.

## 14. Feature Flags

Endpoints:

- `GET /api/admin/feature-flags`
- `PUT /api/admin/feature-flags/:code`
- `DELETE /api/admin/feature-flags/:code`

A flag may be global (`businessId=null`) or tenant-scoped (`businessId=<uuid>`), matching the existing unique indexes.

Mutation body includes:

```ts
{
  businessId?: string | null;
  enabled: boolean;
  configuration?: Record<string, unknown>;
  reason: string;
}
```

Delete removes only the addressed scope and requires a reason. Removing a tenant-scoped flag allows the global flag/default behavior to apply again.

Plan entitlements and tenant entitlement overrides are shown separately from runtime feature flags so licensing and rollout behavior are never conflated.

## 15. Platform Audit

`GET /api/admin/audit-events`

Supports:

- event type;
- actor role;
- business id;
- date range;
- bounded text search over safe display fields;
- cursor pagination;
- limit capped at 100.

Every privileged mutation in this milestone writes `platform_audit_events` in the same database transaction as the change.

Audit payloads may contain before/after identifiers, statuses, plan codes, release metadata, flag values and device state, but never:

- raw passwords or password hashes;
- raw admin session tokens or token hashes;
- merchant auth tokens;
- invitation tokens;
- database credentials or environment secrets.

## 16. Stable Error Contract

Admin errors use stable codes, including:

- `ADMIN_AUTH_REQUIRED` — 401
- `ADMIN_LOGIN_REJECTED` — 401
- `ADMIN_SESSION_EXPIRED` — 401
- `ADMIN_ACCOUNT_LOCKED` — 423
- `ADMIN_ROLE_FORBIDDEN` — 403
- `ADMIN_ORIGIN_REJECTED` — 403
- `TENANT_NOT_FOUND` — 404
- `TENANT_STATUS_CONFLICT` — 409
- `SUBSCRIPTION_NOT_FOUND` — 404
- `PLAN_NOT_FOUND` — 404
- `DEVICE_NOT_FOUND` — 404
- `DEVICE_STATUS_CONFLICT` — 409
- `RELEASE_NOT_FOUND` — 404
- `RELEASE_CONFLICT` — 409
- `FEATURE_FLAG_NOT_FOUND` — 404
- `ADMIN_REASON_REQUIRED` — 400
- `ADMIN_REQUEST_INVALID` — 400

Responses never reveal whether an unknown login email exists.

## 17. Backend Structure

Keep platform control-plane code isolated from tenant auth and commerce modules.

Planned structure:

```text
apps/api/src/admin/
├── admin-auth.ts
├── admin-authorization.ts
├── admin-routes.ts
├── overview-service.ts
├── tenant-admin-service.ts
├── subscription-admin-service.ts
├── device-admin-service.ts
├── release-admin-service.ts
├── feature-flag-admin-service.ts
└── platform-audit-service.ts
```

Shared rules:

- thin Fastify routes;
- database transactions in services;
- one centralized platform-role capability map;
- one centralized admin-session authenticator;
- no client-supplied actor id/role is trusted;
- no generic arbitrary SQL/action endpoint;
- tenant/business APIs do not accept platform cookies.

Where password hashing can reuse a proven primitive, extract/reuse the cryptographic helper without sharing merchant session tables or auth context types.

## 18. System Admin Frontend

The current Z.ai `/console/*` composition remains the visual foundation.

Add:

- `/login` with platform-admin credentials and a per-browser device key;
- admin session client/provider;
- authenticated console gate;
- real sign-out;
- server-authoritative role-aware navigation/actions;
- `/console/subscriptions`;
- `/console/tenants/[businessId]` detail view;
- real data loading/error/empty states for overview, tenants, devices, audit, releases and flags;
- mutation forms with explicit reason fields and non-destructive confirmation surfaces.

### 18.1 Browser session handling

The admin app stores no bearer/refresh token in `localStorage`, `sessionStorage`, IndexedDB or JS-readable cookies.

A non-secret generated `deviceKey` may be stored locally so platform sessions can identify the browser installation.

The console verifies the session through `/api/admin/session/me`. The presence of the HttpOnly cookie may be used only as a coarse routing hint; the backend remains authoritative.

### 18.2 Role-aware navigation

The UI hides sections/actions outside the signed-in operator's capability map, but every API route repeats the same authorization server-side.

Examples:

- BILLING sees tenant/subscription controls but not device/release/flag mutation tools;
- SUPPORT sees tenant/device diagnostic data and permitted device controls;
- DEVELOPER sees release/flag tooling but cannot suspend tenants or change billing;
- OPERATIONS sees device/release operations but not plan changes;
- SUPER_ADMIN/PLATFORM_ADMIN see the full milestone surface.

### 18.3 No fake metrics/actions

The existing `no-fake-data` contract remains. Pages transition from honest pending states only when their real endpoint is connected.

No hard-coded tenant/device/release/flag/audit records may be introduced for production UI.

## 19. Dashboard and UI Corrections

The current placeholders use terminology that exceeds available telemetry. During wiring:

- `Stuck queues` becomes a truthful device/sync-recency metric;
- `Avg sync lag` is shown only if it is based on real `last_sync_at` data and clearly defined;
- tenant tables show operational business status and billing subscription status separately;
- MRR renders per currency and never silently converts currencies;
- current frontend plan filters (`starter/growth/scale`) are populated from real plan records rather than hard-coded names;
- release UI uses authoritative `DRAFT`, `ROLLOUT`, `ACTIVE`, `WITHDRAWN` states rather than invented `current/supported/deprecated/blocked` storage states;
- feature-flag UI uses authoritative ON/OFF plus global/tenant scope; it does not claim a `gradual` rollout or `plan` scope because the current flag table does not contain those facts;
- feature-flag rows show code/scope/configuration rather than a fabricated description field;
- operator role labels come from actual `platform_users.role`, not placeholder `Demo session`, compliance aliases, or invented roles.

## 20. Deployment Model

System Admin becomes a separately running Next.js process rather than being bundled into the merchant web process.

Staging target:

- app: `apps/system-admin`;
- PM2/service identity: `tradeos-staging-admin`;
- proposed local port: `3037`;
- run as an unprivileged application identity where supported by the existing TradeOS deployment wrapper;
- public host: `admin.tradeosafrica.lightworldtech.com`;
- `/api/admin/*` reverse-proxied to the existing TradeOS API on its private listener;
- all other routes proxy to System Admin.

The existing atomic release process must build/activate the System Admin app from the same exact Git SHA as the API so frontend/admin API contracts cannot drift during deployment.

The merchant site remains available if the admin UI process is down; conversely the admin UI cannot bypass an unavailable API.

## 21. Security Headers and Logging

The dedicated admin host must use:

- HTTPS only;
- HSTS consistent with the parent deployment policy;
- `frame-ancestors 'none'` / equivalent anti-framing policy;
- restrictive CSP without unsafe remote script sources;
- `Referrer-Policy: no-referrer` or equally restrictive policy;
- `X-Content-Type-Options: nosniff`;
- no indexing.

Admin HTTP logs must not log cookie values, password bodies or raw session material.

Application errors use correlation/request IDs without exposing internal SQL, file paths or secrets to the browser.

## 22. Data and Concurrency Rules

- Tenant status mutation locks the target business row before transition.
- Subscription mutation locks the target tenant/current subscription rows so concurrent plan/status changes cannot create two current subscriptions.
- Device mutation locks the device row before status/channel transition.
- Feature-flag upsert relies on the existing scope-specific unique indexes and is transactionally audited.
- Release create/update preserves `(platform, version, release_channel)` uniqueness.
- Audit write and privileged state change occur in the same database transaction whenever a business table mutation is involved.
- Login failure counters are updated transactionally enough that concurrent failed attempts cannot trivially bypass lockout.

## 23. Testing Strategy

### 23.1 Migration/auth tests

Prove:

- migration `0020` applies after `0019` on a fresh disposable database;
- no raw session token column exists;
- case-insensitive platform-user email uniqueness;
- bootstrap produces the first SUPER_ADMIN without committed credentials;
- unknown email/wrong password produce the same response;
- inactive/passwordless/locked accounts cannot sign in;
- five failures trigger lockout;
- successful login sets the exact secure cookie attributes;
- idle and absolute expiry revoke access;
- logout immediately revokes the server session;
- merchant access tokens/cookies cannot authenticate admin routes and vice versa;
- mutation origin checks fail closed in production mode.

### 23.2 RBAC matrix tests

For every role, cover allowed and forbidden reads/mutations for tenants, subscriptions, devices, releases, flags and audit.

Direct API bypass attempts must fail even when a forbidden UI control is hidden.

### 23.3 Tenant/subscription tests

Cover:

- list/detail isolation and filters;
- operational suspend/reactivate without rewriting billing state;
- CLOSED tenant conflict;
- plan/status changes with one-current-subscription invariant;
- entitlement override create/update/delete;
- per-currency MRR math and CUSTOM exclusion;
- all successful mutations audited with reason/before/after safe metadata.

### 23.4 Device/release/flag tests

Cover:

- truthful heartbeat/sync recency classification;
- revoke/reactivate/release-channel transitions;
- retired-device non-reactivation;
- release uniqueness/status/rollout validation;
- global vs business-scoped feature-flag uniqueness;
- tenant flag deletion falling back to global/default behavior;
- no claim of local queue depth from absent telemetry.

### 23.5 Frontend tests

Cover:

- login and session gate;
- HttpOnly-token architecture contract (no browser token storage);
- role-aware nav/action visibility;
- loading, error and empty states;
- no fake-data contract after wiring;
- reason-required mutation forms;
- real filters populated from server metadata;
- sign-out;
- responsive console at 390/768/1280 widths.

## 24. Visual QA

Add System Admin routes to authenticated/bootstrapped visual QA once a test admin session can be established safely in CI.

Required captures:

- login — mobile and desktop;
- overview — 390/768/1280;
- tenants list + tenant detail — 390/768/1280;
- subscriptions — mobile/desktop;
- devices — mobile/desktop;
- audit — desktop plus narrow scrolling behavior;
- releases — mobile/desktop;
- flags — mobile/desktop.

No screenshot fixture may depend on production operator credentials.

## 25. Deployment/UAT Sequence

1. Merge only after exact-head API, System Admin, root CI and Visual QA gates are green.
2. Apply additive migration `0020` to staging.
3. Extend the exact-SHA staging build/deploy contract to include System Admin.
4. Configure the dedicated admin host and same-origin `/api/admin` reverse proxy.
5. Set `TRADEOS_ADMIN_ORIGIN` and no credential secrets in Git.
6. Bootstrap the first staging SUPER_ADMIN through the interactive server command.
7. Verify login/session/logout and lockout behavior.
8. Verify each role boundary using temporary staging operator identities created through controlled test/bootstrap tooling, not hard-coded migration passwords.
9. Verify overview/tenant/subscription/device/audit/release/flag data against the staging database.
10. Verify merchant web/API remains healthy and admin cookies do not appear on the merchant origin.

## 26. Out of Scope

This milestone does not implement:

- tenant-user/support impersonation;
- arbitrary SQL or shell execution from System Admin;
- platform-user CRUD/recovery UI;
- MFA/passkeys (recommended follow-on after the base session boundary lands);
- payment-provider billing collection or invoice ledger;
- automatic currency conversion for MRR;
- app binary upload/storage;
- local device queue-depth telemetry not currently sent by clients;
- incident-management backend despite the existing overview placeholder;
- hard deletion of tenants, devices, releases or audit history.

## 27. Documentation Closeout

After implementation:

- mark System Admin API gaps §1–§6 IMPLEMENTED where actually delivered;
- update Screen Inventory routes to `/console/*` and add `/login`, `/console/subscriptions`, `/console/tenants/[businessId]`;
- document the platform-role capability matrix;
- document the bootstrap procedure without secrets;
- document the admin-host deployment and rollback procedure;
- explicitly leave push notifications, biometric unlock and other unrelated gaps open.

## 28. Acceptance Criteria

The milestone is complete only when:

1. a platform operator can authenticate on the dedicated admin origin without any JS-readable admin bearer token;
2. tenant merchant identities cannot authenticate admin routes;
3. all six platform roles are server-authorized according to the capability matrix;
4. current Z.ai console pages show real data or honest empty states, never fabricated records;
5. tenant, subscription, device, release and flag mutations are atomic and audited;
6. operational tenant suspension remains separate from billing status;
7. dashboard MRR is truthful per currency and device health uses only available telemetry;
8. exact-head CI/Visual QA pass;
9. staging runs System Admin and API from the same merge SHA;
10. public merchant health remains green after admin deployment.
