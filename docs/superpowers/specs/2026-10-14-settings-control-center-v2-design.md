# TradeOS Settings Control Center V2 Design

**Date:** 2026-10-14
**Status:** IMPLEMENTED on `feat/settings-control-center-v2`; pending merge/deployment verification
**Scope:** Settings UX correction + complete business creation parity + managed image uploads + Team & Access backend/frontend + reliable settings deep links
**Base:** `main` after Account & Business Control Center merge `5772b018`
**Related design:** `docs/superpowers/specs/2026-10-13-staff-management-design.md`

This V2 spec incorporates that approved staff design and extends it with Settings UI, secure invitation preview/acceptance UX, and managed media. The older standalone staff implementation plan is superseded for execution ordering; the staff backend invariants remain binding.

## 1. Outcome

Settings must behave like a finished business-control center rather than a collection of partially independent forms.

A TradeOS user must be able to:

- understand business summary values at a glance;
- edit the current business without seeing an unrelated create form at the same time;
- create a new business with the same business-profile fields available during editing;
- create or edit a branch in a clean, full-width layout without overlapping modes;
- choose an avatar or business logo from the device instead of typing image URLs;
- manage business staff, roles and invitations from **Team & access**;
- open My Profile, Security, Business, Branches, Team & access, or Devices & sessions reliably from the account menu, including when already on `/settings`;
- use the above on phone, tablet and desktop without horizontal overflow or squeezed forms.

Sensitive settings changes remain online/server-authoritative. Existing offline sales, inventory and mutation queues are not changed by this milestone.

## 2. Problems Confirmed in the Current Implementation

The October 14 screenshots and current `main` show these concrete defects:

1. Business summary labels and values visually run together, e.g. `Trading nameCHRISJAY ENTERPRISE`.
2. `NewBusinessFormState` has only name/type/branch/country/currency/timezone, while edit-business exposes the full business profile.
3. Business **Create** and **Edit** are independent booleans, so both forms can be open simultaneously.
4. Branch **Create** and **Edit** are also independent state, so both can remain open.
5. Branch edit is rendered inside a horizontal branch card and becomes squeezed beside the branch identity/actions.
6. Profile avatar and business logo are URL text fields rather than device file pickers.
7. Team & access is only a placeholder summary.
8. Account-menu links such as `/settings#security` do not reliably change the active tab when navigation happens while already on the Settings route.
9. Existing Settings Visual QA proves the page renders, but does not encode the interaction invariants above.

## 3. Architecture Overview

The upgrade has four cooperating units:

1. **Settings navigation and editor state** — one authoritative URL-driven section plus mutually exclusive create/edit modes.
2. **Business and branch forms** — reusable field components with creation/edit parity and mobile-safe layouts.
3. **Managed media** — authenticated image upload/storage/retrieval replacing user-entered avatar/logo URLs.
4. **Team & access** — the approved staff-management backend plus a complete Settings UI and invite-acceptance flow.

These units share contracts but remain independently testable. No browser `alert`, `confirm`, or `prompt` is introduced.

## 4. Settings Route Contract

### 4.1 Canonical route

Settings state uses query parameters rather than relying on hash-change behavior:

- `/settings?section=profile`
- `/settings?section=security`
- `/settings?section=business`
- `/settings?section=branches`
- `/settings?section=team`
- `/settings?section=devices`

Optional action parameters:

- `/settings?section=business&action=create`
- `/settings?section=business&action=edit`
- `/settings?section=branches&action=create`

Unknown section/action values are ignored safely and normalize to the relevant view state.

### 4.2 Backward compatibility

Legacy links `/settings#profile`, `#security`, `#business`, `#branches`, `#team`, `#devices` continue to work during the migration period. On load they normalize into the canonical query-param state without causing a page reload.

### 4.3 Account menu

Account menu links target the canonical query routes. Clicking a settings option while already on `/settings` must change the rendered section immediately.

`Add business` and `Add branch` deep links must both navigate and open the intended form.

## 5. Mutually Exclusive Editor State

### 5.1 Business

Business uses one mode, never two booleans:

```text
VIEW | EDIT | CREATE
```

Rules:

