# TradeOS Mobile Catalog + POS Foundation Design

## Outcome

Turn the authenticated mobile runtime into the first real business workflow: browse/search the current business catalog, see last-known branch inventory, build a cart, choose an immediate payment method, and durably enqueue a canonical `SALE_CREATE` mutation that syncs through the existing server-authoritative engine.

This slice supports `CASH`, `MOMO`, `CARD`, `BANK`, and `OTHER`. Customer-credit checkout remains out of scope until mobile customer lookup/credit readiness is available.

## Safety invariants

- Server remains authoritative for sellability, current price, unit conversion, stock availability, accounting, cashbook, COGS, actor identity, tenancy and idempotency.
- Mobile never sends a client-calculated sale total or unit price in `SALE_CREATE`; it sends item, sale unit, quantity, currency and payment method only.
- Offline catalog/inventory data is explicitly last-known data. It may support capture but never promises current stock availability.
- A checkout is considered locally saved only after `OfflineMutationQueue.enqueue()` durably persists the mutation.
- Roles outside `OWNER`, `ADMIN`, `MANAGER`, `CASHIER`, `SALES`, `STAFF` may browse allowed data but cannot create sale mutations in the UI/runtime.
- No customer-credit sale can be created by this mobile slice.
- Pending sale evidence survives restart/sign-out because it stays in the existing durable queue.

## Architecture

### 1. Native gateway read surface

Extend the allow-listed `/api/mobile/[...path]` gateway with only:

- `GET /v1/catalog/items?businessId=...`
- `GET /v1/inventory?businessId=...&branchId=...&query=...`

No catalog/inventory write routes are exposed. Query strings continue to pass through unchanged.

### 2. Mobile API types

Add typed methods for catalog and branch inventory. Catalog mirrors the server `CatalogItemView`. Inventory mirrors the branch inventory list. These calls use the existing refresh-safe bearer client.

### 3. Durable commerce cache

Persist the last successful catalog snapshot per business and the last successful inventory snapshot per business+branch in AsyncStorage. Snapshots include `fetchedAt` so the UI can state when data was last confirmed.

Corrupt commerce cache is disposable because it is read-model data, not economic evidence: malformed cache fails closed to “no cache” and may be overwritten by a later successful fetch. This differs deliberately from the mutation queue, whose corruption remains blocking/non-destructive.

### 4. POS domain model

Create a pure mobile POS model that:

- projects sellable catalog units using the same rules as web (`active && canSell && price != null`);
- joins last-known inventory by item id for display only;
- supports search by item name/SKU/unit label;
- adds/increments/removes cart lines keyed by `itemId:saleUnitCode`;
- validates finite positive quantities;
- computes a display total from cached/default prices only, clearly non-authoritative;
- builds canonical `SALE_CREATE` payloads without client prices/totals.

### 5. Commerce runtime

Add mobile runtime methods:

- `loadCommerce(online)` — if online, fetch catalog+inventory in parallel, save both caches, return live snapshot; on network/API failure, fall back to cache when available; offline uses cache only.
- `createSale(cart, paymentMethod, online)` — requires READY workspace + sale-capable role, creates a canonical mutation with the stable device client id, enqueues durably, optionally flushes when online, then returns queue/checkout status.

A successful enqueue clears the UI cart even if network flush fails, because the sale is already durably captured.

### 6. Mobile UI

READY workspace becomes a small mobile business shell with `Sell` and `Sync` views. `Sell` contains:

- search box;
- catalog cards grouped by item/unit, showing price and last-known stock when applicable;
- cart lines with + / − / remove;
- cached/live freshness indicator;
- payment method selector for the five immediate methods;
- checkout action and result banner.

Viewer/accountant/inventory-only roles see the catalog/inventory read experience but a clear “sale permission required” checkout state.

The existing queue/sync diagnostics remain under `Sync`.

## Error behavior

- Online catalog/inventory fetch failure with cache -> show cached snapshot + warning.
- Online fetch failure without cache -> show a commerce error while keeping the authenticated workspace usable.
- Offline without cache -> explain that the device needs one successful online catalog sync before offline selling is possible.
- Server-rejected sale after immediate flush -> mutation moves to failed review state and UI reports `needs review`; it is not silently deleted.
- Network failure after durable enqueue -> checkout reports `saved offline/pending sync`.
- Unsupported role -> runtime rejects before enqueue and UI disables checkout.

## Test strategy

TDD coverage will pin:

- gateway route allow-list + query forwarding;
- API catalog/inventory bearer requests and refresh compatibility;
- cache scoping/freshness/fail-closed behavior;
- sellable projection, search, cart arithmetic and mutation shape;
- runtime live fetch/cache fallback/offline behavior;
- role gating and durable checkout/flush outcomes;
- app-model transitions for commerce loading, cached warning, cart clearing after durable capture, and rejected sync review state.

Final gates: clean-checkout mobile tests, root CI-parity test/build, Android+iOS Expo exports, PR CI, merge, staging gateway smoke.
