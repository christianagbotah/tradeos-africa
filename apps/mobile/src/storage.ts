import type { QueueSnapshot, QueueSnapshotStorage, QueuedMutation } from "@tradeos/client-core/sync-runtime";
import type { MobileCatalogItem, MobileInventoryItem } from "./api-client";

const DEVICE_KEY = "tradeos.mobile.device.v1";
const SESSION_KEY = "tradeos.mobile.session.v1";
const WORKSPACE_KEY = "tradeos.mobile.workspace.v1";
const QUEUE_KEY = "tradeos.mobile.queue.v1";
const CATALOG_CACHE_PREFIX = "tradeos.mobile.catalog.v1";
const INVENTORY_CACHE_PREFIX = "tradeos.mobile.inventory.v1";

export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SecureStringStorage extends StringStorage {}

export type MobileSessionTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export type WorkspaceSelection = {
  businessId: string;
  branchId: string;
};

export type MobileCatalogCache = {
  fetchedAt: string;
  items: MobileCatalogItem[];
};

export type MobileInventoryCache = {
  fetchedAt: string;
  items: MobileInventoryItem[];
};

export class QueueStorageCorruptError extends Error {
  constructor() {
    super("TradeOS offline queue data is corrupt. The stored data was preserved for recovery.");
    this.name = "QueueStorageCorruptError";
  }
}

export class MobilePersistence {
  constructor(
    private readonly plain: StringStorage,
    private readonly secure: SecureStringStorage,
    private readonly createUuid: () => string,
  ) {}

  async getOrCreateDeviceKey(): Promise<string> {
    const existing = await this.plain.getItem(DEVICE_KEY);
    if (existing?.trim()) return existing;
    const created = `mobile-${this.createUuid()}`;
    await this.plain.setItem(DEVICE_KEY, created);
    return created;
  }

