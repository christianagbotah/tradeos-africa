"use client";

export type PendingMutation = {
  clientId: string;
  clientMutationId: string;
  businessId: string;
  branchId?: string;
  mutationType: string;
  occurredAt: string;
  payload: unknown;
};

export type SyncMutationResult = {
  clientMutationId: string;
  status: "RECEIVED" | "APPLIED" | "REJECTED";
  serverReceivedAt: string;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
};

type SyncResponse = {
  mutationResults: SyncMutationResult[];
  events: unknown[];
  nextCursor?: string;
};

export type FailedMutation = {
  mutation: PendingMutation;
  result: SyncMutationResult;
  failedAt: string;
};

export type QueueState = {
  pending: number;
  blocked: number;
  failed: number;
};

export type FlushSummary = QueueState & {
  applied: number;
  received: number;
  rejected: number;
  attempted: number;
};

const pendingKey = "tradeos.pendingMutations.v1";
const failedKey = "tradeos.failedMutations.v1";
const clientIdKey = "tradeos.clientId.v1";
const activeBusinessKey = "tradeos.activeBusinessId.v1";
export const queueChangedEvent = "tradeos:queue-changed";
const maxBatchSize = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let inFlight: Promise<FlushSummary> | null = null;

export function getOrCreateClientId(): string {
  assertBrowser();
  const existing = localStorage.getItem(clientIdKey);
  if (existing) return existing;
  const clientId = `web-${crypto.randomUUID()}`;
  localStorage.setItem(clientIdKey, clientId);
  return clientId;
}

export function setActiveBusinessId(businessId: string | null): void {
  assertBrowser();
  if (businessId) localStorage.setItem(activeBusinessKey, businessId);
  else localStorage.removeItem(activeBusinessKey);
  notifyQueueChanged();
}

export function getActiveBusinessId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(activeBusinessKey);
}

export function enqueueMutation(mutation: PendingMutation): void {
  assertBrowser();
  const pending = readJson<PendingMutation[]>(pendingKey, []);
  if (!pending.some((item) => item.clientMutationId === mutation.clientMutationId)) {
    pending.push(mutation);
    localStorage.setItem(pendingKey, JSON.stringify(pending));
    notifyQueueChanged();
  }
}

export function getQueueState(): QueueState {
  if (typeof window === "undefined") return { pending: 0, blocked: 0, failed: 0 };
  const pending = readJson<PendingMutation[]>(pendingKey, []);
  const activeBusinessId = getActiveBusinessId();
  return {
    pending: pending.length,
    blocked: pending.filter((mutation) => !isServerReady(mutation) || !activeBusinessId || mutation.businessId !== activeBusinessId).length,
    failed: readJson<FailedMutation[]>(failedKey, []).length,
  };
}

export function getFailedMutations(): FailedMutation[] {
  if (typeof window === "undefined") return [];
  return readJson<FailedMutation[]>(failedKey, []);
}

export function retryFailedMutation(clientMutationId: string): boolean {
  assertBrowser();
  const failed = readJson<FailedMutation[]>(failedKey, []);
  const found = failed.find((entry) => entry.mutation.clientMutationId === clientMutationId);
  if (!found) return false;
  const replacement: PendingMutation = {
    ...found.mutation,
    clientMutationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
  };
  localStorage.setItem(failedKey, JSON.stringify(failed.filter((entry) => entry !== found)));
  enqueueMutation(replacement);
  notifyQueueChanged();
  return true;
}

export function dismissFailedMutation(clientMutationId: string): void {
  assertBrowser();
  const failed = readJson<FailedMutation[]>(failedKey, []);
  localStorage.setItem(
    failedKey,
    JSON.stringify(failed.filter((entry) => entry.mutation.clientMutationId !== clientMutationId)),
  );
  notifyQueueChanged();
}

export function flushPendingMutations(): Promise<FlushSummary> {
  if (inFlight) return inFlight;
  inFlight = performFlush().finally(() => { inFlight = null; });
  return inFlight;
}

async function performFlush(): Promise<FlushSummary> {
  if (typeof window === "undefined" || !navigator.onLine) return emptySummary();

  const activeBusinessId = getActiveBusinessId();
  if (!activeBusinessId) return emptySummary();

  const allPending = readJson<PendingMutation[]>(pendingKey, []);
  const batch = allPending
    .filter((mutation) => mutation.businessId === activeBusinessId && isServerReady(mutation))
    .slice(0, maxBatchSize);
  if (batch.length === 0) return emptySummary();

  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutations: batch }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Sync endpoint returned HTTP ${response.status}`);

  const body = (await response.json()) as SyncResponse;
  if (!Array.isArray(body.mutationResults)) throw new Error("Sync endpoint returned an invalid response");

  const byId = new Map(body.mutationResults.map((result) => [result.clientMutationId, result]));
  const failed = readJson<FailedMutation[]>(failedKey, []);
  const batchIds = new Set(batch.map((mutation) => mutation.clientMutationId));
  const remaining: PendingMutation[] = allPending.filter((mutation) => !batchIds.has(mutation.clientMutationId));
  let applied = 0;
  let received = 0;
  let rejected = 0;

  for (const mutation of batch) {
    const result = byId.get(mutation.clientMutationId);
    if (!result || result.status === "RECEIVED") {
      remaining.push(mutation);
      received += 1;
    } else if (result.status === "APPLIED") {
      applied += 1;
    } else {
      rejected += 1;
      if (!failed.some((entry) => entry.mutation.clientMutationId === mutation.clientMutationId)) {
        failed.push({ mutation, result, failedAt: new Date().toISOString() });
      }
    }
  }

  localStorage.setItem(pendingKey, JSON.stringify(remaining));
  localStorage.setItem(failedKey, JSON.stringify(failed));
  notifyQueueChanged();

  return { ...getQueueState(), applied, received, rejected, attempted: batch.length };
}

function isServerReady(mutation: PendingMutation): boolean {
  return uuidPattern.test(mutation.businessId) && Boolean(mutation.branchId && uuidPattern.test(mutation.branchId));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function emptySummary(): FlushSummary {
  const state = typeof window === "undefined" ? { pending: 0, blocked: 0, failed: 0 } : getQueueState();
  return { ...state, applied: 0, received: 0, rejected: 0, attempted: 0 };
}

function notifyQueueChanged(): void {
  window.dispatchEvent(new CustomEvent(queueChangedEvent));
}

function assertBrowser(): void {
  if (typeof window === "undefined") throw new Error("Offline queue is only available in the browser");
}
