/**
 * TradeOS Web — offline mutation queue.
 *
 * Each business owns an independent durable queue snapshot. Switching business
 * changes which queue is visible/flushable; it never deletes another
 * business's unsynced work. This matters on shared/offline devices where a
 * merchant may move between branches or businesses before connectivity returns.
 */

import {
  OfflineMutationQueue,
  type FlushOptions,
  type FlushSummary,
  type QueueSnapshot,
  type QueueSnapshotStorage,
  type QueueState,
  type QueuedMutation,
  type SyncTransport,
} from "@tradeos/client-core/sync-runtime";
import type { SyncPushRequest, SyncResponse } from "@tradeos/contracts";
import { fetchWithSessionRefresh, readApiErrorMessage } from "./auth-fetch";

const LEGACY_STORAGE_KEY = "tradeos.web.mutationQueue.v1";
const STORAGE_KEY_PREFIX = "tradeos.web.mutationQueue.v2.";
const SESSION_KEY = "tradeos.web.session.v1";
const LAST_CONTEXT_KEY = "tradeos.web.lastContext.v1";
const EMPTY_SNAPSHOT: QueueSnapshot = { pending: [], failed: [] };

export class OfflinePersistenceError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Offline mutation persistence failed");
    this.name = "OfflinePersistenceError";
    this.cause = cause;
  }
}

export interface WebSession {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  businessId: string;
  branchId: string;
  staffId: string;
  currencyCode: string;
  timezone: string;
  businessName: string;
  role: string;
  displayName: string;
}

export interface LastWorkspaceContext {
  businessId: string;
  branchId: string;
}

export interface SessionStorage {
  load(): WebSession | null;
  loadLastContext(): LastWorkspaceContext | null;
  save(session: WebSession | null): void;
  clear(): void;
}

// --- business-scoped localStorage queue snapshots -------------------------