- opening EDIT closes CREATE;
- opening CREATE closes EDIT;
- Cancel returns to VIEW;
- successful save/create returns to VIEW;
- switching Settings section resets transient business editor state;
- switching business resets stale drafts before the next edit.

### 5.2 Branches

Branches use one discriminated mode:

```text
VIEW | CREATE | EDIT(branchId)
```

Rules:

- opening CREATE closes any branch editor;
- editing one branch closes CREATE and any other branch editor;
- Cancel returns to VIEW;
- successful create/edit returns to VIEW;
- switching Settings section or business clears transient branch editor state.

## 6. Summary Presentation

Summary cards use explicit semantic elements:

```text
Label : Value
```

There must be visible spacing on both sides of `:`. The colon is presentation generated by the Summary component so callers do not manually embed punctuation.

Desktop/tablet may use an inline label/value row where it fits. On narrow widths, the value may wrap beneath the label while preserving the separator and readable spacing.

Long values must wrap safely instead of colliding with neighboring cards.

## 7. Business Create/Edit Parity

### 7.1 Shared business profile fields

Both Create Business and Edit Business expose:

- Business/trading name — required
- Legal name
- Business type — required
- Business logo image
- Email
- Phone
- Registration number
- Tax ID
- Address line 1
- Address line 2
- City
- Region
- Postal code
- Country
- Base currency
- Timezone

Create additionally exposes:

- First branch name (default `Main`)

### 7.2 Shared field component

A single reusable `BusinessProfileFields` component renders the common fields so create and edit cannot silently drift apart again.

Creation-only and edit-only behavior is supplied through props rather than duplicating markup.

### 7.3 API creation contract

`POST /v1/businesses` expands from the minimal onboarding shape to accept the full profile atomically:

```ts
interface CreateOwnedBusinessRequest {
  name: string;
  legalName?: string | null;
  businessType: BusinessType;
  email?: string | null;
  phone?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string;
  currencyCode?: string;
  timezone?: string;
  branchName?: string;
}
```

Logo upload is performed after business creation because the logo media asset needs the authoritative business ID. The create UI may let the user choose the logo before submission; the client creates the business, uploads the selected logo, then switches into the new business. If logo upload fails after successful creation, the business remains created and the UI reports a recoverable logo-upload error rather than pretending the business creation failed.

Creation remains atomic for business + MAIN branch + OWNER staff + OWNER membership. Partial business identity fields are written in that same transaction.

### 7.4 Base currency

The existing rule remains: base currency may change before financial/inventory activity and becomes locked once such activity exists.

## 8. Branch Layout

### 8.1 Branch card

A branch card has a compact non-edit header:

- branch icon/name;
- Active/Inactive badge;
- Current badge when applicable;
- branch code, timezone and city;
- actions: Open, Edit, Deactivate/Reactivate as permitted.

### 8.2 Edit layout

When a branch is edited, the form opens **below the branch header as a full-width block**.

The branch edit form uses a single-column field flow at all widths for clarity:

1. Branch name
2. Timezone
3. Email
4. Phone
5. Address line 1
6. Address line 2
7. City
8. Region
9. Postal code
10. Save / Cancel

Branch code remains immutable after creation.

### 8.3 Add branch

Add Branch uses the same field order plus optional Branch code. It appears as its own full-width subpanel and never while an edit form is open.

## 9. Managed Avatar and Logo Uploads

### 9.1 User experience

Profile:

- avatar preview;
- **Choose photo**;
- **Replace photo** after an avatar exists;
- **Remove photo**;
- no visible Avatar URL input.

Business:

- logo preview;
- **Choose logo**;
- **Replace logo**;
- **Remove logo**;
- no visible Logo URL input.

Existing externally hosted avatar/logo URLs remain displayable for backward compatibility until replaced or removed.

### 9.2 Accepted files

Initial managed-image policy:

- JPEG (`image/jpeg`)
- PNG (`image/png`)
- WebP (`image/webp`)
- maximum 5 MiB per file
- filename supplied by the browser is never trusted as the storage key
- MIME type and decoded/image signature must agree; extension alone is insufficient
- SVG is not accepted in this milestone

The UI validates type/size before upload for fast feedback; the server repeats all validation authoritatively.

### 9.3 Storage

Managed media is not stored inside atomic application release directories.

