import { describe, expect, it } from "vitest";
import type { SyncPushRequest, SyncResponse } from "@tradeos/client-core/sync-runtime";
import { MobileRuntime } from "./runtime";
import type { MobileBusinessContext, MobileCatalogResponse, MobileInventoryResponse, MobileMe, MobileUser } from "./api-client";
import { addCartItem, projectSellableItems } from "./pos-model";
import { AsyncQueueSnapshotStorage, MobilePersistence, type SecureStringStorage, type StringStorage } from "./storage";

class MemoryStorage implements StringStorage, SecureStringStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

const business1 = "11111111-1111-4111-8111-111111111111";
const branch1 = "22222222-2222-4222-8222-222222222222";
const business2 = "33333333-3333-4333-8333-333333333333";
const branch2 = "44444444-4444-4444-8444-444444444444";
const staleBusiness = "55555555-5555-4555-8555-555555555555";
const staleBranch = "66666666-6666-4666-8666-666666666666";

const user: MobileUser = { id: "user-1", displayName: "Ama Owner", email: "ama@example.com", phoneE164: null };
const session = {
  accessToken: "access",
  refreshToken: "refresh",
  accessExpiresAt: "2026-10-11T00:00:00.000Z",
  refreshExpiresAt: "2026-11-11T00:00:00.000Z",
};

function membership(id: string, businessId: string, businessName: string) {
  return { id, businessId, businessName, businessType: "RETAIL_HARDWARE", businessStatus: "ACTIVE", role: "OWNER", staffId: "staff-1" };
}

const me: MobileMe = {
  user,
  client: { platform: "ANDROID", deviceKey: "mobile-device", appVersion: "0.0.1" },
  memberships: [membership("membership-1", business1, "Ama Shop"), membership("membership-2", business2, "Second Shop")],
};

function context(businessId: string, name: string, branches: MobileBusinessContext["branches"]): MobileBusinessContext {
  return {
    business: { id: businessId, name, businessType: "RETAIL_HARDWARE", countryCode: "GH", currencyCode: "GHS", timezone: "Africa/Accra", status: "ACTIVE" },
    membership: { role: "OWNER", staffId: "staff-1" },
    branches,
  };
}

class FakeApi {
  me: MobileMe = me;
  readonly contexts = new Map<string, MobileBusinessContext>([
    [business1, context(business1, "Ama Shop", [{ id: branch1, name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true }])],
    [business2, context(business2, "Second Shop", [{ id: branch2, name: "Tema", code: "MAIN", timezone: "Africa/Accra", active: true }])],
  ]);
  readonly pushes: SyncPushRequest[] = [];
  catalog: MobileCatalogResponse = { items: [{
    id: "item-1", businessId: business1, sku: "CEM-50", name: "Cement 50kg", kind: "PRODUCT",
    stockUnitCode: "bag", trackStock: true, taxCategory: null, active: true,
    createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z",
    units: [{ code: "bag", label: "Bag", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 12000 }], conversions: [],
  }] };
  inventory: MobileInventoryResponse = { items: [{
    id: "item-1", sku: "CEM-50", name: "Cement 50kg", stockUnitCode: "bag", available: 28, quarantine: 0, damaged: 0, waste: 0,
    inventoryValueMinor: 280000, averageStockUnitCostMinor: 10000, latestStockUnitCostMinor: 10000,
  }] };
  commerceError: Error | null = null;
  pushError: Error | null = null;
  rejectNextPush: { code: string; message: string } | null = null;
  catalogCalls = 0;
  inventoryCalls = 0;
  loginCalls = 0;
  logoutCalls = 0;

