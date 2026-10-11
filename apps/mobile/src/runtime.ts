import {
  OfflineMutationQueue,
  type FlushSummary,
  type QueueSnapshotStorage,
  type QueueState,
  type SyncTransport,
} from "@tradeos/client-core/sync-runtime";
import {
  SessionExpiredError,
  type MobileApiClient,
  type MobileBusinessContext,
  type MobileMembership,
  type MobileMe,
  type MobileUser,
} from "./api-client";
import {
  buildSaleMutation,
  projectSellableItems,
  type MobileCartLine,
  type MobileImmediatePaymentMethod,
  type MobileSellableItem,
} from "./pos-model";
import { MobilePersistence } from "./storage";

type RuntimeApi = Pick<
  MobileApiClient,
  "login" | "getMe" | "getBusinessContext" | "getCatalog" | "getInventory" | "push" | "logout"
> & SyncTransport;

export type MobileReadyState = {
  status: "READY";
  user: MobileUser;
  membership: MobileMembership;
  business: MobileBusinessContext["business"];
  branch: MobileBusinessContext["branches"][number];
  queue: QueueState;
};

export type MobileBootstrapState =
  | { status: "SIGNED_OUT"; queue: QueueState }
  | { status: "NEEDS_BUSINESS"; user: MobileUser; queue: QueueState }
  | MobileReadyState;

export type MobileCommerceSnapshot = {
  source: "LIVE" | "CACHE";
  fetchedAt: string;
  warning: string | null;
  items: MobileSellableItem[];
};

export type MobileSaleCaptureResult = {
  clientMutationId: string;
  outcome: "SYNCED" | "PENDING" | "NEEDS_REVIEW";
  queue: QueueState;
  errorCode?: string;
  errorMessage?: string;
};

const saleRoles = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"]);

export type MobileRuntimeOptions = {
  api: RuntimeApi;
  persistence: MobilePersistence;
  queueStorage: QueueSnapshotStorage;
  now: () => string;
  createMutationId: () => string;
};

export class MobileRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileRuntimeError";
  }
}

export class MobileRuntime {
  readonly queue: OfflineMutationQueue;
  private current: MobileReadyState | null = null;

  constructor(private readonly options: MobileRuntimeOptions) {
    this.queue = new OfflineMutationQueue(options.queueStorage, {
      now: options.now,
      createMutationId: options.createMutationId,
    });
  }

  async bootstrap(): Promise<MobileBootstrapState> {
    const session = await this.options.persistence.loadSession();
    if (!session) return this.signedOut();

    let me: MobileMe;
    try {
      me = await this.options.api.getMe();
    } catch (error) {
      if (error instanceof SessionExpiredError) return this.signedOut();
      throw error;
    }

    const memberships = me.memberships.filter((membership) => membership.businessStatus === "ACTIVE");
    if (memberships.length === 0) {
      this.current = null;
      return {
        status: "NEEDS_BUSINESS",
        user: me.user,
        queue: await this.queue.getState(null),
      };
    }

    const saved = await this.options.persistence.loadWorkspaceSelection();
    const membership = memberships.find((candidate) => candidate.businessId === saved?.businessId) ?? memberships[0]!;
    const context = await this.options.api.getBusinessContext(membership.businessId);
    const activeBranches = context.branches.filter((branch) => branch.active);
    const branch = (saved?.businessId === membership.businessId
      ? activeBranches.find((candidate) => candidate.id === saved.branchId)
      : undefined)
      ?? activeBranches.find((candidate) => candidate.code === "MAIN")
      ?? activeBranches[0];

    if (!branch) {
      this.current = null;
      throw new MobileRuntimeError("This TradeOS business has no active branch available on mobile.");
    }

    await this.options.persistence.saveWorkspaceSelection({ businessId: membership.businessId, branchId: branch.id });
    const ready: MobileReadyState = {
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

  async login(identifier: string, password: string): Promise<MobileBootstrapState> {
    await this.options.api.login(identifier, password);
    return this.bootstrap();
  }

  async loadCommerce(online: boolean): Promise<MobileCommerceSnapshot> {
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

  async createSale(
    cart: readonly MobileCartLine[],
    paymentMethod: MobileImmediatePaymentMethod,
    online: boolean,
  ): Promise<MobileSaleCaptureResult> {
    const ready = this.requireReady();
    if (!saleRoles.has(ready.membership.role)) {
      throw new MobileRuntimeError("Your current role does not have permission to create sales.");
    }

    const clientMutationId = this.options.createMutationId();
    const mutation = buildSaleMutation({
      clientId: await this.options.persistence.getOrCreateDeviceKey(),
      clientMutationId,
      businessId: ready.membership.businessId,
      branchId: ready.branch.id,
      currencyCode: ready.business.currencyCode,
      paymentMethod,
      occurredAt: this.options.now(),
      cart,
    });
    const enqueued = await this.queue.enqueue(mutation);
    if (!enqueued) throw new MobileRuntimeError("This sale is already present in the offline queue.");

    if (online) {
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

  getCurrentReadyState(): MobileReadyState | null {
    return this.current;
  }

  async getQueueState(): Promise<QueueState> {
    return this.queue.getState(this.current?.membership.businessId ?? null);
  }

  async logout(): Promise<void> {
    try {
      await this.options.api.logout();
    } finally {
      await this.options.persistence.clearSession();
      this.current = null;
    }
  }

  private requireReady(): MobileReadyState {
    if (!this.current) throw new MobileRuntimeError("Open an active TradeOS business before using mobile commerce.");
    return this.current;
  }

  private async loadCachedCommerce(ready: MobileReadyState, warning: string): Promise<MobileCommerceSnapshot> {
    const [catalog, inventory] = await Promise.all([
      this.options.persistence.loadCatalogCache(ready.membership.businessId),
      this.options.persistence.loadInventoryCache(ready.membership.businessId, ready.branch.id),
    ]);
    if (!catalog || !inventory) {
      throw new MobileRuntimeError("Connect online once to load this branch catalog before selling offline.");
    }
    const fetchedAt = catalog.fetchedAt <= inventory.fetchedAt ? catalog.fetchedAt : inventory.fetchedAt;
    return {
      source: "CACHE",
      fetchedAt,
      warning,
      items: projectSellableItems(catalog.items, inventory.items),
    };
  }

  private async signedOut(): Promise<MobileBootstrapState> {
    this.current = null;
    return { status: "SIGNED_OUT", queue: await this.queue.getState(null) };
  }
}