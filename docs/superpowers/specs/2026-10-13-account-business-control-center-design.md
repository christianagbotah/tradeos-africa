# TradeOS Account & Business Control Center Design

## Status
Implemented and acceptance-verified locally on 2026-10-13; pending exact-head CI, Visual QA, and merge.

## Goal
Give every TradeOS user a complete, secure lifecycle after initial signup: manage their personal account and password, create and switch between businesses, create and manage branches, and update business/branch details without compromising accounting history, tenant isolation, or offline durability.

## Product model
One `app_users` identity may hold memberships in multiple independent `businesses`. Each business has one or more `branches`. Business and branch switching changes workspace context; it does not create a new login.

The application shell exposes a compact current-context control. Settings exposes six destinations: My Profile, Security, Business, Branches, Team, Devices. Team consumes the separate staff-management backend once that work lands; this feature must not duplicate staff lifecycle APIs.

## Account profile and security
Users may update display name, email, phone, and avatar URL. Email/phone changes require the current password and reset the corresponding verification timestamp. The account must always retain at least one login identifier. Email and phone uniqueness remains global.

Password change requires the current password and an 8–200 character new password. On success all other auth sessions are revoked by default while the current session remains valid. Users can list active sessions, revoke another session, or revoke all other sessions.

## Business lifecycle
An authenticated user may create another business at any time. Creation atomically creates the business, a `MAIN` branch, an OWNER staff record, an ACTIVE OWNER membership, the current registered device, and a business audit event. The existing first-business onboarding route and the authenticated add-business route must use the same creation service.

OWNER and ADMIN may update business profile fields: name, legal name, business type, email, phone, registration number, tax ID, address, city/region/postal code, country, timezone, logo URL. Base currency may change only before financial/inventory activity exists. Historical financial records are never rewritten.

## Branch lifecycle
OWNER and ADMIN may create branches. Branch codes are unique within a business and are immutable after creation. Branch profile fields include name, phone, email, address, city/region/postal code, and timezone. Branches with history are deactivated/reactivated rather than deleted. The last active branch cannot be deactivated.

## Context switching
`/v1/me` remains the authoritative list of memberships. Switching business loads `/v1/businesses/:businessId/context` before the new session context becomes active. Switching branch is allowed only to an active branch returned by that business context. The last selected business and branch are persisted on the device.

## Offline safety
Offline mutation snapshots must be namespaced by business. Switching businesses must not delete another business's queued or failed mutations, and a queue for business A must never flush while business B is active. Sign-out clears session credentials but preserves business-scoped mutation snapshots so unsynced work is not silently destroyed; the next authenticated user may only see/flush snapshots for businesses they can access.

## Authorization and audit
All business/branch reads and writes use current membership authorization. Cross-business IDs are denied. OWNER/ADMIN may manage business/branch profile lifecycle. Every successful business or branch mutation writes `audit_events` in the same transaction with the authenticated staff actor. Account security events are recorded separately because they are identity-scoped rather than business-scoped.

## Database additions
Reserve migration `0018_account_business_control.sql` because the parallel staff-management work owns `0017_staff_management.sql`.

Add optional account/business/branch profile columns and `account_security_events(user_id,event_type,payload,occurred_at)`. Add branch `updated_at`. Do not hard-delete business, branch, audit, financial, or inventory history.

## Web UX
The avatar opens an account menu with My profile, Security, Settings, and Sign out. The business context area becomes a real business/branch switcher when alternatives exist and includes Add business and, for OWNER/ADMIN, Add branch.

`/settings` is a first-class responsive page with Profile, Security, Business, Branches, Team, Devices sections. Sensitive actions are online-only and use inline confirmation/error states rather than browser alerts/prompts. Mobile uses touch-first sheets/cards; desktop uses a two-column settings navigation/content composition.

## Implementation verification
- A fresh disposable PostgreSQL database accepted every migration currently present in the branch, including reserved account/business migration `0018_account_business_control.sql`, with `0017` intentionally left for the parallel staff-management work.
- Account/security, business/branch lifecycle, and legacy identity/onboarding/catalog real-database integration tests pass 17/17; the complete API integration suite passes 99/99.
- Web typecheck and production build pass, and the complete Web suite passes 1,836/1,836 tests. Settings is included in authenticated Visual QA at 390px, 768px, and 1280px widths.
- Desktop passes 63/63 tests, mobile 50/50, domain 35/35, client-core 16/16, and system-admin 8/8.
- Repository typecheck, lint, and build pass. The VPS deployment-adapter/platform suite passes 35/35 under its intended unprivileged execution model; its root override guard remains intact.
- Final diff audit finds no browser `alert`/`prompt`/`confirm` flows, no staff-backend duplication, no secret-like additions, and no whitespace errors.

## Non-goals
This implementation does not add organization/group companies above businesses, billing/subscription administration, branch-level staff authorization, 2FA, document uploads, or duplicate the separate staff invitation/lifecycle backend.
