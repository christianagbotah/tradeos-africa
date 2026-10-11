# TradeOS Africa — Frontend API Gap Register

**Branch:** `feat/zai-all-frontends-greenfield`
**Date:** 2026-01-11

Backend capabilities the frontend needs that do NOT currently exist in `apps/api`.

---

## System Admin Gaps

### 1. Platform-Admin Authentication
- **Consumer:** `apps/system-admin`
- **Endpoint needed:** `POST /api/admin/session/login`, `GET /api/admin/session/me`
- **Request:** `{ identifier, password, platform, deviceKey }`
- **Response:** `{ adminUser: { id, displayName, role }, session: { accessToken, refreshToken } }`
- **Authorization:** Platform-admin only (separate from tenant auth)
- **Status:** NOT IMPLEMENTED — system-admin cannot authenticate

### 2. Tenant List + Management
- **Consumer:** `apps/system-admin`
- **Endpoint needed:** `GET /api/admin/tenants`, `GET /api/admin/tenants/:id`
- **Response:** tenant list with status, plan, branch count, device count, last-seen
- **Status:** NOT IMPLEMENTED

### 3. Platform Audit Log
- **Consumer:** `apps/system-admin`
- **Endpoint needed:** `GET /api/admin/audit-events`
- **Response:** privileged action log (impersonation, config changes, support access)
- **Status:** NOT IMPLEMENTED

### 4. Device + Sync Health
- **Consumer:** `apps/system-admin`
- **Endpoint needed:** `GET /api/admin/devices`
- **Response:** registered devices, last-seen, queue health, sync status
- **Status:** NOT IMPLEMENTED

### 5. Feature Flags
- **Consumer:** `apps/system-admin`
- **Endpoint needed:** `GET /api/admin/feature-flags`, `PUT /api/admin/feature-flags/:key`
- **Status:** NOT IMPLEMENTED

### 6. Client Release Management
- **Consumer:** `apps/system-admin`
- **Endpoint needed:** `GET /api/admin/releases`, `POST /api/admin/releases`
- **Response:** version tracking, minimum-supported builds
- **Status:** NOT IMPLEMENTED

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
- **Endpoint needed:** `GET /api/tradeos/v1/staff`, `POST /api/tradeos/v1/staff`
- **Status:** NOT IMPLEMENTED — no staff CRUD API

### 13. Business Settings
- **Consumer:** `apps/web`
- **Endpoint needed:** `GET /api/tradeos/v1/businesses/:id/settings`
- **Status:** NOT IMPLEMENTED — no settings API

### 14. Notifications Center
- **Consumer:** `apps/web`, `apps/mobile`
- **Endpoint needed:** `GET /api/tradeos/v1/notifications`
- **Status:** NOT IMPLEMENTED — no notifications API

---

## Honesty Rule

The frontend will NOT fake these features. Where a backend gap exists:
- The UI shows an honest "not available" state
- OR the feature is omitted entirely
- This document is the authoritative register of what's blocked
