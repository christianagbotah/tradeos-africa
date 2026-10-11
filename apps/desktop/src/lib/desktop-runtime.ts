/**
 * DesktopRuntime — the desktop analogue of MobileRuntime.
 *
 * Owns:
 *   - Session lifecycle (login, bootstrap, logout, session-expired handling)
 *   - Active business/branch selection (restored from persistence)
 *   - The `OfflineMutationQueue` from `@tradeos/client-core/sync-runtime`
 *   - Sale capture via server-authoritative SALE_CREATE mutations
 *   - Queue state (pending / blocked / failed) for the UI
 *
 * The runtime never auto-activates sample data. On any auth/connectivity
 * failure it surfaces a truthful state (SIGNED_OUT, NEEDS_BUSINESS,
 * API_UNAVAILABLE, etc.) so the UI can render an honest screen.
 */

import {
  OfflineMutationQueue,
  type FlushSummary,
  type QueueSnapshotStorage,
  type QueueState,
  type SyncTransport,
} from "@tradeos/client-core/sync-runtime";
import {
  NoSessionError,
  SessionExpiredError,
  type DesktopApiClient,
  type DesktopBusinessContext,
  type DesktopCatalogItem,
  type DesktopInventoryItem,
  type DesktopMembership,
  type DesktopUser,
} from "./desktop-api-client.js";
import { buildSaleMutation } from "./sale-mutation.js";
import type {
  DesktopCartLine,
  DesktopPaymentMethod,
  DesktopSellableItem,
} from "./types.js";
import type { DesktopPersistence } from "./desktop-persistence.js";

type RuntimeApi = Pick<
  DesktopApiClient,
  | "login"
  | "getMe"
  | "getBusinessContext"
  | "getCatalog"
  | "getInventory"
  | "getCustomers"
  | "getSales"
  | "getDashboardKpis"
  | "getReportSummary"
  | "getActivityFeed"
  | "push"
  | "logout"
> & SyncTransport;

// ---------------------------------------------------------------------------
// Bootstrap states
// ---------------------------------------------------------------------------

export type DesktopReadyState = {
  status: "READY";
  user: DesktopUser;
  membership: DesktopMembership;
  business: DesktopBusinessContext["business"];
  branch: DesktopBusinessContext["branches"][number];
  queue: QueueState;
};

export type DesktopBootstrapState =
  | { status: "SIGNED_OUT"; queue: QueueState }
  | { status: "NEEDS_BUSINESS"; user: DesktopUser; queue: QueueState }
  | { status: "SESSION_EXPIRED"; queue: QueueState }
  | DesktopReadyState;

// ---------------------------------------------------------------------------
// Commerce snapshot
// ---------------------------------------------------------------------------

export type DesktopCommerceSnapshot = {
  source: "LIVE" | "CACHE";
  fetchedAt: string;
  warning: string | null;
  items: DesktopSellableItem[];
};

// ---------------------------------------------------------------------------
// Sale capture result
// ---------------------------------------------------------------------------