  async loadSession(): Promise<MobileSessionTokens | null> {
    const raw = await this.secure.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSessionTokens(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async saveSession(tokens: MobileSessionTokens): Promise<void> {
    await this.secure.setItem(SESSION_KEY, JSON.stringify(tokens));
  }

  async clearSession(): Promise<void> {
    await this.secure.removeItem(SESSION_KEY);
  }

  async loadWorkspaceSelection(): Promise<WorkspaceSelection | null> {
    const raw = await this.plain.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isWorkspaceSelection(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async saveWorkspaceSelection(selection: WorkspaceSelection): Promise<void> {
    await this.plain.setItem(WORKSPACE_KEY, JSON.stringify(selection));
  }

  async loadCatalogCache(businessId: string): Promise<MobileCatalogCache | null> {
    return readDisposableCache(
      await this.plain.getItem(cacheKey(CATALOG_CACHE_PREFIX, businessId)),
      isCatalogCache,
    );
  }

  async saveCatalogCache(businessId: string, snapshot: MobileCatalogCache): Promise<void> {
    if (!isCatalogCache(snapshot)) throw new Error("Catalog cache snapshot is invalid.");
    await this.plain.setItem(cacheKey(CATALOG_CACHE_PREFIX, businessId), JSON.stringify(snapshot));
  }

  async loadInventoryCache(businessId: string, branchId: string): Promise<MobileInventoryCache | null> {
    return readDisposableCache(
      await this.plain.getItem(cacheKey(INVENTORY_CACHE_PREFIX, businessId, branchId)),
      isInventoryCache,
    );
  }

  async saveInventoryCache(businessId: string, branchId: string, snapshot: MobileInventoryCache): Promise<void> {
    if (!isInventoryCache(snapshot)) throw new Error("Inventory cache snapshot is invalid.");
    await this.plain.setItem(cacheKey(INVENTORY_CACHE_PREFIX, businessId, branchId), JSON.stringify(snapshot));
  }
}

export class AsyncQueueSnapshotStorage implements QueueSnapshotStorage {
  constructor(private readonly plain: StringStorage) {}

  async load(): Promise<QueueSnapshot | null> {
    const raw = await this.plain.getItem(QUEUE_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isQueueSnapshot(parsed)) throw new QueueStorageCorruptError();
      return parsed;
    } catch (error) {
      if (error instanceof QueueStorageCorruptError) throw error;
      throw new QueueStorageCorruptError();
    }
  }

  async save(snapshot: QueueSnapshot): Promise<void> {
    if (!isQueueSnapshot(snapshot)) throw new QueueStorageCorruptError();
    await this.plain.setItem(QUEUE_KEY, JSON.stringify(snapshot));
  }
}

function isSessionTokens(value: unknown): value is MobileSessionTokens {
  if (!isRecord(value)) return false;
  return ["accessToken", "refreshToken", "accessExpiresAt", "refreshExpiresAt"].every(
    (key) => typeof value[key] === "string" && value[key].length > 0,
  );
}

function isWorkspaceSelection(value: unknown): value is WorkspaceSelection {
  return isRecord(value) && typeof value.businessId === "string" && value.businessId.length > 0
    && typeof value.branchId === "string" && value.branchId.length > 0;
}

function isQueueSnapshot(value: unknown): value is QueueSnapshot {
  if (!isRecord(value) || !Array.isArray(value.pending) || !Array.isArray(value.failed)) return false;
  return value.pending.every(isQueuedMutation) && value.failed.every((entry) => {
    if (!isRecord(entry) || !isQueuedMutation(entry.mutation) || typeof entry.failedAt !== "string") return false;
    const result = entry.result;
    return isRecord(result)
      && typeof result.clientMutationId === "string"
      && typeof result.serverReceivedAt === "string"
      && (result.status === "APPLIED" || result.status === "RECEIVED" || result.status === "REJECTED");
  });
}

function isQueuedMutation(value: unknown): value is QueuedMutation {
  if (!isRecord(value)) return false;
  return typeof value.clientId === "string" && value.clientId.length > 0
    && typeof value.clientMutationId === "string" && value.clientMutationId.length > 0
    && typeof value.businessId === "string" && value.businessId.length > 0
    && (value.branchId === undefined || typeof value.branchId === "string")
    && typeof value.mutationType === "string" && value.mutationType.length > 0
    && typeof value.occurredAt === "string" && value.occurredAt.length > 0
    && Object.prototype.hasOwnProperty.call(value, "payload");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cacheKey(prefix: string, ...scope: string[]): string {
  return `${prefix}:${scope.join(":")}`;
}

function readDisposableCache<T>(raw: string | null, validate: (value: unknown) => value is T): T | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCatalogCache(value: unknown): value is MobileCatalogCache {
  return isRecord(value) && isIsoDate(value.fetchedAt) && Array.isArray(value.items) && value.items.every(isCatalogItem);
}

function isInventoryCache(value: unknown): value is MobileInventoryCache {
  return isRecord(value) && isIsoDate(value.fetchedAt) && Array.isArray(value.items) && value.items.every(isInventoryItem);
}

function isCatalogItem(value: unknown): value is MobileCatalogItem {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.businessId !== "string" || typeof value.name !== "string") return false;
  if (!(value.sku === null || typeof value.sku === "string")) return false;
  if (!(value.kind === "PRODUCT" || value.kind === "SERVICE" || value.kind === "PREPARED_PRODUCT")) return false;
  if (!(value.stockUnitCode === null || typeof value.stockUnitCode === "string")) return false;
  if (typeof value.trackStock !== "boolean" || typeof value.active !== "boolean" || !Array.isArray(value.units) || !Array.isArray(value.conversions)) return false;
  return value.units.every((unit) => isRecord(unit)
    && typeof unit.code === "string"
    && typeof unit.label === "string"
    && typeof unit.canPurchase === "boolean"
    && typeof unit.canSell === "boolean"
    && typeof unit.canStock === "boolean"
    && (unit.defaultSalePriceMinor === null || (typeof unit.defaultSalePriceMinor === "number" && Number.isSafeInteger(unit.defaultSalePriceMinor) && unit.defaultSalePriceMinor >= 0)));
}

function isInventoryItem(value: unknown): value is MobileInventoryItem {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.stockUnitCode !== "string") return false;
  if (!(value.sku === null || typeof value.sku === "string")) return false;
  return ["available", "quarantine", "damaged", "waste", "inventoryValueMinor"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))
    && (value.averageStockUnitCostMinor === null || (typeof value.averageStockUnitCostMinor === "number" && Number.isFinite(value.averageStockUnitCostMinor)))
    && (value.latestStockUnitCostMinor === null || (typeof value.latestStockUnitCostMinor === "number" && Number.isFinite(value.latestStockUnitCostMinor)));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
