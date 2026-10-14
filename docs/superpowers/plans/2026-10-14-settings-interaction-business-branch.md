# Settings Interaction and Business/Branch Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Settings navigation reliable, make Business and Branch editors mutually exclusive and responsive, and give Create Business the same profile fields as Edit Business.

**Architecture:** Keep Settings server-authoritative and online-only for structural changes. Replace independent booleans with explicit editor modes, extract reusable business/branch field groups, extend `POST /v1/businesses` to accept the full business profile plus first-branch name, and move Settings section selection to a query-string route contract with backward-compatible hash handling.

**Tech Stack:** Next.js 16, React 19, TypeScript, Fastify 5, PostgreSQL, Vitest, Playwright Visual QA.

**Spec:** `docs/superpowers/specs/2026-10-14-settings-control-center-v2-design.md`

## Global Constraints

- No browser `alert`, `confirm`, or `prompt`.
- Structural Settings writes require online server verification; offline sales/queues remain untouched.
- Only one Business editor mode and one Branch editor mode may be open at a time.
- Create Business must persist every field available in Edit Business, plus `firstBranchName`.
- Business/branch role authorization remains server-authoritative.
- Existing `/settings#...` links remain backward compatible while canonical navigation uses `?section=` and optional `action=`.
- Preserve 390px, 768px, and 1280px Visual QA coverage.

## Review Focus

- Deep-linking while already on `/settings`: account-menu links must change the visible section immediately.
- Switching from Edit to Add with unsaved local state: the old form must close and never remain rendered behind the new one.
- Create Business with optional profile fields blank: API stores `NULL` consistently and still creates MAIN/OWNER atomically.
- Business country/currency/timezone defaulting: country changes must not produce an unsupported combination.
- Branch editor on narrow screens: identity/actions stay readable and editor fields remain one column without horizontal overflow.

---

### Task 1: Canonical Settings route state

**Files:**
- Modify: `apps/web/app/components/settings/settings-workspace.tsx`
- Modify: `apps/web/app/components/workspace/app-shell.tsx`
- Modify: `apps/web/app/components/settings/settings-workspace.test.ts`

**Interfaces:**
- Produces: `readSettingsLocation(search, hash)` and `writeSettingsLocation(section, action?)` behavior encoded in the component; canonical URLs `/settings?section=<id>[&action=<action>]`.

- [ ] **Step 1: Write failing navigation tests**

Add tests proving `?section=security`, `?section=business&action=create`, and `?section=branches&action=create` are recognized; legacy `#security/#business/#branches` still map correctly; account-menu links use canonical query URLs.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @tradeos/web test -- settings-workspace.test.ts`
Expected: failures for query-state/action behavior.

- [ ] **Step 3: Implement canonical route synchronization**

Use `popstate` plus `hashchange`; section/action changes call `history.replaceState` with query params. Consuming an `action=create` opens that form once and then removes the action parameter so refresh does not repeatedly reopen it.

- [ ] **Step 4: Re-run focused tests**
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "fix(web): make settings navigation reliable"`

---

### Task 2: Mutually exclusive Business editor and complete Create Business fields

**Files:**
- Modify: `apps/web/app/components/settings/settings-workspace.tsx`
- Create: `apps/web/app/components/settings/business-fields.tsx`
- Modify: `apps/web/app/workspace-shell.css`
- Modify: `apps/web/app/components/settings/settings-workspace.test.ts`

**Interfaces:**
- Produces: `BusinessEditorMode = "view" | "edit" | "create"`; reusable business field component accepting `BusinessFormState`, setter, mode, and `includeFirstBranchName`.

- [ ] **Step 1: Write failing UI contract tests**

Assert one mode state replaces `editing` + `creating`; opening create closes edit; opening edit closes create; Create contains legal name, logo slot, email, phone, registration number, Tax ID, address, city, region, postal code, country, currency, timezone, and first branch name; summary renders separate label/value/separator elements.