Environment configuration:

```text
MEDIA_STORAGE_ROOT=/home/lightworld/shared/tradeos-staging/media
```

Production uses its own shared path.

Storage keys are server-generated UUID-based names. Paths are never derived directly from user input.

### 9.4 Metadata

Migration `0019_managed_media.sql` adds the implemented `managed_media` table:

- `id uuid primary key`
- `purpose` constrained to `AVATAR`, `BUSINESS_LOGO`
- `owner_user_id uuid null references app_users(id)`
- `business_id uuid null references businesses(id)`
- `created_by_user_id uuid not null references app_users(id)`
- `mime_type` constrained to JPEG, PNG and WebP
- `size_bytes bigint` constrained to 1..5 MiB
- `storage_name text unique not null` using a server-generated random name
- `created_at timestamptz not null default now()`
- `retired_at timestamptz null`

Exactly one owner column is present and must match `purpose`. Partial unique indexes enforce at most one active avatar per account and one active logo per business. File signatures are verified before metadata is committed; a separate persisted SHA column is unnecessary for this milestone because integrity is enforced at ingest and assets are immutable while active.

`app_users.avatar_url` and `businesses.logo_url` remain the presentation fields and point at the managed media URL for active managed assets. This preserves current read contracts.

### 9.5 Endpoints

Authenticated upload endpoints:

- `POST /v1/me/avatar`
- `DELETE /v1/me/avatar`
- `POST /v1/businesses/:businessId/logo`
- `DELETE /v1/businesses/:businessId/logo`

Uploads use `multipart/form-data` with one `file` part.

Avatar changes require only the authenticated account owner.

Business logo changes require current OWNER or ADMIN business access and an active linked staff actor, matching other business-profile mutations.

Read endpoint:

- `GET /v1/media/:assetId`

Only non-sensitive managed image classes in this design are readable from this endpoint. The endpoint resolves metadata to the server-controlled storage path, rejects deleted/unknown assets, applies a safe image `Content-Type`, and prevents path traversal by never accepting a storage path from the request.

### 9.6 Replacement and cleanup

A successful replacement:

1. validates and stores the new file;
2. creates the new metadata row;
3. updates the account/business URL in the same database transaction that marks the prior asset deleted;
4. if the database transaction fails, deletes the newly stored file as compensating cleanup;
5. after commit, removes the old physical file as best-effort cleanup.

A failed upload leaves the current avatar/logo unchanged.

## 10. Team & Access Backend

The backend rules in `2026-10-13-staff-management-design.md` remain authoritative and are incorporated into this Settings milestone.

The backend implementation uses migration `0017_staff_management.sql`. `0018_account_business_control.sql` remains untouched and `0019_managed_media.sql` follows it for managed media.

### 10.1 Roles

- OWNER — full staff lifecycle, invitations and role management, subject to last-owner invariant.
- ADMIN — manage ordinary roles only; cannot create/change/suspend/reactivate OWNER or ADMIN staff, nor grant OWNER/ADMIN.
- MANAGER — read staff directory only.
- Other roles — no staff-management access in this phase.

### 10.2 Staff and login separation

A staff record does not imply a login account.

Staff can exist without TradeOS sign-in access. Access is granted explicitly through an invitation, which binds an app user to the staff record through `business_memberships`.

### 10.3 Staff endpoints

- `GET /v1/staff?businessId=...`
- `POST /v1/staff`
- `PATCH /v1/staff/:staffId`
- `POST /v1/staff/:staffId/invitations`
- `POST /v1/staff/invitations/accept`
- `POST /v1/staff/invitations/accept/register`
- `POST /v1/staff/:staffId/suspend`
- `POST /v1/staff/:staffId/reactivate`

All owner safety, invitation identity, role synchronization, audit and tenant-isolation rules from the approved staff design remain required.

## 11. Team & Access User Experience

### 11.1 Directory

The Team section displays a responsive staff directory with:

- name;
- role;
- email/phone when present;
- staff Active/Suspended state;
- app access state: No access / Invitation pending / Active access / Suspended access;
- invitation expiry where pending;
- role-appropriate actions.

Desktop uses a compact accessible staff table. At 768px and below, the table is replaced by stacked staff cards with the same information and 48px-safe actions.

