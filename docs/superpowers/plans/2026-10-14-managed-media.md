# Managed Avatar and Business Logo Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace typed Avatar/Logo URLs with secure image pickers backed by persistent managed media storage that survives atomic application releases.

**Architecture:** Add a small image-only media service to the API with DB metadata in migration `0019_managed_media.sql` and bytes stored under a configured persistent `MEDIA_STORAGE_ROOT`. Specific avatar/logo endpoints authorize the owner, validate magic bytes + MIME + size, persist a random file, atomically update the owning record, and clean up on failure. Images are served read-only through an unguessable media ID endpoint suitable for `<img src>`.

**Tech Stack:** Fastify 5 multipart plugin, Node fs/promises + crypto, PostgreSQL, Next.js/React file inputs, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-settings-control-center-v2-design.md`

## Global Constraints

- Migration number is `0019`; `0017` belongs to staff and `0018` already belongs to Account Control.
- Accept only JPEG, PNG, and WebP; max 5 MiB.
- Verify image signatures; do not trust filename or client MIME alone.
- Store media outside release directories; production/staging root is environment-configured.
- Never expose filesystem paths or original local filenames.
- No visible Avatar URL or Logo URL text input remains after this slice.
- Replaced/removed files are retired safely and cleanup failures never corrupt DB references.

## Review Focus

- Extension/MIME spoofing: a `.jpg` containing non-image bytes must be rejected.
- Oversized multipart body: fail before persisting a durable file.
- DB failure after file write: compensating cleanup removes the orphan.
- Existing remote URLs from older data: remain renderable/readable until user replaces/removes them.
- Atomic-release deployment: media root is never created inside a release SHA directory.

---

### Task 1: Media schema and storage primitives

**Files:**
- Create: `packages/db/migrations/0019_managed_media.sql`
- Create: `apps/api/src/media/media-storage.ts`
- Create: `apps/api/test/media-storage.test.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- `storeImage(input: { bytes: Buffer; declaredMime: string; purpose: "AVATAR" | "BUSINESS_LOGO" }): Promise<StoredImage>`
- `removeStoredImage(storageName: string): Promise<void>`
- `resolveStoredImage(storageName: string): string`

- [ ] Write RED tests for type sniffing, 5 MiB cap, random storage names, traversal rejection, and cleanup.
- [ ] Add multipart dependency and migration.
- [ ] Implement storage primitives using `MEDIA_STORAGE_ROOT`; no user-provided path components.
- [ ] Run storage tests + API typecheck.
- [ ] Commit `feat(api): add managed image storage`.

---

### Task 2: Avatar/logo upload endpoints

**Files:**
- Create: `apps/api/src/media/routes.ts`
- Create: `apps/api/src/media/media-service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/account-service.ts`
- Modify: `apps/api/src/business-management-service.ts`
- Create: `apps/api/test/managed-media.integration.test.ts`

**Interfaces:**
- `POST /v1/me/avatar`
- `DELETE /v1/me/avatar`
- `POST /v1/businesses/:businessId/logo`
- `DELETE /v1/businesses/:businessId/logo`
- `GET /v1/media/:mediaId`

- [ ] Write RED integration tests for owner authorization, public image read, content headers, replace/remove behavior, old-file retirement, cross-business denial, and DB-failure cleanup.
- [ ] Implement service transactions and audit metadata without raw bytes/paths.
- [ ] Register routes and public read endpoint.
- [ ] Re-run targeted integration tests.
- [ ] Commit `feat(api): add avatar and business logo uploads`.

---

### Task 3: Profile and Business image pickers

**Files:**
- Create: `apps/web/app/components/settings/image-picker.tsx`
- Modify: `apps/web/app/components/settings/settings-workspace.tsx`
- Modify: `apps/web/app/components/settings/business-fields.tsx`
- Modify: `apps/web/app/workspace-shell.css`
- Modify: `apps/web/app/components/settings/settings-workspace.test.ts`

**Interfaces:**
- `ImagePicker` accepts current URL, accept list, upload/remove callbacks, busy state, circular/square presentation.

- [ ] Write RED UI tests requiring `type="file"`, accepted MIME types, preview/replace/remove controls, and absence of visible Avatar URL/Logo URL inputs.
- [ ] Implement upload using `FormData` through authenticated fetch; do not manually set multipart `Content-Type`.
- [ ] Render account avatar in top bar/account menu when present, initials fallback otherwise.
- [ ] Add accessible keyboard/focus/preview CSS.
- [ ] Run Web tests/typecheck/build.
- [ ] Commit `feat(web): add avatar and logo pickers`.

---

### Task 4: Deployment persistence + acceptance

**Files:**
- Modify deployment registry/environment docs only as required; do not commit secrets.
- Update operator docs for `MEDIA_STORAGE_ROOT`.

- [ ] Configure staging media root under `/home/lightworld/shared/tradeos-staging/media` with app-user write permissions and restrictive directory mode.
- [ ] Apply migration `0019` to disposable DB then staging after exact-head deployment.
- [ ] Run upload/read/replace/remove UAT on seeded demo account/business.
- [ ] Verify a second app release does not remove uploaded media.
- [ ] Run full API/Web gates + public health.
- [ ] Commit docs/evidence if changed.
