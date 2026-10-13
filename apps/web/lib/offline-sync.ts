/**
 * TradeOS Web — offline mutation queue.
 *
 * Wraps the shared `OfflineMutationQueue` from `@tradeos/client-core/sync-runtime`
 * with a localStorage-backed snapshot store and a fetch-based transport that
 * posts mutations to the server-authoritative `/v1/sync` endpoint through the
 * Caddy gateway (relative path, no port in the URL).
 *
 * The queue is single-business by design: it stores mutations for the
 * currently-authenticated business. On sign-in we read the queue snapshot,
 * on sign-out we clear it. This matches the mobile/desktop clients.
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

const STORAGE_KEY = "tradeos.web.mutationQueue.v1";
const SESSION_KEY = "tradeos.web.session.v1";

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

export interface SessionStorage {
  load(): WebSession | null;
  save(session: WebSession | null): void;
  clear(): void;
}

// --- localStorage-backed queue snapshot storage ----------------------------

class LocalStorageQueueStore implements QueueSnapshotStorage {
  async load(): Promise<QueueSnapshot | null> {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as QueueSnapshot;
      if (!parsed || !Array.isArray(parsed.pending) || !Array.isArray(parsed.failed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async save(snapshot: QueueSnapshot): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      // A mutation is only safely queued once the durable snapshot is written.
      // Surface persistence failures so callers never report a mutation as
      // queued when a reload could silently lose it.
      throw new OfflinePersistenceError(error);
    }
  }

  clear(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(STORAGE_KEY);
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

  save(session: WebSession | null): void {
    if (typeof window === "undefined") return;
    try {
      if (session) {
        const previous = this.load();
        if (!previous || previous.businessId !== session.businessId) {
          // Queue snapshots are business-scoped. Never carry offline work into
          // a different authenticated business (or an orphaned new session).
          window.localStorage.removeItem(STORAGE_KEY);
        }
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } else {
        window.localStorage.removeItem(SESSION_KEY);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }

  clear(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

// --- Fetch-based sync transport ------------------------------------------

interface FetchTransportOptions {
  /** Returns the current access token, or null if signed out. */
  getToken(): string | null;
}

class FetchSyncTransport implements SyncTransport {
  constructor(private readonly options: FetchTransportOptions) {}

  async push(request: SyncPushRequest): Promise<SyncResponse> {
    const token = this.options.getToken();
    if (!token) {
      throw new Error("Not authenticated");
    }
    const response = await fetch("/v1/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new SyncTransportError(response.status, text || response.statusText);
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

export class WebOfflineQueue {
  private readonly queue: OfflineMutationQueue;
  private readonly store: LocalStorageQueueStore;
  private readonly transport: FetchSyncTransport;
  private readonly sessionStore: LocalStorageSessionStore;
  private readonly deps: WebOfflineQueueDeps;

  constructor(deps: WebOfflineQueueDeps) {
    this.deps = deps;
    this.store = new LocalStorageQueueStore();
    this.sessionStore = new LocalStorageSessionStore();
    this.transport = new FetchSyncTransport({
      getToken: () => this.sessionStore.load()?.accessToken ?? null,
    });
    this.queue = new OfflineMutationQueue(this.store, {
      now: deps.now,
      createMutationId: deps.createMutationId,
    });
  }

  /** Returns the localStorage-backed session store. */
  get sessions(): SessionStorage {
    return this.sessionStore;
  }

  /** Enqueue a mutation. Returns true if added, false if duplicate. */
  enqueue(mutation: QueuedMutation): Promise<boolean> {
    return this.queue.enqueue(mutation);
  }

  /** Returns the current queue snapshot (pending + failed). */
  getSnapshot(): Promise<QueueSnapshot> {
    return this.queue.getSnapshot();
  }

  /** Returns counts of pending/blocked/failed mutations for the active business. */
  getState(activeBusinessId: string | null): Promise<QueueState> {
    return this.queue.getState(activeBusinessId);
  }

  /** Retry a previously-rejected mutation with a fresh id. */
  retryFailed(clientMutationId: string): Promise<boolean> {
    return this.queue.retryFailed(clientMutationId);
  }

  /** Dismiss a failed mutation (give up). */
  dismissFailed(clientMutationId: string): Promise<boolean> {
    return this.queue.dismissFailed(clientMutationId);
  }

  /** Flush pending mutations to the server. No-op if offline or no business. */
  flush(options: { activeBusinessId: string | null; online: boolean }): Promise<FlushSummary> {
    const flushOptions: FlushOptions = {
      activeBusinessId: options.activeBusinessId,
      online: options.online,
      transport: this.transport,
    };
    return this.queue.flush(flushOptions);
  }

  /** Clear all queued mutations (used on sign-out / business switch). */
  async clear(): Promise<void> {
    this.store.clear();
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
    const mutation: QueuedMutation<TPayload> = {
      clientId,
      clientMutationId: this.deps.createMutationId(),
      businessId: input.businessId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      mutationType: input.mutationType,
      occurredAt: this.deps.now(),
      payload: input.payload,
    };
    return mutation;
  }
}

// --- Singleton accessor (client-only) ------------------------------------

let singleton: WebOfflineQueue | null = null;

/**
 * Returns the shared web offline queue. Must only be called from client code
 * (it touches `window.localStorage` lazily inside the store, so creating the
 * singleton on the server is safe — but using it is not).
 */
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
  // Minimal RFC 4122 v4 fallback.
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
