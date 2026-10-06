export type SyncMutationStatus = "RECEIVED" | "APPLIED" | "REJECTED";

export interface ClientMutation<TPayload = unknown> {
  clientId: string;
  clientMutationId: string;
  businessId: string;
  branchId?: string;
  mutationType: string;
  occurredAt: string;
  payload: TPayload;
}

export interface MutationResult<TResult = unknown> {
  clientMutationId: string;
  status: SyncMutationStatus;
  serverReceivedAt: string;
  result?: TResult;
  errorCode?: string;
  errorMessage?: string;
}

export interface SyncPushRequest {
  cursor?: string;
  mutations: ClientMutation[];
}

export interface SyncPullEvent<TPayload = unknown> {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: string;
  payload: TPayload;
}

export interface SyncResponse {
  mutationResults: MutationResult[];
  events: SyncPullEvent[];
  nextCursor?: string;
}

/**
 * Offline clients must generate stable mutation ids before local persistence.
 * The server uses (businessId, clientId, clientMutationId) as the idempotency key.
 */
export function mutationIdentity(mutation: ClientMutation): string {
  return `${mutation.businessId}:${mutation.clientId}:${mutation.clientMutationId}`;
}
