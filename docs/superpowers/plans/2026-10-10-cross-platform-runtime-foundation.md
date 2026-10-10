# Cross-Platform Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TradeOS mobile and desktop clients one tested, storage-agnostic offline mutation runtime that preserves the web/API idempotency and sync semantics without duplicating business rules.

**Architecture:** `@tradeos/client-core` will consume the canonical sync types from `@tradeos/contracts` and expose a small queue runtime around a portable snapshot-storage adapter. The runtime owns readiness filtering, active-business isolation, batching, single-flight sync, APPLIED/RECEIVED/REJECTED handling, retry/dismiss behavior, and safe replay after transport/storage failures; platform apps will provide durable storage adapters in later plans.

**Tech Stack:** TypeScript 5.9, Vitest 3.2.4, pnpm workspaces, existing `@tradeos/contracts` sync contract.

**Spec:** GitHub Issue #8 (`Codex assist: review cross-platform clients and SaaS control plane`) plus `packages/contracts/src/sync.ts` and the proven behavior in `apps/web/app/lib/offline-sync.ts`.

## Global Constraints

- Preserve the existing `/v1/sync` / `/api/sync` request and response contract.
- Preserve server idempotency identity `(businessId, clientId, clientMutationId)`.
- Maximum push batch remains 100 mutations.
- A transport failure must never delete or reject queued mutations locally.
- `RECEIVED` and missing mutation results remain pending for later replay.
- `APPLIED` mutations leave the pending queue.
- `REJECTED` mutations leave pending and enter the failed list with the full server result.
- Only the active business may be flushed; another tenant's queued mutations remain untouched.
- Master-data mutation types that are already branch-optional on web remain branch-optional; economic mutations require a valid branch UUID.
- No web/API/accounting/inventory/permission behavior changes in this slice.
- Mobile, desktop, and System Admin production UI work are separate follow-on plans.

## Review Focus

- Tenant switching with pending mutations: only active-business entries may be transmitted; all others must survive unchanged.
- Partial server responses: missing and `RECEIVED` results must remain pending rather than being silently dropped.
- Network/server failure after queue read: the durable snapshot must remain unchanged for idempotent replay.
- Local persistence failure after the server applies a mutation: the old pending snapshot may survive, and replay must be safe because IDs remain stable.
- Concurrent flush calls: one instance must perform one transport push, not duplicate the same batch concurrently.

---

### Task 1: Canonical sync types and readiness policy

**Files:**
- Modify: `packages/client-core/package.json`
- Create: `packages/client-core/src/sync-runtime.ts`
- Create: `packages/client-core/src/sync-runtime.test.ts`
- Modify: `packages/client-core/src/index.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `ClientMutation`, `MutationResult`, `SyncResponse`, `SyncPushRequest` from `@tradeos/contracts`.
- Produces: `QueuedMutation`, `FailedMutation`, `isMutationServerReady(mutation)`, `MAX_SYNC_BATCH_SIZE`.

- [x] **Step 1: Write failing readiness-policy tests**

Add tests asserting: valid business UUID + branch-optional `CATALOG_ITEM_CREATE` is ready without a branch; economic `SALE_CREATE` requires a valid branch UUID; invalid business UUID is blocked; invalid branch UUID is blocked.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @tradeos/client-core test -- sync-runtime.test.ts`
Expected: FAIL because the client-core test runner/runtime exports do not exist yet.

- [x] **Step 3: Add the canonical contract dependency and minimal readiness implementation**

Add `@tradeos/contracts: workspace:*` and Vitest to `packages/client-core/package.json`; change `test` to `vitest run`. In `sync-runtime.ts`, export type aliases backed by the contract types, `MAX_SYNC_BATCH_SIZE = 100`, and `isMutationServerReady(...)` with the same branch-optional mutation set currently used by web.

- [x] **Step 4: Export the runtime and verify GREEN**

Run: `pnpm --filter @tradeos/client-core test -- sync-runtime.test.ts`
Expected: PASS.

- [x] **Step 5: Run client-core typecheck**

Run: `pnpm --filter @tradeos/client-core typecheck`
Expected: PASS.

### Task 2: Portable queue snapshot storage and queue lifecycle

**Files:**
- Modify: `packages/client-core/src/sync-runtime.ts`
- Modify: `packages/client-core/src/sync-runtime.test.ts`

**Interfaces:**
- Consumes: `QueuedMutation`, `FailedMutation`, readiness policy from Task 1.
- Produces: `QueueSnapshot`, `QueueSnapshotStorage`, `QueueRuntimeOptions`, `OfflineMutationQueue` with `enqueue`, `getSnapshot`, `getState`, `retryFailed`, and `dismissFailed`.

- [x] **Step 1: Write failing queue-lifecycle tests**