### 11.2 Filters

The section supports lightweight client-side filters after loading the current directory:

- search by name/email/phone;
- status: All / Active / Suspended / Pending invite;
- role.

No server-side pagination is required in this milestone.

### 11.3 Add staff

OWNER/ADMIN gets **Add staff**.

Fields:

- Display name — required
- Email
- Phone
- Role — required and limited by actor role

Creating staff does not create a login account.

After creation the operator may choose **Invite to TradeOS** if email or phone exists.

### 11.4 Edit staff

Editing uses one full-width inline editor directly beneath the selected staff row/card. No modal or browser dialog is used, and only one staff editor may be open at once.

Editable fields:

- Display name
- Email
- Phone
- Role subject to authorization

Role/contact changes revoke a pending invitation as defined by the backend design.

### 11.5 Invitations

Creating an invitation returns a one-time acceptance token.

The UI converts it into a copyable invite URL:

```text
/invite/team#token=<one-time-token>
```

The token is placed in the URL fragment, not the query string, so it is not sent in the initial HTTP request or Referer header. The invite page reads the fragment once, immediately removes it from the visible URL with `history.replaceState`, and keeps the token only in component memory for the current page lifetime. The raw token is never written to localStorage, sessionStorage, IndexedDB, analytics, logs or audit payloads.

The UI clearly warns that the link is shown once and should be copied/shared securely.

### 11.6 Invitation preview

To make the invite URL usable before authentication, add a non-authenticated, token-aware preview endpoint:

- `POST /v1/staff/invitations/preview`

Body:

```json
{ "acceptanceToken": "secret" }
```

Response may include only:

- business display name;
- staff display name;
- role;
- masked invited identity (for example `a***@example.com` or `+233••••1234`);
- expiry timestamp;
- whether the invitation is still acceptable.

Invalid/revoked/used tokens return the same generic invalid response class and do not reveal token existence details.

### 11.7 Invite acceptance page

Public route: `/invite/team#token=...`

Flow:

1. preview invitation;
2. if currently signed in, offer **Accept invitation**;
3. if not signed in, offer:
   - **Sign in to accept** for an existing account;
   - **Create account & accept** for a new user;
4. sign-in is embedded on the invite page so the token never needs to be persisted or carried to another route;
5. new-account registration is also embedded on the invite page and reuses the normal auth/session machinery;
6. after acceptance, open the invited business through authoritative workspace switching.

Registration acceptance reuses existing password/platform/device/session machinery exactly as the staff backend design requires.

## 12. Team Safety Invariants

The UI must not pretend forbidden actions are available, but backend authorization remains authoritative.

Required invariants:

- last active OWNER cannot be suspended or demoted;
- ADMIN cannot alter OWNER/ADMIN staff;
- staff role and membership role change atomically where membership exists;
- suspended membership immediately loses business authorization;
- a global user session is not revoked merely because one business membership is suspended;
- cross-business staff access is impossible;
- no hard staff deletion;
- invitation token hashes/raw values are never returned after creation or written to logs/audits;
- pending invitation identity/role snapshots are revalidated at acceptance.

## 13. Account Avatar in the Shell

The top-bar/account-menu avatar uses `account.avatarUrl` when present and falls back to initials if absent or image loading fails.

Changing/removing an avatar refreshes workspace account context so the shell updates without a manual page refresh.

## 14. Error and Loading Behavior

Settings mutations remain online-only.

Every panel provides:

- explicit loading state;
- inline success/error feedback;
- controls disabled during the corresponding mutation;
- no browser modal APIs;
- no clearing of user-entered draft data on server failure unless the server action actually succeeded.

A media upload failure does not discard other unsaved profile/business form fields.

A business creation followed by logo-upload failure reports: business created successfully, logo needs retry.

## 15. Responsive Rules

### Desktop

- Settings left navigation + content layout remains two-column.
- Business form may use two field columns.
- Branch editor remains one field column by design.

### <= 768px

- Settings navigation becomes horizontal scroll or compact section selector without truncating labels.
- all business field grids collapse to one column;
- panel header actions wrap below headings;
- branch cards stack actions safely;
- Team list becomes card-first.

### <= 420px