export type DesktopSaleCaptureResult = {
  clientMutationId: string;
  outcome: "SYNCED" | "PENDING" | "NEEDS_REVIEW";
  queue: QueueState;
  errorCode?: string;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Runtime errors
// ---------------------------------------------------------------------------

export class DesktopRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopRuntimeError";
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type DesktopRuntimeOptions = {
  api: RuntimeApi;
  persistence: DesktopPersistence;
  queueStorage: QueueSnapshotStorage;
  now: () => string;
  createMutationId: () => string;
};

const SALE_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"]);

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export class DesktopRuntime {
  readonly queue: OfflineMutationQueue;
  /** The underlying API client — exposed so screens can call read-only endpoints directly. */
  readonly api: RuntimeApi;
  private current: DesktopReadyState | null = null;

  constructor(private readonly options: DesktopRuntimeOptions) {
    this.api = options.api;
    this.queue = new OfflineMutationQueue(options.queueStorage, {
      now: options.now,
      createMutationId: options.createMutationId,
    });
  }

  // -- Bootstrap / session lifecycle --------------------------------------

  async bootstrap(): Promise<DesktopBootstrapState> {
    // No session-store check here — the API client throws NoSessionError if
    // there are no tokens, which we map to SIGNED_OUT.
    let me;
    try {
      me = await this.options.api.getMe();
    } catch (error) {
      if (error instanceof SessionExpiredError || error instanceof NoSessionError) {
        return this.signedOut();
      }
      throw error;
    }

    const memberships = me.memberships.filter((m) => m.businessStatus === "ACTIVE");
    if (memberships.length === 0) {
      this.current = null;
      return {
        status: "NEEDS_BUSINESS",
        user: me.user,
        queue: await this.queue.getState(null),
      };
    }

    const saved = await this.options.persistence.loadWorkspaceSelection();
    const membership = memberships.find((m) => m.businessId === saved?.businessId) ?? memberships[0]!;
    const context = await this.options.api.getBusinessContext(membership.businessId);
    const activeBranches = context.branches.filter((b) => b.active);
    const branch = (saved?.businessId === membership.businessId
      ? activeBranches.find((b) => b.id === saved.branchId)
      : undefined)
      ?? activeBranches.find((b) => b.code === "MAIN")
      ?? activeBranches[0];

    if (!branch) {
      this.current = null;
      throw new DesktopRuntimeError("This TradeOS business has no active branch available on desktop.");
    }

    await this.options.persistence.saveWorkspaceSelection({
      businessId: membership.businessId,
      branchId: branch.id,
    });

    const ready: DesktopReadyState = {
      status: "READY",
      user: me.user,
      membership,
      business: context.business,
      branch,
      queue: await this.queue.getState(membership.businessId),
    };
    this.current = ready;
    return ready;
  }

  async login(identifier: string, password: string): Promise<DesktopBootstrapState> {
    await this.options.api.login(identifier, password);
    return this.bootstrap();
  }

  async logout(): Promise<void> {
    try {
      await this.options.api.logout();
    } finally {
      this.current = null;
    }
  }

  /** Surface a session-expired signal from the UI layer. */
  async handleSessionExpired(): Promise<DesktopBootstrapState> {
    this.current = null;
    return { status: "SESSION_EXPIRED", queue: await this.queue.getState(null) };
  }

  // -- Commerce -----------------------------------------------------------

  async loadCommerce(online: boolean): Promise<DesktopCommerceSnapshot> {
    const ready = this.requireReady();
    if (online) {
      try {
        const [catalog, inventory] = await Promise.all([
          this.options.api.getCatalog(ready.membership.businessId),
          this.options.api.getInventory(ready.membership.businessId, ready.branch.id),
        ]);
        const fetchedAt = this.options.now();
        await Promise.all([
          this.options.persistence.saveCatalogCache(ready.membership.businessId, { fetchedAt, items: catalog.items }),
          this.options.persistence.saveInventoryCache(ready.membership.businessId, ready.branch.id, { fetchedAt, items: inventory.items }),
        ]);
        return {
          source: "LIVE",
          fetchedAt,
          warning: null,
          items: projectSellableItems(catalog.items, inventory.items),
        };
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        return this.loadCachedCommerce(ready, "Live catalog refresh failed. Showing last-known catalog and stock.");
      }
    }
    return this.loadCachedCommerce(ready, "Offline · showing last-known catalog and stock.");
  }

  // -- Sale capture -------------------------------------------------------

  async captureSale(input: {
    cart: readonly DesktopCartLine[];
    paymentMethod: DesktopPaymentMethod;
    customerId?: string | undefined;
    online: boolean;
  }): Promise<DesktopSaleCaptureResult> {
    const ready = this.requireReady();
    if (!SALE_ROLES.has(ready.membership.role)) {
      throw new DesktopRuntimeError("Your current role does not have permission to create sales.");
    }

    const clientMutationId = this.options.createMutationId();
    const mutation = buildSaleMutation({
      clientId: await this.options.persistence.getOrCreateDeviceKey(),
      clientMutationId,
      businessId: ready.membership.businessId,
      branchId: ready.branch.id,
      currencyCode: ready.business.currencyCode,
      paymentMethod: input.paymentMethod,
      occurredAt: this.options.now(),
      cart: input.cart,
      ...(input.customerId ? { customerId: input.customerId } : {}),
    });

    const enqueued = await this.queue.enqueue(mutation);
    if (!enqueued) {
      throw new DesktopRuntimeError("This sale is already present in the offline queue.");
    }

    if (input.online) {
      try {
        await this.flush(true);
      } catch {
        // The economic mutation is already durable. Network failure leaves it pending.
      }
    }

    const snapshot = await this.queue.getSnapshot();
    const failed = snapshot.failed.find((entry) => entry.mutation.clientMutationId === clientMutationId);
    const queue = await this.queue.getState(ready.membership.businessId);
    this.current = { ...ready, queue };

    if (failed) {
      return {
        clientMutationId,
        outcome: "NEEDS_REVIEW",
        queue,
        ...(failed.result.errorCode ? { errorCode: failed.result.errorCode } : {}),
        ...(failed.result.errorMessage ? { errorMessage: failed.result.errorMessage } : {}),
      };
    }
    if (snapshot.pending.some((entry) => entry.clientMutationId === clientMutationId)) {
      return { clientMutationId, outcome: "PENDING", queue };
    }
    return { clientMutationId, outcome: "SYNCED", queue };
  }

  // -- Sync flush ---------------------------------------------------------

  async flush(online: boolean): Promise<FlushSummary> {
    const activeBusinessId = this.current?.membership.businessId ?? null;
    const summary = await this.queue.flush({
      activeBusinessId,
      online,
      transport: this.options.api,
    });
    if (this.current) {
      this.current = {
        ...this.current,
        queue: { pending: summary.pending, blocked: summary.blocked, failed: summary.failed },
      };
    }
    return summary;
  }

  // -- Accessors ----------------------------------------------------------

  getCurrentReadyState(): DesktopReadyState | null {
    return this.current;
  }

  async getQueueState(): Promise<QueueState> {
    return this.queue.getState(this.current?.membership.businessId ?? null);
  }

  // -- Internals ----------------------------------------------------------

  private requireReady(): DesktopReadyState {
    if (!this.current) {
      throw new DesktopRuntimeError("Open an active TradeOS business before using desktop commerce.");
    }
    return this.current;
  }

  private async loadCachedCommerce(ready: DesktopReadyState, warning: string): Promise<DesktopCommerceSnapshot> {
    const [catalog, inventory] = await Promise.all([
      this.options.persistence.loadCatalogCache(ready.membership.businessId),
      this.options.persistence.loadInventoryCache(ready.membership.businessId, ready.branch.id),
    ]);
    if (!catalog || !inventory) {
      throw new DesktopRuntimeError("Connect online once to load this branch catalog before selling offline.");
    }
    const fetchedAt = catalog.fetchedAt <= inventory.fetchedAt ? catalog.fetchedAt : inventory.fetchedAt;
    return {
      source: "CACHE",
      fetchedAt,
      warning,
      items: projectSellableItems(catalog.items, inventory.items),
    };
  }

  private async signedOut(): Promise<DesktopBootstrapState> {
    this.current = null;
    return { status: "SIGNED_OUT", queue: await this.queue.getState(null) };
  }
}

// ---------------------------------------------------------------------------
// Commerce projection — UI view model derived from catalog + inventory
// ---------------------------------------------------------------------------

/**
 * Project catalog + inventory into a flat list of sellable items for the POS
 * browser. Mirrors mobile's `projectSellableItems`. Only `(itemId, unitCode)`
 * is server-authoritative; the rest is presentation.
 */
export function projectSellableItems(
  catalog: readonly DesktopCatalogItem[],
  inventory: readonly DesktopInventoryItem[],
): DesktopSellableItem[] {
  const inventoryByItem = new Map(inventory.map((item) => [item.id, item]));
  return catalog.flatMap((item) => item.units
    .filter((unit) => item.active && unit.canSell && unit.defaultSalePriceMinor !== null)
    .map((unit) => ({
      key: `${item.id}:${unit.code}`,
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      kind: item.kind,
      unitCode: unit.code,
      unitLabel: unit.label,
      displayPriceMinor: unit.defaultSalePriceMinor!,
      trackStock: item.trackStock,
      availableStock: item.trackStock ? inventoryByItem.get(item.id)?.available ?? null : null,
    })));
}

/**
 * Add a sellable item to a cart. Returns a new cart (immutable). Mirrors
 * mobile's `addCartItem`.
 */
export function addCartItem(
  cart: readonly DesktopCartLine[],
  item: DesktopSellableItem,
): DesktopCartLine[] {
  assertSellable(item);
  const existing = cart.find((line) => line.key === item.key);
  if (!existing) {
    return [...cart, toCartLine(item, 1)];
  }
  return cart.map((line) => line.key === item.key
    ? { ...line, ...toCartLine(item, line.quantity + 1) }
    : line);
}

export function setCartQuantity(
  cart: readonly DesktopCartLine[],
  key: string,
  quantity: number,
): DesktopCartLine[] {
  assertQuantity(quantity);
  if (!cart.some((line) => line.key === key)) throw new Error("Cart line was not found.");
  return cart.map((line) => line.key === key ? { ...line, quantity } : line);
}

export function removeCartLine(cart: readonly DesktopCartLine[], key: string): DesktopCartLine[] {
  return cart.filter((line) => line.key !== key);
}

/**
 * Display-only cart total in minor units. The server is authoritative; this
 * is a UI preview before the SALE_CREATE mutation is applied.
 */
export function displayCartTotalMinor(cart: readonly DesktopCartLine[]): number {
  return cart.reduce((sum, line) => sum + Math.round(line.displayPriceMinor * line.quantity), 0);
}

function toCartLine(item: DesktopSellableItem, quantity: number): DesktopCartLine {
  return {
    key: item.key,
    itemId: item.itemId,
    saleUnitCode: item.unitCode,
    quantity,
    displayName: item.name,
    displaySku: item.sku,
    displayUnitLabel: item.unitLabel,
    displayPriceMinor: item.displayPriceMinor,
  };
}

function assertQuantity(quantity: number): void {
  if (!Number.isFinite(quantity)) throw new Error("Quantity must be a valid finite number.");
  if (quantity <= 0) throw new Error("Quantity must be greater than zero.");
}

function assertSellable(item: DesktopSellableItem): void {
  if (!item.itemId.trim() || !item.unitCode.trim()) {
    throw new Error("Item and sale unit are required.");
  }
  if (!Number.isSafeInteger(item.displayPriceMinor) || item.displayPriceMinor < 0) {
    throw new Error("Display price must be a non-negative integer in minor currency units.");
  }
}
