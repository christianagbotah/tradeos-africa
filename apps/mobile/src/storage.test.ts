import { describe, expect, it } from "vitest";
import {
  AsyncQueueSnapshotStorage,
  MobilePersistence,
  QueueStorageCorruptError,
  type SecureStringStorage,
  type StringStorage,
} from "./storage";

class MemoryStorage implements StringStorage, SecureStringStorage {
  readonly values = new Map<string, string>();
  readonly removed: string[] = [];

  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.removed.push(key); this.values.delete(key); }
}

const tokens = {
  accessToken: "access-secret",
  refreshToken: "refresh-secret",
  accessExpiresAt: "2026-10-10T23:30:00.000Z",
  refreshExpiresAt: "2026-11-10T23:00:00.000Z",
};

const mutation = {
  clientId: "mobile-device-1",
  clientMutationId: "mutation-1",
  businessId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  mutationType: "SALE_CREATE",
  occurredAt: "2026-10-10T22:00:00.000Z",
  payload: { lines: [{ itemId: "item-1", quantity: 1 }] },
};

describe("MobilePersistence", () => {
  it("creates one stable durable mobile device key", async () => {
    const plain = new MemoryStorage();
    const secure = new MemoryStorage();
    let generated = 0;
    const persistence = new MobilePersistence(plain, secure, () => {
      generated += 1;
      return "11111111-1111-4111-8111-111111111111";
    });

    expect(await persistence.getOrCreateDeviceKey()).toBe("mobile-11111111-1111-4111-8111-111111111111");
    expect(await persistence.getOrCreateDeviceKey()).toBe("mobile-11111111-1111-4111-8111-111111111111");
    expect(generated).toBe(1);
  });

  it("persists credentials only through secure storage", async () => {
    const plain = new MemoryStorage();
    const secure = new MemoryStorage();
    const persistence = new MobilePersistence(plain, secure, () => "unused");

    await persistence.saveSession(tokens);

    expect(await persistence.loadSession()).toEqual(tokens);
    expect([...plain.values.values()].join("\n")).not.toContain("access-secret");
    expect([...plain.values.values()].join("\n")).not.toContain("refresh-secret");
    expect([...secure.values.values()].join("\n")).toContain("access-secret");
    expect([...secure.values.values()].join("\n")).toContain("refresh-secret");

    await persistence.clearSession();
    expect(await persistence.loadSession()).toBeNull();
  });

  it("stores and restores only non-secret workspace selection in plain storage", async () => {
    const plain = new MemoryStorage();
    const secure = new MemoryStorage();
    const persistence = new MobilePersistence(plain, secure, () => "unused");
    const selection = {
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
    };

    await persistence.saveWorkspaceSelection(selection);

    expect(await persistence.loadWorkspaceSelection()).toEqual(selection);
    expect([...plain.values.values()].join("\n")).toContain(selection.businessId);
    expect([...secure.values.values()]).toEqual([]);
  });
});

describe("AsyncQueueSnapshotStorage", () => {
  it("returns null for an empty durable queue and round-trips valid snapshots", async () => {
    const plain = new MemoryStorage();
    const storage = new AsyncQueueSnapshotStorage(plain);
    expect(await storage.load()).toBeNull();

    const snapshot = { pending: [mutation], failed: [] };
    await storage.save(snapshot);

    expect(await storage.load()).toEqual(snapshot);
  });

  it("blocks on malformed queue JSON without deleting the stored evidence", async () => {
    const plain = new MemoryStorage();
    plain.values.set("tradeos.mobile.queue.v1", "{not valid json");
    const storage = new AsyncQueueSnapshotStorage(plain);

    await expect(storage.load()).rejects.toBeInstanceOf(QueueStorageCorruptError);
    expect(plain.values.get("tradeos.mobile.queue.v1")).toBe("{not valid json");
    expect(plain.removed).toEqual([]);
  });

  it("blocks on structurally invalid queue data without replacing it", async () => {
    const plain = new MemoryStorage();
    const raw = JSON.stringify({ pending: "lost-sales", failed: [] });
    plain.values.set("tradeos.mobile.queue.v1", raw);
    const storage = new AsyncQueueSnapshotStorage(plain);

    await expect(storage.load()).rejects.toBeInstanceOf(QueueStorageCorruptError);
    expect(plain.values.get("tradeos.mobile.queue.v1")).toBe(raw);
  });
});

describe("MobilePersistence commerce cache", () => {
  const catalogSnapshot = {
    fetchedAt: "2026-10-10T23:45:00.000Z",
    items: [{
      id: "item-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      sku: "CEM-50",
      name: "Cement 50kg",
      kind: "PRODUCT" as const,
      stockUnitCode: "bag",
      trackStock: true,
      taxCategory: null,
      active: true,
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z",
      units: [{ code: "bag", label: "Bag", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 12000 }],
      conversions: [],
    }],
  };
  const inventorySnapshot = {
    fetchedAt: "2026-10-10T23:45:00.000Z",
    items: [{
      id: "item-1", sku: "CEM-50", name: "Cement 50kg", stockUnitCode: "bag",
      available: 28, quarantine: 1, damaged: 0, waste: 0,
      inventoryValueMinor: 280000, averageStockUnitCostMinor: 10000, latestStockUnitCostMinor: 10000,
    }],
  };

  it("scopes catalog cache by business and inventory cache by business+branch", async () => {
    const plain = new MemoryStorage();
    const secure = new MemoryStorage();
    const persistence = new MobilePersistence(plain, secure, () => "unused");

    await persistence.saveCatalogCache("business-a", catalogSnapshot);
    await persistence.saveInventoryCache("business-a", "branch-a", inventorySnapshot);

    expect(await persistence.loadCatalogCache("business-a")).toEqual(catalogSnapshot);
    expect(await persistence.loadCatalogCache("business-b")).toBeNull();
    expect(await persistence.loadInventoryCache("business-a", "branch-a")).toEqual(inventorySnapshot);
    expect(await persistence.loadInventoryCache("business-a", "branch-b")).toBeNull();
    expect(await persistence.loadInventoryCache("business-b", "branch-a")).toBeNull();
  });

  it("fails closed to no cache when commerce read-model JSON is malformed", async () => {
    const plain = new MemoryStorage();
    const secure = new MemoryStorage();
    const persistence = new MobilePersistence(plain, secure, () => "unused");
    plain.values.set("tradeos.mobile.catalog.v1:business-a", "{bad json");
    plain.values.set("tradeos.mobile.inventory.v1:business-a:branch-a", JSON.stringify({ fetchedAt: "bad", items: "nope" }));

    expect(await persistence.loadCatalogCache("business-a")).toBeNull();
    expect(await persistence.loadInventoryCache("business-a", "branch-a")).toBeNull();
  });
});
