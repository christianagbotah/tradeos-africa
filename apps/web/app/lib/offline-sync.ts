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
export const queueChangedEvent = "tradeos:queue-changed";
const maxBatchSize = 100;

let inFlight: Promise<FlushSummary> | null = null;

export function getOrCreateClientId(): string {
  assertBrowser();
  const existing = localStorage.getItem(clientIdKey);
  if (existing) return existing;
  const clientId = `web-${crypto.randomUUID()}`;
  localStorage.setItem(clientIdKey, clientId);
  return clientId;
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
  if (typeof window === "undefined") return { pending: 0, failed: 0 };
  return {
    pending: readJson<PendingMutation[]>(pendingKey, []).length,
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

  // Retrying the exact same rejected id would only replay the durable REJECTED result.
  // A user-approved retry therefore receives a fresh id while preserving the economic payload.
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
  inFlight = performFlush().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function performFlush(): Promise<FlushSummary> {
  if (typeof window === "undefined" || !navigator.onLine) return emptySummary();

  const allPending = readJson<PendingMutation[]>(pendingKey, []);
  if (allPending.length === 0) return emptySummary();

  const batch = allPending.slice(0, maxBatchSize);
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutations: batch }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Sync endpoint returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as SyncResponse;
  if (!Array.isArray(body.mutationResults)) throw new Error("Sync endpoint returned an invalid response");

  const byId = new Map(body.mutationResults.map((result) => [result.clientMutationId, result]));
  const failed = readJson<FailedMutation[]>(failedKey, []);
  const remainingBatch: PendingMutation[] = [];
  let applied = 0;
  let received = 0;
  let rejected = 0;

  for (const mutation of batch) {
    const result = byId.get(mutation.clientMutationId);
    if (!result || result.status === "RECEIVED") {
      remainingBatch.push(mutation);
      received += 1;
      continue;
    }

    if (result.status === "APPLIED") {
      applied += 1;
      continue;
    }

    rejected += 1;
    if (!failed.some((entry) => entry.mutation.clientMutationId === mutation.clientMutationId)) {
      failed.push({ mutation, result, failedAt: new Date().toISOString() });
    }
  }

  const remainder = allPending.slice(batch.length);
  localStorage.setItem(pendingKey, JSON.stringify([...remainingBatch, ...remainder]));
  localStorage.setItem(failedKey, JSON.stringify(failed));
  notifyQueueChanged();

  const state = getQueueState();
  return {
    ...state,
    applied,
    received,
    rejected,
    attempted: batch.length,
  };
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
  const state = typeof window === "undefined" ? { pending: 0, failed: 0 } : getQueueState();
  return { ...state, applied: 0, received: 0, rejected: 0, attempted: 0 };
}

function notifyQueueChanged(): void {
  window.dispatchEvent(new CustomEvent(queueChangedEvent));
}

function assertBrowser(): void {
  if (typeof window === "undefined") throw new Error("Offline queue is only available in the browser");
}
