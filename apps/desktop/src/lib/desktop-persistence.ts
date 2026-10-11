/**
 * Desktop persistence layer.
 *
 * Wraps the offline queue + workspace selection + commerce cache (catalog /
 * inventory) over a `StringStorage` backend. In browser dev mode the backend
 * is `localStorage`; in a Tauri native bundle it is the Tauri store plugin
 * (loaded lazily by session-store.ts).
 *
 * This module is the desktop analogue of `apps/mobile/src/storage.ts`. The
 * queue storage implements `QueueSnapshotStorage` from
 * `@tradeos/client-core/sync-runtime` so the canonical `OfflineMutationQueue`
 * can drive durable sync.
 */

import type {
  QueueSnapshot,
  QueueSnapshotStorage,
  QueuedMutation,
} from "@tradeos/client-core/sync-runtime";
import type {
  DesktopCatalogItem,
  DesktopInventoryItem,
} from "./desktop-api-client.js";

/** Async string storage interface (mirrors mobile's StringStorage). */
export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const DEVICE_KEY = "tradeos.desktop.device.v1";
const WORKSPACE_KEY = "tradeos.desktop.workspace.v1";
const QUEUE_KEY = "tradeos.desktop.queue.v1";
const CATALOG_CACHE_PREFIX = "tradeos.desktop.catalog.v1";
const INVENTORY_CACHE_PREFIX = "tradeos.desktop.inventory.v1";

/** Workspace selection — active business + branch. */
export interface WorkspaceSelection {
  businessId: string;
  branchId: string;
}

/** Catalog cache snapshot for offline commerce projection. */
export interface DesktopCatalogCache {
  fetchedAt: string;
  items: DesktopCatalogItem[];
}

/** Inventory cache snapshot for offline commerce projection. */
export interface DesktopInventoryCache {
  fetchedAt: string;
  items: DesktopInventoryItem[];
}

/** Error thrown when the offline queue data is corrupt on disk. */
export class QueueStorageCorruptError extends Error {
  constructor() {
    super("TradeOS desktop offline queue data is corrupt. The stored data was preserved for recovery.");
    this.name = "QueueStorageCorruptError";
  }
}

/** Desktop persistence — device key, workspace selection, commerce cache. */
export class DesktopPersistence {
  constructor(
    private readonly plain: StringStorage,
    private readonly createUuid: () => string,
  ) {}

  async getOrCreateDeviceKey(): Promise<string> {
    const existing = await this.plain.getItem(DEVICE_KEY);
    if (existing?.trim()) return existing;
    const created = `desktop-${this.createUuid()}`;
    await this.plain.setItem(DEVICE_KEY, created);
    return created;
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

  async clearWorkspaceSelection(): Promise<void> {
    await this.plain.removeItem(WORKSPACE_KEY);
  }

  async loadCatalogCache(businessId: string): Promise<DesktopCatalogCache | null> {
    return readDisposableCache(await this.plain.getItem(cacheKey(CATALOG_CACHE_PREFIX, businessId)), isCatalogCache);
  }

  async saveCatalogCache(businessId: string, snapshot: DesktopCatalogCache): Promise<void> {
    if (!isCatalogCache(snapshot)) throw new Error("Catalog cache snapshot is invalid.");
    await this.plain.setItem(cacheKey(CATALOG_CACHE_PREFIX, businessId), JSON.stringify(snapshot));
  }

  async loadInventoryCache(businessId: string, branchId: string): Promise<DesktopInventoryCache | null> {
    return readDisposableCache(
      await this.plain.getItem(cacheKey(INVENTORY_CACHE_PREFIX, businessId, branchId)),
      isInventoryCache,
    );
  }

  async saveInventoryCache(businessId: string, branchId: string, snapshot: DesktopInventoryCache): Promise<void> {
    if (!isInventoryCache(snapshot)) throw new Error("Inventory cache snapshot is invalid.");
    await this.plain.setItem(cacheKey(INVENTORY_CACHE_PREFIX, businessId, branchId), JSON.stringify(snapshot));
  }
}

/** QueueSnapshotStorage implementation backed by a StringStorage. */
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

// ---------------------------------------------------------------------------
// localStorage-backed StringStorage (browser dev mode)
// ---------------------------------------------------------------------------

/** StringStorage backed by `window.localStorage`. Browser dev mode only. */
export class LocalStorageStringStorage implements StringStorage {
  constructor(private readonly storage: Storage) {}

  async getItem(key: string): Promise<string | null> {
    return this.storage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.storage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.storage.removeItem(key);
  }
}

/** Resolve the best available StringStorage for the current runtime. */
export function resolveStringStorage(): StringStorage {
  if (typeof window !== "undefined" && window.localStorage) {
    return new LocalStorageStringStorage(window.localStorage);
  }
  return new MemoryStringStorage();
}

/** In-memory StringStorage fallback (tests, SSR, no-DOM environments). */
export class MemoryStringStorage implements StringStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkspaceSelection(value: unknown): value is WorkspaceSelection {
  return isRecord(value)
    && typeof value.businessId === "string" && value.businessId.length > 0
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

function readDisposableCache<T>(raw: string | null, validate: (value: unknown) => value is T): T | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCatalogCache(value: unknown): value is DesktopCatalogCache {
  return isRecord(value) && isIsoDate(value.fetchedAt) && Array.isArray(value.items);
}

function isInventoryCache(value: unknown): value is DesktopInventoryCache {
  return isRecord(value) && isIsoDate(value.fetchedAt) && Array.isArray(value.items);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function cacheKey(prefix: string, ...scope: string[]): string {
  return `${prefix}:${scope.join(":")}`;
}