Tests must pin: enqueue deduplicates by `clientMutationId`; snapshots are defensively copied; queue state counts pending/blocked/failed against an active business; retry replaces a failed mutation with a new injected ID and injected timestamp while preserving business/branch/type/payload; dismiss removes only the requested failed entry.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @tradeos/client-core test -- sync-runtime.test.ts`
Expected: FAIL because `OfflineMutationQueue` and storage contracts are missing.

- [x] **Step 3: Implement the minimal storage abstraction and queue lifecycle**

Use one portable snapshot `{ pending, failed }`; `QueueSnapshotStorage.load(): Promise<QueueSnapshot | null>` and `save(snapshot: QueueSnapshot): Promise<void>`. `OfflineMutationQueue` receives injected `now(): string` and `createMutationId(): string` so mobile/desktop do not depend on browser globals.

- [x] **Step 4: Verify GREEN and typecheck**

Run: `pnpm --filter @tradeos/client-core test -- sync-runtime.test.ts && pnpm --filter @tradeos/client-core typecheck`
Expected: PASS.

### Task 3: Storage-agnostic sync engine

**Files:**
- Modify: `packages/client-core/src/sync-runtime.ts`
- Modify: `packages/client-core/src/sync-runtime.test.ts`

**Interfaces:**
- Consumes: `OfflineMutationQueue`, `QueueSnapshotStorage`, canonical sync contract.
- Produces: `SyncTransport.push(request: SyncPushRequest): Promise<SyncResponse>`, `FlushSummary`, `OfflineMutationQueue.flush({ activeBusinessId, online, transport })`.

- [x] **Step 1: Write failing flush tests for tenant isolation and batch selection**

Assert only ready mutations for `activeBusinessId` are sent, source order is preserved, at most 100 are sent, and other-business/blocked mutations remain pending.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @tradeos/client-core test -- sync-runtime.test.ts`
Expected: FAIL because `flush` is missing.

- [x] **Step 3: Implement minimal batch selection and transport call**

`flush` must return an empty summary without calling transport when offline, no active business exists, or no sendable mutation exists.

- [x] **Step 4: Add failing result-resolution tests**

Assert: APPLIED is removed and counted; REJECTED moves to `failed` with full result + injected timestamp; RECEIVED stays pending; a missing result stays pending and counts as received/pending work rather than disappearing.

- [x] **Step 5: Implement result resolution and verify GREEN**

Run: `pnpm --filter @tradeos/client-core test -- sync-runtime.test.ts`
Expected: PASS.

### Task 4: Failure safety and single-flight semantics

**Files:**
- Modify: `packages/client-core/src/sync-runtime.ts`
- Modify: `packages/client-core/src/sync-runtime.test.ts`

**Interfaces:**
- Consumes: `OfflineMutationQueue.flush` from Task 3.
- Produces: single-flight behavior per queue instance and replay-safe failure behavior.

- [x] **Step 1: Write failing transport-failure test**

Transport rejection must reject `flush` and leave the persisted snapshot byte-for-byte equivalent in pending/failed content.

- [x] **Step 2: Write failing save-failure-after-APPLIED test**

When the server returns APPLIED but durable `save` fails, `flush` must reject; the previously persisted mutation remains with the same IDs so the next attempt is an idempotent replay.

- [x] **Step 3: Write failing concurrent-flush test**

Two simultaneous calls on the same queue instance must return the same in-flight promise behavior and invoke transport once.

- [x] **Step 4: Implement single-flight/failure safety and verify GREEN**

Run: `pnpm --filter @tradeos/client-core test -- sync-runtime.test.ts`
Expected: PASS.

### Task 5: Full repository verification and Issue #8 progress note

**Files:**
- Modify: `docs/superpowers/plans/2026-10-10-cross-platform-runtime-foundation.md` only if execution notes are needed.
- No product source changes beyond Tasks 1–4.

**Interfaces:**
- Produces: a reviewed Phase-1 shared runtime ready for platform-specific durable adapters.

- [x] **Step 1: Run client-core suite**

Run: `pnpm --filter @tradeos/client-core test`
Expected: all client-core tests PASS, no placeholder “tests pending” output.

- [x] **Step 2: Run full repository verification**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all workspace gates PASS.

- [x] **Step 3: Inspect the diff for scope containment**

Run: `git diff --check && git status --short && git diff --stat origin/main...HEAD`
Expected: only client-core/package-lock-plan files for this slice; no web/API/business-rule changes.

- [x] **Step 4: Commit and push the Phase-1 branch**

Commit message: `feat(client-core): add portable offline sync runtime`

- [x] **Step 5: Open a focused PR and update Issue #8**

PR must state that mobile durable storage, desktop durable storage/peripheral bridge, and System Admin API/security are still separate follow-on slices; do not close Issue #8 yet.