function queueKey(businessId: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(businessId)}`;
}

function parseSnapshot(raw: string | null): QueueSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as QueueSnapshot;
    if (!parsed || !Array.isArray(parsed.pending) || !Array.isArray(parsed.failed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Converts the old single-business v1 snapshot into v2 business buckets.
 * The legacy key is removed only after every grouped snapshot is durably
 * written, so quota/storage failures never silently destroy queued work.
 */
function migrateLegacyQueues(): void {
  if (typeof window === "undefined") return;
  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  const legacy = parseSnapshot(raw);
  if (!raw) return;
  if (!legacy) {
    // Corrupt legacy data was already unreadable by the v1 runtime. Removing
    // it avoids repeatedly attempting migration on every queue access.
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return;
  }

  const businessIds = new Set<string>();
  for (const mutation of legacy.pending) businessIds.add(mutation.businessId);
  for (const failed of legacy.failed) businessIds.add(failed.mutation.businessId);

  try {
    for (const businessId of businessIds) {
      const key = queueKey(businessId);
      const existing = parseSnapshot(window.localStorage.getItem(key)) ?? EMPTY_SNAPSHOT;
      const pendingIds = new Set(existing.pending.map((entry) => entry.clientMutationId));
      const failedIds = new Set(existing.failed.map((entry) => entry.mutation.clientMutationId));
      const next: QueueSnapshot = {
        pending: [
          ...existing.pending,
          ...legacy.pending.filter((entry) => entry.businessId === businessId && !pendingIds.has(entry.clientMutationId)),
        ],
        failed: [
          ...existing.failed,
          ...legacy.failed.filter((entry) => entry.mutation.businessId === businessId && !failedIds.has(entry.mutation.clientMutationId)),
        ],
      };
      window.localStorage.setItem(key, JSON.stringify(next));
    }
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    throw new OfflinePersistenceError(error);
  }
}

class LocalStorageQueueStore implements QueueSnapshotStorage {
  constructor(private readonly businessId: string) {}

  async load(): Promise<QueueSnapshot | null> {
    if (typeof window === "undefined") return null;
    migrateLegacyQueues();
    return parseSnapshot(window.localStorage.getItem(queueKey(this.businessId)));
  }

  async save(snapshot: QueueSnapshot): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      migrateLegacyQueues();
      window.localStorage.setItem(queueKey(this.businessId), JSON.stringify(snapshot));
    } catch (error) {
      if (error instanceof OfflinePersistenceError) throw error;
      throw new OfflinePersistenceError(error);
    }
  }

  clear(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(queueKey(this.businessId));
  }
}

// --- localStorage-backed session storage ----------------------------------

class LocalStorageSessionStore implements SessionStorage {
  load(): WebSession | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as WebSession;
      if (!parsed || !parsed.accessToken || !parsed.businessId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  loadLastContext(): LastWorkspaceContext | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(LAST_CONTEXT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LastWorkspaceContext;
      if (!parsed?.businessId || !parsed.branchId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  save(session: WebSession | null): void {
    if (typeof window === "undefined") return;
    try {
      if (session) {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        window.localStorage.setItem(LAST_CONTEXT_KEY, JSON.stringify({
          businessId: session.businessId,
          branchId: session.branchId,
        } satisfies LastWorkspaceContext));
      } else {
        window.localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      // Session persistence remains fail-soft; the active in-memory workspace
      // can continue, while security-sensitive requests still require a token.
    }
  }

  clear(): void {
    if (typeof window === "undefined") return;
    try {
      // Signing out removes credentials only. Business-owned unsynced work is
      // deliberately retained for the next authorized session on this device.
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }
}

// --- Fetch-based sync transport ------------------------------------------

class FetchSyncTransport implements SyncTransport {
  constructor(private readonly sessionStore: SessionStorage) {}

  async push(request: SyncPushRequest): Promise<SyncResponse> {
    const response = await fetchWithSessionRefresh(this.sessionStore, "/v1/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new SyncTransportError(
        response.status,
        await readApiErrorMessage(response, "Sync failed"),
      );
    }
    return (await response.json()) as SyncResponse;
  }
}

export class SyncTransportError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "SyncTransportError";
  }
}

// --- Web offline queue facade --------------------------------------------

export interface WebOfflineQueueDeps {
  now(): string;
  createMutationId(): string;
}

interface BusinessQueueRuntime {
  store: LocalStorageQueueStore;
  queue: OfflineMutationQueue;
}

export class WebOfflineQueue {
  private readonly queues = new Map<string, BusinessQueueRuntime>();
  private readonly transport: FetchSyncTransport;
  private readonly sessionStore: LocalStorageSessionStore;
  private readonly deps: WebOfflineQueueDeps;

  constructor(deps: WebOfflineQueueDeps) {
    this.deps = deps;
    this.sessionStore = new LocalStorageSessionStore();
    this.transport = new FetchSyncTransport(this.sessionStore);
  }

  /** Returns the localStorage-backed session store. */
  get sessions(): SessionStorage {
    return this.sessionStore;
  }

  /** Fetch an authenticated API resource, refreshing an expired access token once. */
  authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetchWithSessionRefresh(this.sessionStore, input, init);
  }

  /** Enqueue into the mutation's own business bucket. */
  enqueue(mutation: QueuedMutation): Promise<boolean> {
    return this.queueFor(mutation.businessId).queue.enqueue(mutation);
  }

  /**
   * Returns one business's durable snapshot. Without an explicit business id,
   * the currently authenticated business is used for backward compatibility.
   */
  getSnapshot(businessId?: string): Promise<QueueSnapshot> {
    const resolved = businessId ?? this.sessionStore.load()?.businessId ?? null;
    if (!resolved) return Promise.resolve({ pending: [], failed: [] });
    return this.queueFor(resolved).queue.getSnapshot();
  }

  /** Returns counts for the active business only. */
  getState(activeBusinessId: string | null): Promise<QueueState> {
    if (!activeBusinessId) return Promise.resolve({ pending: 0, blocked: 0, failed: 0 });
    return this.queueFor(activeBusinessId).queue.getState(activeBusinessId);
  }

  /** Retry a previously-rejected mutation for the current/explicit business. */
  retryFailed(clientMutationId: string, businessId?: string): Promise<boolean> {
    const resolved = businessId ?? this.sessionStore.load()?.businessId ?? null;
    if (!resolved) return Promise.resolve(false);
    return this.queueFor(resolved).queue.retryFailed(clientMutationId);
  }

  /** Dismiss a failed mutation for the current/explicit business. */
  dismissFailed(clientMutationId: string, businessId?: string): Promise<boolean> {
    const resolved = businessId ?? this.sessionStore.load()?.businessId ?? null;
    if (!resolved) return Promise.resolve(false);
    return this.queueFor(resolved).queue.dismissFailed(clientMutationId);
  }

  /** Flush only the authenticated active business. */
  flush(options: { activeBusinessId: string | null; online: boolean }): Promise<FlushSummary> {
    if (!options.activeBusinessId) return Promise.resolve(emptyFlushSummary());
    const session = this.sessionStore.load();
    if (!session || session.businessId !== options.activeBusinessId) {
      return Promise.reject(new Error("Active business does not match the authenticated session."));
    }
    const flushOptions: FlushOptions = {
      activeBusinessId: options.activeBusinessId,
      online: options.online,
      transport: this.transport,
    };
    return this.queueFor(options.activeBusinessId).queue.flush(flushOptions);
  }

  /**
   * Flush from an interactive UI action and surface server REJECTED results.
   * The failed mutation remains in durable storage so the user can retry it.
   */
  async flushOrThrow(options: { activeBusinessId: string | null; online: boolean }): Promise<FlushSummary> {
    if (!options.activeBusinessId) return emptyFlushSummary();
    const runtime = this.queueFor(options.activeBusinessId);
    const before = await runtime.queue.getSnapshot();
    const candidateIds = new Set(before.pending.map((mutation) => mutation.clientMutationId));
    const summary = await this.flush(options);
    if (summary.rejected > 0) {
      const after = await runtime.queue.getSnapshot();
      const failed = after.failed.find((entry) => candidateIds.has(entry.mutation.clientMutationId));
      const message = failed?.result.errorMessage ?? failed?.result.errorCode ?? "The server rejected this change.";
      throw new Error(message);
    }
    return summary;
  }

  /** Explicitly clear one business queue; sign-out does not call this. */
  async clear(businessId?: string): Promise<void> {
    const resolved = businessId ?? this.sessionStore.load()?.businessId ?? null;
    if (!resolved) return;
    this.queueFor(resolved).store.clear();
    this.queues.delete(resolved);
  }

  /** Build a queued mutation with a fresh id and timestamp. */
  build<TPayload>(
    input: {
      businessId: string;
      branchId?: string;
      mutationType: string;
      payload: TPayload;
    },
  ): QueuedMutation<TPayload> {
    const session = this.sessionStore.load();
    const clientId = session?.clientId ?? "web";
    return {
      clientId,
      clientMutationId: this.deps.createMutationId(),
      businessId: input.businessId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      mutationType: input.mutationType,
      occurredAt: this.deps.now(),
      payload: input.payload,
    };
  }

  private queueFor(businessId: string): BusinessQueueRuntime {
    const existing = this.queues.get(businessId);
    if (existing) return existing;
    const store = new LocalStorageQueueStore(businessId);
    const queue = new OfflineMutationQueue(store, {
      now: this.deps.now,
      createMutationId: this.deps.createMutationId,
    });
    const runtime = { store, queue };
    this.queues.set(businessId, runtime);
    return runtime;
  }
}

function emptyFlushSummary(): FlushSummary {
  return { pending: 0, blocked: 0, failed: 0, applied: 0, received: 0, rejected: 0, attempted: 0 };
}

// --- Singleton accessor (client-only) ------------------------------------

let singleton: WebOfflineQueue | null = null;

export function getOfflineQueue(): WebOfflineQueue {
  if (!singleton) {
    singleton = new WebOfflineQueue({
      now: () => new Date().toISOString(),
      createMutationId: () => generateUuid(),
    });
  }
  return singleton;
}

// --- RFC 4122 v4 UUID (no node:crypto dependency, works in browser) ------

export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
