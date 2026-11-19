import type { QueuedMutation } from "@tradeos/client-core/sync-runtime";
import type { WebOfflineQueue } from "./offline-sync";

export type MutationTarget = {
  businessId: string;
  branchId: string;
  mutationTypes: readonly string[];
  targetField: string;
  targetId: string;
};

export class PendingMutationConfirmationError extends Error {
  readonly code = "MUTATION_AWAITING_CONFIRMATION";
  constructor(readonly mutationId: string, readonly existing: boolean) {
    super(existing
      ? "A transaction for this record is already queued and awaiting server confirmation. Do not submit another. Check Sync status; the original transaction will retry automatically."
      : "Your transaction is safely queued but the server has not confirmed it as applied. Do not submit it again. Check Sync status; it will retry when possible.");
    this.name = "PendingMutationConfirmationError";
  }
}

function matchesTarget(mutation: QueuedMutation, target: MutationTarget): boolean {
  if (mutation.businessId !== target.businessId ||
      mutation.branchId !== target.branchId ||
      !target.mutationTypes.includes(mutation.mutationType)) return false;
  const payload = mutation.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as Record<string, unknown>)[target.targetField] === target.targetId;
}

export function findPendingTarget(
  pending: readonly QueuedMutation[], target: MutationTarget,
): QueuedMutation | undefined {
  return pending.find((entry) => matchesTarget(entry, target));
}

/**
 * Persist and post an operation exactly once. Closing the financial form and
 * refreshing posted totals is permitted only once the queue has removed THIS
 * mutation as APPLIED, not merely when another mutation was APPLIED or when
 * this mutation was RECEIVED. No local financial balances are invented.
 */
export async function enqueueAndConfirmMutation(
  queue: WebOfflineQueue,
  mutation: QueuedMutation,
  target: MutationTarget,
  online: boolean,
  previousPendingMutationId: string | null = null,
): Promise<void> {
  if (!matchesTarget(mutation, target)) throw new Error("Mutation scope does not match the selected record.");
  const before = await queue.getSnapshot(target.businessId);
  const earlierFailure = previousPendingMutationId
    ? before.failed.find((entry) => entry.mutation.clientMutationId === previousPendingMutationId)
    : null;
  if (earlierFailure) {
    throw new Error(earlierFailure.result.errorMessage ??
      earlierFailure.result.errorCode ?? "The previous transaction was rejected.");
  }
  if (previousPendingMutationId) {
    const earlierPending = before.pending.find((entry) => entry.clientMutationId === previousPendingMutationId);
    if (!earlierPending) {
      // The same persisted mutation was APPLIED by background sync while the
      // dialog stayed open. Do not create a second correction on retry.
      return;
    }
    if (!matchesTarget(earlierPending, target)) {
      throw new Error("The pending transaction belongs to a different record or branch.");
    }
  } else {
    const alreadyPending = findPendingTarget(before.pending, target);
    if (alreadyPending) throw new PendingMutationConfirmationError(alreadyPending.clientMutationId, true);

    const enqueued = await queue.enqueue(mutation);
    if (!enqueued) throw new Error("This transaction is already in the queue.");
  }
  const checkedMutationId = previousPendingMutationId ?? mutation.clientMutationId;

  let flushError: unknown = null;
  try {
    await queue.flushOrThrow({ activeBusinessId: target.businessId, online });
  } catch (error) {
    flushError = error;
  }

  const after = await queue.getSnapshot(target.businessId);
  const failed = after.failed.find((entry) =>
    entry.mutation.clientMutationId === checkedMutationId);
  if (failed) {
    throw new Error(failed.result.errorMessage ??
      failed.result.errorCode ?? "The server rejected this transaction.");
  }

  // A pending mutation MUST NOT produce a 'completed' result or close the form.
  if (after.pending.some((entry) => entry.clientMutationId === checkedMutationId)) {
    throw new PendingMutationConfirmationError(checkedMutationId, false);
  }
  if (flushError) {
    // A different operation in the batch may have been rejected, while this
    // one was confirmed. A removed mutation is APPLIED in the core queue.
    // Do not blindly resend it or mistake a batch-level error for failure.
    return;
  }
}
