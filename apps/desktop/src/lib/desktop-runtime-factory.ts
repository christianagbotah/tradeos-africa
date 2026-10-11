/**
 * Factory: build a DesktopRuntime wired to the current runtime environment.
 *
 * In browser dev mode, the session store is localStorage-backed and the
 * StringStorage is localStorage-backed. In a Tauri native bundle, both
 * resolve to the Tauri store plugin (loaded lazily).
 *
 * The factory is split out of App.tsx so it can be reused by tests with
 * in-memory backends.
 */

import { DesktopApiClient, getConfiguredApiBaseUrl } from "./desktop-api-client.js";
import { DesktopRuntime, type DesktopRuntimeOptions } from "./desktop-runtime.js";
import {
  AsyncQueueSnapshotStorage,
  DesktopPersistence,
  MemoryStringStorage,
  resolveStringStorage,
  type StringStorage,
} from "./desktop-persistence.js";
import { resolveSessionStore } from "./session-store.js";

export interface DesktopRuntimeFactoryOptions {
  /** Override the API base URL (defaults to getConfiguredApiBaseUrl()). */
  baseUrl?: string;
  /** Override the fetch impl (tests). */
  fetchImpl?: typeof fetch;
  /** Override the platform (defaults to WINDOWS). */
  platform?: "WINDOWS" | "MACOS";
  /** Override the app version (defaults to "0.0.1"). */
  appVersion?: string;
  /** Override the StringStorage backend (tests). */
  stringStorage?: StringStorage;
  /** Override the UUID generator (tests). */
  createUuid?: () => string;
  /** Override `now()` (tests). */
  now?: () => string;
}

/**
 * Build a DesktopRuntime wired to the resolved session store + StringStorage.
 * Returns the runtime + the API client (so the caller can call login/logout
 * directly without going through the runtime).
 */
export async function createDesktopRuntime(opts: DesktopRuntimeFactoryOptions = {}): Promise<{
  runtime: DesktopRuntime;
  apiClient: DesktopApiClient;
}> {
  const baseUrl = opts.baseUrl ?? getConfiguredApiBaseUrl();
  // Async resolution: in Tauri this loads the native store plugin; in browser
  // dev it uses localStorage. Never silently downgrades to localStorage in a
  // Tauri runtime — resolveSessionStore() returns a RefusingSessionStore if
  // the native plugin is missing.
  const sessionStore = await resolveSessionStore();
  const stringStorage = opts.stringStorage ?? resolveStringStorage();
  const apiClient = new DesktopApiClient({
    baseUrl,
    sessionStore,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    platform: opts.platform ?? "WINDOWS",
    appVersion: opts.appVersion ?? "0.0.1",
  });

  const persistence = new DesktopPersistence(
    stringStorage,
    opts.createUuid ?? (() => crypto.randomUUID()),
  );
  const queueStorage = new AsyncQueueSnapshotStorage(stringStorage);

  const runtimeOptions: DesktopRuntimeOptions = {
    api: apiClient,
    persistence,
    queueStorage,
    now: opts.now ?? (() => new Date().toISOString()),
    createMutationId: opts.createUuid ?? (() => crypto.randomUUID()),
  };

  return { runtime: new DesktopRuntime(runtimeOptions), apiClient };
}

/**
 * Build a DesktopRuntime backed by in-memory storage. Used by tests and by
 * the demo-mode preview (so demo mode never touches localStorage).
 */
export function createInMemoryDesktopRuntime(
  apiClient: DesktopApiClient,
  opts: { createUuid?: () => string; now?: () => string } = {},
): DesktopRuntime {
  const stringStorage = new MemoryStringStorage();
  const persistence = new DesktopPersistence(
    stringStorage,
    opts.createUuid ?? (() => "test-uuid-" + Math.random().toString(36).slice(2, 10)),
  );
  const queueStorage = new AsyncQueueSnapshotStorage(stringStorage);
  return new DesktopRuntime({
    api: apiClient,
    persistence,
    queueStorage,
    now: opts.now ?? (() => new Date().toISOString()),
    createMutationId: opts.createUuid ?? (() => "mutation-" + Math.random().toString(36).slice(2, 14)),
  });
}