  async login(): Promise<MobileUser> { this.loginCalls += 1; return user; }
  async getMe(): Promise<MobileMe> { return this.me; }
  async getBusinessContext(businessId: string): Promise<MobileBusinessContext> {
    const value = this.contexts.get(businessId);
    if (!value) throw new Error(`missing context ${businessId}`);
    return value;
  }
  async getCatalog(): Promise<MobileCatalogResponse> {
    this.catalogCalls += 1;
    if (this.commerceError) throw this.commerceError;
    return this.catalog;
  }
  async getInventory(): Promise<MobileInventoryResponse> {
    this.inventoryCalls += 1;
    if (this.commerceError) throw this.commerceError;
    return this.inventory;
  }
  async push(request: SyncPushRequest): Promise<SyncResponse> {
    this.pushes.push(request);
    if (this.pushError) throw this.pushError;
    const rejection = this.rejectNextPush;
    this.rejectNextPush = null;
    return {
      mutationResults: request.mutations.map((mutation) => rejection ? ({
        clientMutationId: mutation.clientMutationId,
        status: "REJECTED" as const,
        serverReceivedAt: "2026-10-10T22:10:00.000Z",
        errorCode: rejection.code,
        errorMessage: rejection.message,
      }) : ({
        clientMutationId: mutation.clientMutationId,
        status: "APPLIED" as const,
        serverReceivedAt: "2026-10-10T22:10:00.000Z",
      })),
      events: [],
    };
  }
  async logout(): Promise<void> { this.logoutCalls += 1; }
}

function createHarness(api = new FakeApi()) {
  const plain = new MemoryStorage();
  const secure = new MemoryStorage();
  const persistence = new MobilePersistence(plain, secure, () => "77777777-7777-4777-8777-777777777777");
  const queueStorage = new AsyncQueueSnapshotStorage(plain);
  let mutationCounter = 0;
  const runtime = new MobileRuntime({
    api,
    persistence,
    queueStorage,
    now: () => "2026-10-10T22:30:00.000Z",
    createMutationId: () => `retry-${++mutationCounter}`,
  });
  return { api, plain, secure, persistence, queueStorage, runtime };
}

function saleMutation(id: string, businessId: string, branchId: string) {
  return {
    clientId: "mobile-device",
    clientMutationId: id,
    businessId,
    branchId,
    mutationType: "SALE_CREATE",
    occurredAt: "2026-10-10T22:00:00.000Z",
    payload: { lines: [] },
  };
}

describe("MobileRuntime bootstrap", () => {
  it("returns SIGNED_OUT without calling tenant APIs when credentials are absent", async () => {
    const { runtime } = createHarness();
    await expect(runtime.bootstrap()).resolves.toMatchObject({ status: "SIGNED_OUT", queue: { pending: 0, blocked: 0, failed: 0 } });
  });

  it("restores an authorized saved business and active branch", async () => {
    const { runtime, persistence } = createHarness();
    await persistence.saveSession(session);
    await persistence.saveWorkspaceSelection({ businessId: business2, branchId: branch2 });

    const state = await runtime.bootstrap();

    expect(state).toMatchObject({ status: "READY", membership: { businessId: business2 }, branch: { id: branch2 }, business: { id: business2 } });
  });

  it("falls back from a stale business and stale/inactive branch to authorized active MAIN", async () => {
    const api = new FakeApi();
    api.contexts.set(business1, context(business1, "Ama Shop", [
      { id: staleBranch, name: "Old", code: "OLD", timezone: "Africa/Accra", active: false },
      { id: branch1, name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true },
    ]));
    const { runtime, persistence } = createHarness(api);
    await persistence.saveSession(session);
    await persistence.saveWorkspaceSelection({ businessId: staleBusiness, branchId: staleBranch });

    const state = await runtime.bootstrap();

    expect(state).toMatchObject({ status: "READY", membership: { businessId: business1 }, branch: { id: branch1 } });
    expect(await persistence.loadWorkspaceSelection()).toEqual({ businessId: business1, branchId: branch1 });
  });

  it("returns NEEDS_BUSINESS when no active business membership remains", async () => {
    const api = new FakeApi();
    api.me = { ...me, memberships: [{ ...membership("membership-disabled", business1, "Closed Shop"), businessStatus: "SUSPENDED" }] };
    const { runtime, persistence } = createHarness(api);
    await persistence.saveSession(session);

    await expect(runtime.bootstrap()).resolves.toMatchObject({ status: "NEEDS_BUSINESS", user });
  });

  it("login delegates authentication then resolves the ready workspace", async () => {
    const { runtime, persistence, api } = createHarness();
    await persistence.saveSession(session);

    const state = await runtime.login("ama@example.com", "password123");

    expect(api.loginCalls).toBe(1);
    expect(state).toMatchObject({ status: "READY", membership: { businessId: business1 } });
  });
});

