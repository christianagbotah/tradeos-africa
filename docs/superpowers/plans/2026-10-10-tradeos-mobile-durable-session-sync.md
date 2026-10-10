# TradeOS Mobile Durable Session + Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Expo Android/iOS client securely authenticate, restore business/branch context, preserve offline mutations across restarts, and sync safely through the existing TradeOS HTTPS domain.

**Architecture:** Keep Fastify private on localhost and expose a narrow allow-listed native gateway through Next.js. Build the mobile runtime as pure TypeScript around injected storage/fetch adapters, with SecureStore for credentials, AsyncStorage for non-secret state/queue snapshots, and the existing `@tradeos/client-core` queue for idempotent sync.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19.2.3, TypeScript, Next.js 16, Vitest, `expo-secure-store`, `expo-crypto`, AsyncStorage, NetInfo, `@tradeos/client-core`, `@tradeos/contracts`.

**Spec:** `docs/superpowers/specs/2026-10-10-tradeos-mobile-durable-session-sync-design.md`

## Global Constraints

- Do not expose Fastify port 4036 publicly.
- Do not persist access or refresh tokens in AsyncStorage.
- Do not silently clear malformed pending queue data.
- Preserve server-authoritative permissions, pricing, accounting, stock, returns/refunds, tenancy, and sync idempotency.
- Keep one Expo codebase for Android and iOS.
- Keep Expo SDK 57 / React Native 0.86 / React 19.2.3 aligned.
- Do not implement transaction workflow screens or OS background-task scheduling in this slice.

## Review Focus

- Concurrent `401` responses must produce one refresh rotation, not competing refreshes.
- A corrupt queue snapshot must block safely without erasing pending evidence.
- A stale saved business/branch must fall back only to currently authorized/active context.
- Sign out must clear credentials while retaining pending queue evidence.
- Reconnect/manual sync must never transmit mutations for a different active business.

---

### Task 1: Native HTTPS API Gateway

**Files:**
- Create: `apps/web/app/lib/native-api-proxy.ts`
- Create: `apps/web/app/lib/native-api-proxy.test.ts`
- Create: `apps/web/app/api/mobile/[...path]/route.ts`

**Interfaces:**
- Produces: `isNativeApiRouteAllowed(method: string, path: string): boolean`
- Produces: `forwardNativeApi(request: NextRequest, apiPath: string): Promise<NextResponse>`
- Gateway base consumed later: `/api/mobile`

- [ ] **Step 1: Write failing gateway tests** covering exact allowed auth/me/sync routes, UUID business-context GET, blocked arbitrary routes, bearer/content-type forwarding, no-store behavior, and upstream status/body preservation.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/web test -- native-api-proxy.test.ts` and verify RED because the proxy module is absent.
- [ ] **Step 3: Implement the minimal allow-list/proxy and GET/POST catch-all route.** The proxy target is `TRADEOS_API_URL`; it forwards only `authorization` and `content-type`, never browser cookies.
- [ ] **Step 4: Re-run the focused test and `pnpm --filter @tradeos/web typecheck`; expect PASS.**
- [ ] **Step 5: Commit** `feat(web): add native mobile API gateway`.

### Task 2: Mobile Durable Persistence

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/mobile/src/storage.ts`
- Create: `apps/mobile/src/storage.test.ts`
- Create: `apps/mobile/src/native-storage.ts`

**Interfaces:**
- Produces: `StringStorage`, `SecureStringStorage`
- Produces: `MobileSessionTokens`, `WorkspaceSelection`
- Produces: `MobilePersistence`
- Produces: `AsyncQueueSnapshotStorage implements QueueSnapshotStorage`
- Produces: `QueueStorageCorruptError`
- Produces: `createNativeMobilePersistence(): MobilePersistence`

- [ ] **Step 1: Install compatible mobile dependencies** with Expo/pnpm: SecureStore, AsyncStorage, NetInfo, expo-crypto, and Vitest; replace the placeholder mobile test script with `vitest run`.
- [ ] **Step 2: Write failing persistence tests** for stable device key, credential storage only through secure storage, workspace selection in plain storage, empty queue default, queue round-trip, and malformed/invalid queue throwing without removal.
- [ ] **Step 3: Run** `pnpm --filter @tradeos/mobile test -- storage.test.ts`; verify RED because storage implementation is absent.
- [ ] **Step 4: Implement minimal pure storage classes and thin native adapters.** Version keys as `tradeos.mobile.*.v1`.
- [ ] **Step 5: Re-run focused tests and `pnpm --filter @tradeos/mobile typecheck`; expect PASS.**
- [ ] **Step 6: Commit** `feat(mobile): add durable secure persistence`.

### Task 3: Refresh-Safe Mobile API Client

**Files:**
- Create: `apps/mobile/src/api-client.ts`
- Create: `apps/mobile/src/api-client.test.ts`

