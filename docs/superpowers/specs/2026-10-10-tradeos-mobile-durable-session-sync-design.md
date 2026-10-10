# TradeOS Mobile Durable Session + Sync Design

## Outcome

Turn the existing Expo Android/iOS shell into a real TradeOS client foundation that can authenticate against the current server, survive app restarts, restore an authorized business/branch workspace, retain offline mutations durably, and flush them safely when connectivity returns.

This slice deliberately does not recreate POS, inventory, returns, cashbook, or other web workflows yet. Those screens will consume the durable session/sync runtime produced here.

## Constraints

- Android and iOS remain one Expo / React Native codebase.
- Expo SDK 57 / React Native 0.86 / React 19.2.3 stay aligned; no dependency downgrade is required.
- The API remains private on `127.0.0.1:4036`; no new public server port is opened.
- Mobile uses the same `@tradeos/contracts` sync envelope and `@tradeos/client-core` `OfflineMutationQueue` as other clients.
- Server pricing, permissions, accounting, stock, returns/refunds, tenancy, and idempotency remain authoritative.
- Access and refresh tokens must never be persisted in AsyncStorage.
- Pending economic mutations must never be silently discarded because local queue JSON is malformed.

## Architecture

### 1. HTTPS native API gateway

Add an allow-listed Next.js gateway at `/api/mobile/[...path]` on the existing `https://tradeosafrica.lightworldtech.com` origin. The gateway forwards only the endpoints this mobile foundation needs: login, refresh, logout, current-user identity, business context, and sync. It passes bearer authorization and content type unchanged, streams the original status/body back, disables caching, and does not use the browser cookie session helper.

This keeps Fastify bound to localhost while giving native clients a stable TLS endpoint. Unsupported paths return `404 ROUTE_NOT_ALLOWED` before reaching Fastify.

### 2. Durable mobile persistence

Create small storage interfaces so domain tests do not depend on native modules. The native adapters use:

- `expo-secure-store` for access token, refresh token, and expiry metadata.
- `@react-native-async-storage/async-storage` for stable device identity, active business/branch selection, and the offline queue snapshot.
- `expo-crypto` for UUID generation.

Queue storage validates the persisted shape. Empty storage returns an empty queue; malformed or structurally invalid queue data throws a typed corruption error and leaves the stored value untouched. Session metadata may fail closed to signed-out state because it contains no unsynced economic mutation.

### 3. Session-aware API client

A pure TypeScript client owns login, authenticated requests, refresh, logout, `/v1/me`, business context, and `/v1/sync`.

On an authenticated `401`, it performs exactly one refresh and retries once. Concurrent requests share one refresh promise so rotating refresh tokens cannot race. A failed refresh clears local credentials and raises a session-expired error. Logout attempts remote revocation but always clears local credentials.

### 4. Workspace bootstrap and sync runtime

Bootstrap proceeds in this order:

1. Load persisted credentials. If absent, return `SIGNED_OUT`.
2. Load `/v1/me` through the refresh-aware client.
3. If the user has no active membership, return `NEEDS_BUSINESS` without inventing a tenant.
4. Restore the previously selected business if it is still in the membership list; otherwise choose the first active membership.
5. Load that business context.
6. Restore the selected active branch if still valid; otherwise choose active `MAIN`, then the first active branch.
7. Persist the resolved business/branch selection and expose queue counts.

The runtime creates one `OfflineMutationQueue` backed by durable storage. Its sync transport posts canonical mutations to `/v1/sync`. `@react-native-community/netinfo` remains an app-shell concern: when connectivity changes from unavailable to available, the app asks the runtime to flush for the current business. Manual sync remains available as well.

### 5. Minimal functional mobile shell

Replace the static concept screen with a foundation UI:

- signed-out identifier/password form;
- boot/auth errors shown without exposing tokens;
- signed-in business, branch, role, online/offline state, pending/blocked/failed queue counts;
- manual Sync and Sign out controls;
- a clear `NEEDS_BUSINESS` state directing the owner to business setup rather than fabricating context.

The shell does not yet create transactions. Future POS/inventory/etc. screens will enqueue canonical mutations into this runtime.

## Error and safety behavior

- Network failure during queue flush leaves the durable queue unchanged.
- A mutation enqueued while a flush is in flight is preserved by `@tradeos/client-core`.
- Invalid/corrupt queue persistence is surfaced as a blocking local-data error; it is not auto-cleared.
- Expired access tokens refresh once; refresh failure signs the local session out.
- Unsupported gateway paths never reach Fastify.
- A removed membership or inactive branch is not restored from stale local selection.
- Sign out clears credentials but does not delete pending queue evidence.

## Testing

Use Vitest for mobile pure-TypeScript tests and existing web Vitest coverage for the gateway. Pin:

- gateway allow-list and bearer/header forwarding behavior;
- secure-vs-plain persistence boundaries, stable device identity, corrupt queue failure;
- login persistence, single-flight refresh, one retry, failed-refresh cleanup, logout cleanup;
- workspace selection/fallback rules;
- durable queue -> authenticated sync transport integration and offline/no-business no-op behavior.

Final verification is full repository tests, typecheck, lint, production build, `git diff --check`, and a live staging health check after merge/deploy. Native store packaging is not added to ordinary CI in this slice.