describe("MobileRuntime durable sync", () => {
  it("flushes only ready mutations belonging to the active business and no-ops offline", async () => {
    const { runtime, persistence, api } = createHarness();
    await persistence.saveSession(session);
    await runtime.bootstrap();
    await runtime.queue.enqueue(saleMutation("active-1", business1, branch1));
    await runtime.queue.enqueue(saleMutation("other-1", business2, branch2));

    const offline = await runtime.flush(false);
    expect(offline.attempted).toBe(0);
    expect(api.pushes).toHaveLength(0);

    const online = await runtime.flush(true);
    expect(online).toMatchObject({ attempted: 1, applied: 1, pending: 1, blocked: 1 });
    expect(api.pushes).toHaveLength(1);
    expect(api.pushes[0]!.mutations.map((mutation) => mutation.clientMutationId)).toEqual(["active-1"]);
    expect((await runtime.queue.getSnapshot()).pending.map((mutation) => mutation.clientMutationId)).toEqual(["other-1"]);
  });

  it("signs out without deleting pending offline queue evidence", async () => {
    const { runtime, persistence, api } = createHarness();
    await persistence.saveSession(session);
    await runtime.bootstrap();
    await runtime.queue.enqueue(saleMutation("pending-sale", business1, branch1));

    await runtime.logout();

    expect(api.logoutCalls).toBe(1);
    expect((await runtime.queue.getSnapshot()).pending.map((mutation) => mutation.clientMutationId)).toEqual(["pending-sale"]);
    expect((await runtime.bootstrap()).status).toBe("SIGNED_OUT");
  });
});