**Interfaces:**
- Consumes: `MobilePersistence`, `MobileSessionTokens`
- Produces: `MobileApiClient`, `MobileApiError`, `SessionExpiredError`
- Produces: `login(identifier: string, password: string): Promise<MobileUser>`
- Produces: `getMe(): Promise<MobileMe>`
- Produces: `getBusinessContext(businessId: string): Promise<MobileBusinessContext>`
- Produces: `push(request: SyncPushRequest): Promise<SyncResponse>` satisfying `SyncTransport`
- Produces: `logout(): Promise<void>`

- [ ] **Step 1: Write failing API tests** for login session persistence, bearer requests, one retry after successful refresh, concurrent `401`s sharing one refresh, failed refresh clearing credentials, and best-effort logout always clearing credentials.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/mobile test -- api-client.test.ts`; verify RED because the client is absent.
- [ ] **Step 3: Implement the minimal fetch client** using `${baseUrl}/v1/...`, platform `ANDROID` or `IOS`, stable deviceKey and app version. Refresh uses one shared in-flight promise.
- [ ] **Step 4: Re-run focused tests and mobile typecheck; expect PASS.**
- [ ] **Step 5: Commit** `feat(mobile): add refresh-safe API client`.

### Task 4: Workspace Bootstrap + Durable Sync Runtime

**Files:**
- Create: `apps/mobile/src/runtime.ts`
- Create: `apps/mobile/src/runtime.test.ts`

**Interfaces:**
- Consumes: `MobileApiClient`, `MobilePersistence`, `AsyncQueueSnapshotStorage`, `OfflineMutationQueue`
- Produces: `MobileRuntime`
- Produces: `bootstrap(): Promise<MobileBootstrapState>` with `SIGNED_OUT | NEEDS_BUSINESS | READY`
- Produces: `login(identifier: string, password: string): Promise<MobileBootstrapState>`
- Produces: `flush(online: boolean): Promise<FlushSummary>`
- Produces: `queue: OfflineMutationQueue`
- Produces: `logout(): Promise<void>`

- [ ] **Step 1: Write failing runtime tests** for signed-out bootstrap, persisted authorized business/branch restoration, stale business fallback, inactive branch fallback to active MAIN/first, no-membership state, active-business-only sync, and sign-out preserving the queue snapshot.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/mobile test -- runtime.test.ts`; verify RED because runtime is absent.
- [ ] **Step 3: Implement the minimal bootstrap/runtime orchestration** and persist the resolved selection.
- [ ] **Step 4: Re-run focused tests, all mobile tests, and mobile typecheck; expect PASS.**
- [ ] **Step 5: Commit** `feat(mobile): add workspace and sync runtime`.

### Task 5: Functional Android/iOS Shell

**Files:**
- Modify: `apps/mobile/App.tsx`
- Create: `apps/mobile/src/app-model.ts`
- Create: `apps/mobile/src/app-model.test.ts`

**Interfaces:**
- Consumes: `MobileRuntime`, native persistence, NetInfo, `expo-crypto`
- Produces: one shared Android/iOS app shell with auth, workspace, queue state, manual/reconnect sync, and sign-out.

- [ ] **Step 1: Write failing pure app-model tests** for signed-out/ready/needs-business state transitions, sync-state refresh after flush, reconnect only flushing on a transition to reachable, and safe error copy that excludes tokens.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/mobile test -- app-model.test.ts`; verify RED.
- [ ] **Step 3: Implement `app-model.ts`, then replace the static `App.tsx` shell** with a functional sign-in/workspace UI wired to NetInfo. Use `process.env.EXPO_PUBLIC_TRADEOS_API_BASE ?? "https://tradeosafrica.lightworldtech.com/api/mobile"`.
- [ ] **Step 4: Run all mobile tests/typecheck and verify no placeholder `mobile tests pending` remains.**
- [ ] **Step 5: Commit** `feat(mobile): wire durable session and reconnect sync`.

### Task 6: Whole-Repository Verification and Handoff

**Files:**
- Create: `docs/qa/2026-10-10-mobile-durable-session-sync.md`
- Optionally update: `README.md` only if mobile runtime instructions are absent and materially needed.

**Interfaces:**
- Consumes all prior tasks; produces a reviewable branch and QA record.

- [ ] **Step 1: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check`; all must pass.
- [ ] **Step 2: Run a focused gateway smoke** against a local production Next build or route unit test to prove blocked paths remain blocked and `/api/mobile/v1/auth/login` reaches the internal API contract without exposing port 4036.
- [ ] **Step 3: Write QA evidence** with exact commands/results, scope limits, and follow-on slices (transaction UI, true OS background sync, desktop peripherals, system-admin APIs).
- [ ] **Step 4: Perform whole-branch review against `main`; fix any Critical/Important finding with RED→GREEN coverage.**
- [ ] **Step 5: Push the feature branch and open a PR; do not merge until GitHub CI is green.**