- [ ] **Step 2: Verify RED**
Run focused Settings tests.

- [ ] **Step 3: Extract shared Business fields and explicit editor mode**

Keep field IDs unique by prefix. Render summary as `label`, `separator` (`:`), `value`. Create and Edit use the same field component; Create alone includes first branch name.

- [ ] **Step 4: Implement summary/editor CSS**

Summary uses grid/flex spacing rather than concatenated inline text. At 420px labels/values wrap without collision. Business forms use two columns where useful and one column at <=768px.

- [ ] **Step 5: Re-run focused tests and Web typecheck**
Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -m "fix(web): unify business settings editors"`

---

### Task 3: Full-profile Create Business API

**Files:**
- Modify: `apps/api/src/business-management-service.ts`
- Modify: `apps/api/src/businesses.ts`
- Modify: `apps/api/test/business-management.integration.test.ts`
- Modify: `packages/contracts/src/*` only if a shared DTO is required by existing conventions.

**Interfaces:**
- Extends `CreateOwnedBusinessRequest` with optional `legalName`, `email`, `phone`, `registrationNumber`, `taxId`, address fields, `logoUrl`, plus `branchName`; response remains `OwnedBusinessResult`.

- [ ] **Step 1: Write failing integration tests**

Prove a signed-in user can create a second business with the full profile in one request, fields round-trip through `/v1/businesses/:id/context`, blank optional values become null, MAIN/OWNER are created atomically, and invalid profile values roll back the whole create.

- [ ] **Step 2: Run targeted API tests and verify RED**

Build contracts first, then run `business-management.integration.test.ts`.

- [ ] **Step 3: Extend validation + insert transaction**

Reuse the same validation helpers used by Edit Business. Persist full business fields during the existing create transaction before branch/staff/membership/device/audit creation.

- [ ] **Step 4: Re-run targeted API tests**
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(api): create businesses with complete profiles"`

---

### Task 4: Branch editor state and layout

**Files:**
- Modify: `apps/web/app/components/settings/settings-workspace.tsx`
- Create: `apps/web/app/components/settings/branch-fields.tsx`
- Modify: `apps/web/app/workspace-shell.css`
- Modify: `apps/web/app/components/settings/settings-workspace.test.ts`

**Interfaces:**
- Produces: `BranchEditorMode = { kind: "view" } | { kind: "create" } | { kind: "edit"; branchId: string }`; reusable one-column branch field flow.

- [ ] **Step 1: Write failing tests**

Prove Add closes Edit, Edit closes Add, only one branch editor exists, selected branch editor renders below its summary header, and edit fields are one column.

- [ ] **Step 2: Verify RED**
Run focused Settings tests.

- [ ] **Step 3: Implement explicit branch mode and extracted fields**

Keep branch identity/status/action header compact; render editor as a full-width sibling block beneath it. Keep Save/Cancel together at the bottom.

- [ ] **Step 4: Implement responsive CSS**

At <=768px, branch header/actions stack cleanly; editor remains a single column; no horizontal overflow at 390px.

- [ ] **Step 5: Re-run focused tests + Web typecheck**
Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -m "fix(web): simplify branch settings editors"`

---

### Task 5: Slice acceptance and Visual QA

**Files:**
- Modify if required: `.github/workflows/visual-qa.yml`
- Modify if required: Settings Visual QA route helper/evidence docs.

- [ ] **Step 1: Run Web tests/typecheck/build**
Expected: all green.

- [ ] **Step 2: Run targeted API + full API tests**
Expected: all green against disposable PostgreSQL.

- [ ] **Step 3: Capture Settings at 390/768/1280**

Verify summary separators, Business create/edit parity, mutually exclusive editors, and branch single-column editor.

- [ ] **Step 4: Diff/security review**

No frontend URL field removal yet (media plan owns that), no unrelated modules, `git diff --check` clean.

- [ ] **Step 5: Commit acceptance evidence/docs if changed**

`git commit -m "test: cover settings interaction parity"`