describe("MobileRuntime commerce", () => {
  async function readyHarness(api = new FakeApi()) {
    const harness = createHarness(api);
    await harness.persistence.saveSession(session);
    await harness.runtime.bootstrap();
    return harness;
  }

  it("loads live catalog and inventory together and persists a last-known cache", async () => {
    const { runtime, persistence, api } = await readyHarness();

    const commerce = await runtime.loadCommerce(true);

    expect(commerce).toMatchObject({ source: "LIVE", fetchedAt: "2026-10-10T22:30:00.000Z" });
    expect(commerce.items).toHaveLength(1);
    expect(commerce.items[0]).toMatchObject({ key: "item-1:bag", availableStock: 28, priceMinor: 12000 });
    expect(api.catalogCalls).toBe(1);
    expect(api.inventoryCalls).toBe(1);
    expect(await persistence.loadCatalogCache(business1)).toMatchObject({ fetchedAt: "2026-10-10T22:30:00.000Z" });
    expect(await persistence.loadInventoryCache(business1, branch1)).toMatchObject({ fetchedAt: "2026-10-10T22:30:00.000Z" });
  });

  it("falls back to cached commerce when an online refresh fails", async () => {
    const api = new FakeApi();
    const { runtime } = await readyHarness(api);
    const live = await runtime.loadCommerce(true);
    api.commerceError = new Error("network down");

    const cached = await runtime.loadCommerce(true);

    expect(cached).toMatchObject({ source: "CACHE", fetchedAt: live.fetchedAt });
    expect(cached.warning).toMatch(/last-known/i);
    expect(cached.items).toHaveLength(1);
  });

  it("uses cache only while offline and explains when no cache exists", async () => {
    const first = await readyHarness();
    await first.runtime.loadCommerce(true);
    first.api.catalogCalls = 0;
    first.api.inventoryCalls = 0;
    const cached = await first.runtime.loadCommerce(false);
    expect(cached.source).toBe("CACHE");
    expect(first.api.catalogCalls).toBe(0);
    expect(first.api.inventoryCalls).toBe(0);

    const second = await readyHarness();
    await expect(second.runtime.loadCommerce(false)).rejects.toThrow(/connect.*once|online.*catalog/i);
  });

  it("durably captures an offline immediate-payment sale with no price fields", async () => {
    const { runtime, api } = await readyHarness();
    const commerce = await runtime.loadCommerce(true);
    const cart = addCartItem([], commerce.items[0]!);
    api.pushes.length = 0;

    const result = await runtime.createSale(cart, "CASH", false);

    expect(result).toMatchObject({ outcome: "PENDING", queue: { pending: 1 } });
    expect(api.pushes).toHaveLength(0);
    const snapshot = await runtime.queue.getSnapshot();
    expect(snapshot.pending).toHaveLength(1);
    expect(snapshot.pending[0]).toMatchObject({ businessId: business1, branchId: branch1, mutationType: "SALE_CREATE" });
    expect(JSON.stringify(snapshot.pending[0])).not.toContain("priceMinor");
    expect(JSON.stringify(snapshot.pending[0])).not.toContain("totalMinor");
  });

  it("flushes an online sale after durable enqueue and reports synchronized", async () => {
    const { runtime, api } = await readyHarness();
    const cart = addCartItem([], projectSellableItems(api.catalog.items, api.inventory.items)[0]!);

    const result = await runtime.createSale(cart, "MOMO", true);

    expect(result).toMatchObject({ outcome: "SYNCED", queue: { pending: 0, failed: 0 } });
    expect(api.pushes).toHaveLength(1);
    expect(api.pushes[0]!.mutations[0]!.payload).toEqual({
      currencyCode: "GHS", paymentMethod: "MOMO", lines: [{ itemId: "item-1", saleUnitCode: "bag", quantity: 1 }],
    });
  });

  it("moves a server-rejected sale to review instead of deleting evidence", async () => {
    const api = new FakeApi();
    api.rejectNextPush = { code: "INSUFFICIENT_STOCK", message: "Stock changed before sync" };
    const { runtime } = await readyHarness(api);
    const cart = addCartItem([], projectSellableItems(api.catalog.items, api.inventory.items)[0]!);

    const result = await runtime.createSale(cart, "CARD", true);

    expect(result).toMatchObject({ outcome: "NEEDS_REVIEW", errorCode: "INSUFFICIENT_STOCK", errorMessage: "Stock changed before sync", queue: { failed: 1 } });
    expect((await runtime.queue.getSnapshot()).failed[0]!.mutation.mutationType).toBe("SALE_CREATE");
  });

  it("keeps a durably captured sale pending when the network fails during flush", async () => {
    const api = new FakeApi();
    api.pushError = new Error("network down");
    const { runtime } = await readyHarness(api);
    const cart = addCartItem([], projectSellableItems(api.catalog.items, api.inventory.items)[0]!);

    const result = await runtime.createSale(cart, "BANK", true);

    expect(result).toMatchObject({ outcome: "PENDING", queue: { pending: 1 } });
    expect((await runtime.queue.getSnapshot()).pending).toHaveLength(1);
  });

  it("blocks checkout for roles that are not sale-capable before queueing", async () => {
    const api = new FakeApi();
    api.me = { ...me, memberships: [{ ...membership("viewer-membership", business1, "Ama Shop"), role: "VIEWER" }] };
    const { runtime } = await readyHarness(api);
    const cart = addCartItem([], projectSellableItems(api.catalog.items, api.inventory.items)[0]!);

    await expect(runtime.createSale(cart, "OTHER", false)).rejects.toThrow(/permission|role/i);
    expect((await runtime.queue.getSnapshot()).pending).toHaveLength(0);
  });
});
