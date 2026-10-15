# TradeOS Africa — Frontend API Gap Register

**Reviewed on:** 2026-10-15

Backend capabilities required by TradeOS clients, including a clear distinction between implemented contracts and remaining gaps.

---

## System Admin Gaps

### 1. Platform-Admin Authentication
- **Consumer:** `apps/system-admin`
- **Implemented endpoints:** `POST /api/admin/session/login`, `POST /api/admin/session/refresh`, `GET /api/admin/session/me`, `POST /api/admin/session/logout`
- **Request:** `{ identifier, password, platform, deviceKey }`
- **Response:** `{ adminUser: { id, email, displayName, role, lastLoginAt }, session: { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt } }`
- **Authorization:** independent `platform_users` + `platform_admin_sessions`; tenant `app_users` / merchant access tokens are not accepted.
- **Status:** IMPLEMENTED IN READ PLANE — dedicated platform-admin session boundary, refresh rotation and logout are available. Initial credentials require explicit operator provisioning; no production password is seeded.

### 2. Tenant List + Management
- **Consumer:** `apps/system-admin`
- **Implemented read endpoints:** `GET /api/admin/tenants`, `GET /api/admin/tenants/:id`
- **Read model:** business status, current plan/subscription, branch/device counts, branches, entitlement-override count and last-seen telemetry.
- **Status:** READ IMPLEMENTED — tenant activation/suspension, subscription mutation, support impersonation and other tenant writes remain NOT IMPLEMENTED.

### 3. Platform Audit Log
- **Consumer:** `apps/system-admin`
- **Implemented endpoint:** `GET /api/admin/audit-events`
- **Response:** bounded newest-first reads from `platform_audit_events` with actor/business labels and business-safe stored metadata.
- **Status:** READ IMPLEMENTED — future privileged write operations must append their own audit events when introduced.

### 4. Device + Sync Health
- **Consumer:** `apps/system-admin`
- **Implemented endpoint:** `GET /api/admin/devices`
- **Response:** registered devices, tenant/branch, platform, app version, release channel, status, last-seen, last-sync and derived ONLINE/STALE/UNKNOWN health.
- **Status:** READ IMPLEMENTED — device revoke/retire administration remains NOT IMPLEMENTED.

### 5. Feature Flags
- **Consumer:** `apps/system-admin`
- **Implemented endpoint:** `GET /api/admin/feature-flags`
- **Remaining endpoint:** `PUT /api/admin/feature-flags/:key`
- **Status:** READ IMPLEMENTED — global/tenant-scoped flag state and configuration are visible; flag mutation remains NOT IMPLEMENTED.

### 6. Client Release Management
- **Consumer:** `apps/system-admin`
- **Implemented endpoint:** `GET /api/admin/releases`
- **Remaining endpoint:** `POST /api/admin/releases` plus controlled rollout/withdraw/minimum-version mutation.
- **Response:** platform, version/build, release channel, status, minimum-supported version, rollout percentage, notes and release timestamps.
- **Status:** READ IMPLEMENTED — publishing and mutation remain NOT IMPLEMENTED.

---

## Desktop Gaps

### 7. Native Printer Integration
- **Consumer:** `apps/desktop`
- **Needed:** Tauri plugin for receipt printer (ESC/POS or system print)
- **Status:** Frontend can use `window.print()` as fallback; native integration requires Tauri plugin

### 8. Barcode Scanner
- **Consumer:** `apps/desktop`
- **Needed:** Keyboard wedge support (most scanners work as keyboard input)
- **Status:** No backend needed — frontend handles keyboard input

### 9. Cash Drawer
- **Consumer:** `apps/desktop`
- **Needed:** Tauri plugin for cash drawer kick (RJ11)
- **Status:** Frontend can document requirement; native integration via Tauri

---

## Mobile Gaps

### 10. Push Notifications
- **Consumer:** `apps/mobile`
- **Endpoint needed:** `POST /api/mobile/device/register-push`
- **Status:** NOT IMPLEMENTED — Expo Push Notifications token has nowhere to register