- no horizontal page overflow;
- action buttons either full width or wrap in a predictable vertical stack;
- avatar/logo pickers do not exceed viewport width;
- summary cards use one column;
- field labels/values wrap without collision.

## 16. Accessibility

- every input has a real label;
- file inputs are keyboard-accessible even if visually styled;
- image previews include meaningful alt text or are marked decorative where appropriate;
- tab/section controls expose selected state;
- action buttons preserve 48px touch-target guidance on mobile;
- feedback uses `status` or `alert` appropriately;
- role/status is conveyed in text, not color alone.

## 17. Testing Strategy

### 17.1 Settings interaction tests

Pin:

- summary renders `Label : Value` with structural spacing;
- business CREATE and EDIT are mutually exclusive;
- branch CREATE and EDIT are mutually exclusive;
- switching section clears transient editor state;
- create-business and edit-business share the same profile field list;
- account-menu route changes update active Settings section while already on `/settings`;
- add-business/add-branch deep links open the correct form.

### 17.2 Business API tests

Pin full-profile creation and preservation of business + MAIN + OWNER atomicity.

### 17.3 Media tests

Pin:

- allowed JPEG/PNG/WebP accepted;
- oversized/unsupported/spoofed MIME rejected;
- non-owner cannot replace business logo;
- avatar ownership enforced;
- old media remains active on failed replacement;
- deleted media is not served;
- traversal attempts cannot influence filesystem path;
- externally hosted legacy URLs remain readable until replaced/removed.

### 17.4 Team integration tests

The staff design's complete 17-case matrix remains required, plus:

- invitation preview masks identity;
- invite acceptance route works for existing account;
- invite registration works for new account;
- Settings role/action visibility mirrors backend role constraints;
- Team section reflects pending/accepted/suspended state after refresh.

### 17.5 Visual QA

Settings screenshots at minimum:

- 390px
- 768px
- 1280px

Evidence states:

- Business summary
- Business Edit
- Business Create
- Branch Edit
- Branch Create
- Team directory
- Team Add Staff
- Profile avatar picker

At least one automated interaction assertion must prove add/edit mutual exclusion; screenshots alone are insufficient.

## 18. Release Sequence

1. Settings navigation/state/layout corrections.
2. Full business-create API + shared fields.
3. Managed media backend + avatar/logo pickers.
4. Staff-management backend from the approved staff design.
5. Team & Access frontend + public invite-acceptance page.
6. Full API/Web/package tests and fresh migration proof.
7. Exact-head CI + Visual QA.
8. Staging deployment.
9. Apply additive migrations `0017` and `0019` with schema verification.
10. Live HTTPS UAT using isolated/demo identities only.

No staging mutation occurs before exact-head verification is green.

## 19. Migration Safety

Current migration ownership:

- `0017_staff_management.sql` — Team/staff backend (reserved)
- `0018_account_business_control.sql` — already merged/applied
- `0019_managed_media.sql` — this milestone

Fresh database validation must apply migrations in filename order and prove that `0017`, `0018`, and `0019` coexist.

Because staging already has `0018`, rollout explicitly applies missing `0017` before `0019` and verifies both schema effects before API restart. No destructive migration is permitted.

## 20. Out of Scope

This milestone does not add:

- payroll/HR records;
- branch-level staff authorization;
- email/SMS delivery provider integration for invitations;
- object-storage/CDN migration;
- product/catalog image upload;
- arbitrary document/file storage;
- MFA/SSO;
- staff hard deletion.

The media service is intentionally reusable, but only account avatars and business logos are enabled here.

## 21. Success Criteria

The milestone is complete only when:

- the screenshot defects described in Section 2 are no longer reproducible;
- Create Business has the same profile fields as Edit Business plus First branch name;
- business and branch add/edit modes are mutually exclusive;
- branch editing is full-width and readable on desktop/mobile;
- avatars/logos are selected from device files, not typed URLs;
- Team & access performs real staff/role/invitation/suspension workflows;
- all account-menu Settings destinations work while already on the page;
- backend role/tenant/owner invariants are enforced under integration tests;
- full repo verification passes;
- exact-head CI and Settings Visual QA are green;
- staging migration, health and HTTPS UAT pass without touching unrelated customer data.
