# TradeOS Mobile Durable Session + Sync — QA Record

Date: 2026-10-10
Branch: `feat/mobile-durable-session-sync`
Base reviewed: `main` at `2adcd270d8f167ee3cf2c6361e9eef9436564794`

## Outcome

The Expo Android/iOS client is no longer a static capability mock. This slice establishes the production mobile runtime foundation:

- secure login and rotating bearer sessions;
- encrypted native credential persistence;
- durable device identity and workspace selection;
- currently authorized business/branch restore;
- restart-safe offline mutation queue;
- active-business-only manual and reconnect sync;
- a narrow TLS native API gateway on the existing TradeOS domain;
- a functional mobile shell showing identity, business, branch, role, connectivity and queue state.

The existing Fastify API remains private on localhost. No new public backend port is exposed.

## Security and tenancy invariants verified

- Access and refresh tokens are persisted only through `expo-secure-store`.
- AsyncStorage contains non-secret device/workspace metadata and the durable mutation queue only.
- The changed runtime/gateway implementation contains no console logging of credentials or authorization data.
- Corrupt queue JSON or structurally invalid queue data raises `QueueStorageCorruptError`; the stored queue evidence is not deleted or replaced.
- Concurrent unauthorized requests coalesce to one refresh-token rotation.
- Refresh failure clears local credentials and requires a fresh sign-in.
- Sign-out clears credentials but intentionally retains pending offline mutation evidence.
- Persisted business selection cannot restore a business absent from the server's current active memberships.
- Persisted branch selection cannot restore an inactive/stale branch; runtime falls back to active `MAIN`, then first active branch.
- Queue flush is scoped to the current READY business. Mutations for another business remain blocked locally.
- `/api/mobile/[...path]` exposes only login, refresh, logout, current-user, sync and UUID business-context endpoints with their intended methods.
- Native gateway forwarding allows only `authorization` and `content-type`; browser cookies and arbitrary request headers are not forwarded.
- Unsupported gateway paths are rejected before Fastify.

## TDD evidence

Each implementation task began with a focused failing test for the missing behavior, then moved to green:

1. Native gateway: 3 focused tests.
2. Durable persistence: 6 tests.
3. Refresh-safe API client: 7 tests.
4. Workspace/sync runtime: 7 tests.
5. App-state/reconnect model: 6 tests.

Final mobile suite: **4 files / 26 tests passed**.

Final web suite, including native-gateway regression coverage: **62 files / 335 tests passed**.

API integration suite against an isolated PostgreSQL test cluster: **23 files / 85 tests passed**. This exercised authentication, tenant boundaries, sync commerce, treasury, financial reports, cashbook, reconciliation, inventory, returns and exchanges.

Other repository suites also passed, including deployment configuration, contracts, client-core and domain coverage.

## Full repository gate

A CI-parity gate was run in this order:

```text
pnpm typecheck
pnpm lint
git diff --check main...HEAD
pnpm test
pnpm build
```

Result: **PASS, exit code 0**.

The first local API-test attempt exposed a VPS environment mismatch: the shared PostgreSQL service did not have CI's disposable test credentials. No staging database was used or modified. A separate PostgreSQL 18 cluster was created under `/tmp`, bound to `127.0.0.1:56381`, migrated through `0015_exchange_cases.sql` (57 public tables), and used only for the final integration gate.

Production builds passed for system-admin, web, API, desktop and mobile TypeScript. The web production route manifest includes the dynamic `/api/mobile/[...path]` gateway.

## Native packaging checks

Expo production export succeeded for both native targets from the same source/runtime:

- Android: 609 modules, Hermes bundle `AppEntry-492963be0a8f58c94b8300a3c960e0c4.hbc`, approximately 1.5 MB.
- iOS: 611 modules, Hermes bundle `AppEntry-2326b4ab711eb80bc37c9336b2770048.hbc`, approximately 1.5 MB.

Both export commands completed with exit code 0.

## Production-build gateway smoke

A temporary production Next server was started on loopback only and pointed at the existing private Fastify staging listener. Smoke results:

- `GET /api/mobile/v1/catalog/items` -> **404 `ROUTE_NOT_ALLOWED`** (correctly blocked by the gateway).
- `GET /api/mobile/v1/me` without bearer token -> **401 `AUTH_REQUIRED`** from Fastify (proves the allowed route reached the API auth boundary).
- `POST /api/mobile/v1/auth/login` with intentionally bogus credentials -> **401 `LOGIN_REJECTED`** from Fastify (proves login forwarding works without using any real account credential).

The temporary Next process was stopped after the smoke.

## Clean-checkout CI regression and fix

The first GitHub CI run for PR #51 exposed a clean-checkout-only resolver defect that the earlier VPS verification had masked: `@tradeos/client-core` published runtime JavaScript from ignored `packages/client-core/dist/`, and the local worktree already contained that build output from earlier verification. A fresh GitHub checkout did not. Mobile Vitest therefore failed before running tests because `dist/index.js` was absent.

The failure was reproduced locally by deleting `packages/client-core/dist` before running the mobile tests. The fix keeps the existing root package entry build-oriented for Node/desktop consumers and adds a dedicated `@tradeos/client-core/sync-runtime` subpath. That subpath exposes `src/sync-runtime.ts` under the `react-native` condition while retaining the built JavaScript default for Node-compatible consumers. Mobile imports now target that explicit subpath, and `apps/mobile/vitest.config.ts` aliases the subpath to TypeScript source so clean-checkout unit tests do not depend on ignored build output.

Regression proof was then run from a clean runtime state with `packages/client-core/dist` removed:

- mobile Vitest: **4 files / 26 tests passed** without prebuilding client-core;
- mobile typecheck: **PASS**;
- Android Expo production export: **PASS** with `client-core/dist` still absent;
- iOS Expo production export: **PASS** with `client-core/dist` still absent;
- full root CI-parity gate with `client-core/dist` deleted immediately before `pnpm test`: **PASS, exit code 0**;
- API integration suite in that same clean-root run: **23 files / 85 tests passed**;
- full production build after the clean-root test run: **PASS**.

This explicitly covers the condition that failed on GitHub instead of relying on previously generated workspace artifacts.

## Review findings

A branch-wide security/tenancy review found no Critical or Important issue requiring code changes. Generated Next `next-env.d.ts` changes created by the production build were reverted and are not part of this branch.

Expo dependency resolution reports a ReactDOM peer warning because the workspace resolves `react-dom@19.3.0` while Expo SDK 57 targets React 19.2.3. React was intentionally kept at Expo 57's supported 19.2.3 instead of destabilizing the native SDK to silence a peer-only warning.

## Deliberate scope limits / next slices

This foundation does **not** claim that the full business app is already implemented on mobile. The next mobile product slices should consume this runtime in this order:

1. Real mobile transaction workflows, beginning with POS/sales and catalog/inventory reads, then customers, returns/exchanges and cashbook.
2. Device UAT and distributable Android/iOS builds/signing.
3. True OS background-sync scheduling and retry policy where the platforms permit it.
4. Mobile onboarding/business creation if product strategy requires owner setup directly on-device.
5. Desktop peripheral work and the remaining system-admin control-plane work remain separate tracks.

Server-side pricing, permissions, accounting, stock, refunds/returns, tenancy and sync idempotency remain authoritative throughout.