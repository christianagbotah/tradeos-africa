import type {
  ClientMutation,
  MutationResult,
  SyncPushRequest,
  SyncResponse,
} from "@tradeos/contracts";

export type QueuedMutation<TPayload = unknown> = ClientMutation<TPayload>;

export type FailedMutation<TPayload = unknown, TResult = unknown> = {
  mutation: QueuedMutation<TPayload>;
  result: MutationResult<TResult>;
  failedAt: string;
};

export type { MutationResult, SyncPushRequest, SyncResponse };

export const MAX_SYNC_BATCH_SIZE = 100;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const branchOptionalMutationTypes = new Set([
  "CATALOG_ITEM_CREATE",
  "CATALOG_ITEM_UPDATE",
  "CATALOG_ITEM_ARCHIVE",
  "CATALOG_ITEM_REACTIVATE",
  "CUSTOMER_CREATE",
  "CUSTOMER_UPDATE",
  "SUPPLIER_CREATE",
  "SUPPLIER_UPDATE",
]);

export function isMutationServerReady(
  mutation: Pick<QueuedMutation, "businessId" | "branchId" | "mutationType">,
): boolean {
  if (!uuidPattern.test(mutation.businessId)) return false;
  if (branchOptionalMutationTypes.has(mutation.mutationType)) return true;
  return Boolean(mutation.branchId && uuidPattern.test(mutation.branchId));
}

export type QueueSnapshot = {
  pending: QueuedMutation[];
  failed: FailedMutation[];
};

export interface QueueSnapshotStorage {
  load(): Promise<QueueSnapshot | null>;
  save(snapshot: QueueSnapshot): Promise<void>;
}

export interface QueueRuntimeOptions {
  now(): string;
  createMutationId(): string;
}

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

export interface SyncTransport {
  push(request: SyncPushRequest): Promise<SyncResponse>;
}

export type FlushOptions = {
  activeBusinessId: string | null;
  online: boolean;
  transport: SyncTransport;
};

export class OfflineMutationQueue {
  private inFlight: Promise<FlushSummary> | null = null;
  private storageMutationChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: QueueSnapshotStorage,
    private readonly runtime: QueueRuntimeOptions,
  ) {}

  enqueue(mutation: QueuedMutation): Promise<boolean> {
    return this.withStorageMutation(async () => {
      const snapshot = await this.readSnapshot();
      if (snapshot.pending.some((entry) => entry.clientMutationId === mutation.clientMutationId)) return false;
      snapshot.pending.push(cloneJson(mutation));
      await this.writeSnapshot(snapshot);
      return true;
    });
  }

  async getSnapshot(): Promise<QueueSnapshot> {
    return this.readSnapshot();
  }

  async getState(activeBusinessId: string | null): Promise<QueueState> {
    return queueStateFromSnapshot(await this.readSnapshot(), activeBusinessId);
  }

  retryFailed(clientMutationId: string): Promise<boolean> {
    return this.withStorageMutation(async () => {
      const snapshot = await this.readSnapshot();
      const index = snapshot.failed.findIndex((entry) => entry.mutation.clientMutationId === clientMutationId);
      if (index < 0) return false;

      const [failed] = snapshot.failed.splice(index, 1);
      const replacement: QueuedMutation = {
        ...failed!.mutation,
        clientMutationId: this.runtime.createMutationId(),
        occurredAt: this.runtime.now(),
      };
      snapshot.pending.push(replacement);
      await this.writeSnapshot(snapshot);
      return true;
    });
  }

  dismissFailed(clientMutationId: string): Promise<boolean> {
    return this.withStorageMutation(async () => {
      const snapshot = await this.readSnapshot();
      const nextFailed = snapshot.failed.filter((entry) => entry.mutation.clientMutationId !== clientMutationId);
      if (nextFailed.length === snapshot.failed.length) return false;
      snapshot.failed = nextFailed;
      await this.writeSnapshot(snapshot);
      return true;
    });
  }

  flush(options: FlushOptions): Promise<FlushSummary> {
    if (this.inFlight) return this.inFlight;
    const inFlight = this.performFlush(options).finally(() => {
      if (this.inFlight === inFlight) this.inFlight = null;
    });
    this.inFlight = inFlight;
    return inFlight;
  }

  private async performFlush({ activeBusinessId, online, transport }: FlushOptions): Promise<FlushSummary> {
    const snapshot = await this.readSnapshot();
    if (!online || !activeBusinessId) return emptyFlushSummary(snapshot, activeBusinessId);

    const batch = snapshot.pending
      .filter((mutation) => mutation.businessId === activeBusinessId && isMutationServerReady(mutation))
      .slice(0, MAX_SYNC_BATCH_SIZE);
    if (batch.length === 0) return emptyFlushSummary(snapshot, activeBusinessId);

    const response = await transport.push({ mutations: batch });
    return this.withStorageMutation(async () => {
      const latestSnapshot = await this.readSnapshot();
      const resultsById = new Map(response.mutationResults.map((result) => [result.clientMutationId, result]));
      const batchIds = new Set(batch.map((mutation) => mutation.clientMutationId));
      let applied = 0;
      let received = 0;
      let rejected = 0;

      const nextPending: QueuedMutation[] = [];
      const nextFailed = [...latestSnapshot.failed];

      for (const mutation of latestSnapshot.pending) {
        if (!batchIds.has(mutation.clientMutationId)) {
          nextPending.push(mutation);
          continue;
        }

        const result = resultsById.get(mutation.clientMutationId);
        if (!result || result.status === "RECEIVED") {
          nextPending.push(mutation);
          received += 1;
        } else if (result.status === "APPLIED") {
          applied += 1;
        } else {
          rejected += 1;
          if (!nextFailed.some((entry) => entry.mutation.clientMutationId === mutation.clientMutationId)) {
            nextFailed.push({ mutation, result, failedAt: this.runtime.now() });
          }
        }
      }

      const nextSnapshot = { pending: nextPending, failed: nextFailed };
      await this.writeSnapshot(nextSnapshot);
      return {
        ...queueStateFromSnapshot(nextSnapshot, activeBusinessId),
        applied,
        received,
        rejected,
        attempted: batch.length,
      };
    });
  }

  private withStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.storageMutationChain.then(operation, operation);
    this.storageMutationChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async readSnapshot(): Promise<QueueSnapshot> {
    const snapshot = await this.storage.load();
    return cloneJson(snapshot ?? { pending: [], failed: [] });
  }

  private async writeSnapshot(snapshot: QueueSnapshot): Promise<void> {
    await this.storage.save(cloneJson(snapshot));
  }
}

function queueStateFromSnapshot(snapshot: QueueSnapshot, activeBusinessId: string | null): QueueState {
  return {
    pending: snapshot.pending.length,
    blocked: snapshot.pending.filter((mutation) => (
      !activeBusinessId
      || mutation.businessId !== activeBusinessId
      || !isMutationServerReady(mutation)
    )).length,
    failed: snapshot.failed.length,
  };
}

function emptyFlushSummary(snapshot: QueueSnapshot, activeBusinessId: string | null): FlushSummary {
  return {
    ...queueStateFromSnapshot(snapshot, activeBusinessId),
    applied: 0,
    received: 0,
    rejected: 0,
    attempted: 0,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