### 11. Biometric Unlock
- **Consumer:** `apps/mobile`
- **Needed:** `expo-local-authentication` + backend support for biometric session
- **Status:** NOT IMPLEMENTED

---

## Cross-App Gaps

### 12. Staff Management
- **Consumer:** `apps/web`, `apps/mobile`
- **Implemented endpoints:**
  - `GET /v1/staff?businessId=:businessId`
  - `POST /v1/staff`
  - `PATCH /v1/staff/:staffId`
  - `POST /v1/staff/:staffId/invitations`
  - `POST /v1/staff/invitations/accept`
  - `POST /v1/staff/invitations/accept/register`
  - `POST /v1/staff/:staffId/suspend`
  - `POST /v1/staff/:staffId/reactivate`
- **Authorization:** OWNER has full staff management; ADMIN manages only non-privileged roles; MANAGER has read-only directory access; lower roles have no Team access. Last-owner protection is transactional and concurrent owner-changing mutations are serialized per business.
- **Invitation security:** 72-hour invitations persist only SHA-256 token hashes; the raw acceptance token is returned once, never audited or browser-persisted, and the public invite page consumes it from a URL fragment then immediately scrubs the fragment.
- **Status:** IMPLEMENTED — Settings → Team & Access now provides staff create/edit, role management, invitation, suspension/reactivation, desktop table/mobile cards, and secure existing/new-account invitation acceptance.

### 13. Business + Branch Settings
- **Consumer:** `apps/web`
- **Implemented endpoints:**
  - `POST /v1/businesses`
  - `PATCH /v1/businesses/:businessId`
  - `GET /v1/businesses/:businessId/context`
  - `POST /v1/businesses/:businessId/branches`
  - `PATCH /v1/businesses/:businessId/branches/:branchId`
  - `POST /v1/businesses/:businessId/branches/:branchId/deactivate`
  - `POST /v1/businesses/:businessId/branches/:branchId/reactivate`
- **Authorization:** any authenticated account may create another business; current-business and branch mutation is OWNER/ADMIN only.
- **Status:** IMPLEMENTED — authoritative business/branch context and lifecycle contracts now back the Settings control center and global context switcher.

### 14. Account Profile + Security Sessions
- **Consumer:** `apps/web`
- **Implemented endpoints:**
  - `PATCH /v1/me`
  - `POST /v1/auth/change-password`
  - `GET /v1/auth/sessions`
  - `DELETE /v1/auth/sessions/:sessionId`
  - `POST /v1/auth/sessions/revoke-others`
- **Status:** IMPLEMENTED — profile identity changes require current-password verification where appropriate; session revocation and identity-scoped security audit events are supported.
- **Remaining device gap:** trusted-device fingerprint/risk administration is not yet exposed as a user lifecycle API. The current Settings → Devices view manages authentication sessions, not a fabricated device-trust system.

### 15. Managed Avatar + Business Logo Media
- **Consumer:** `apps/web`
- **Implemented endpoints:**
  - `POST /v1/me/avatar`
  - `DELETE /v1/me/avatar`
  - `POST /v1/businesses/:businessId/logo`
  - `DELETE /v1/businesses/:businessId/logo`
  - `GET /v1/media/:assetId`
- **Status:** IMPLEMENTED — Settings uses real JPEG/PNG/WebP file pickers with a 5 MiB server-enforced limit, managed immutable reads, OWNER/ADMIN business-logo authorization, safe replacement cleanup and storage outside atomic release directories. Legacy external avatar/logo URLs remain readable until replaced.

### 16. Notifications Center
- **Consumer:** `apps/web`, `apps/mobile`
- **Endpoint needed:** `GET /api/tradeos/v1/notifications`
- **Status:** NOT IMPLEMENTED — no notifications API

---

## Honesty Rule

The frontend will NOT fake these features. Where a backend gap exists:
- The UI shows an honest "not available" state
- OR the feature is omitted entirely
- This document is the authoritative register of what's blocked
