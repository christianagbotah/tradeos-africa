export type BusinessActionState = "OPEN" | "DONE" | "SNOOZED" | "CANCELED";

export interface BusinessActionItem {
  id: string;
  businessId: string;
  branchId: string | null;
  title: string;
  reason: string;
  state: BusinessActionState;
  assignedUserId: string | null;
  dueAt: string | null;
  sourceAttentionId: string | null;
  sourceAutomationRunId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BusinessActionListResponse {
  businessId: string;
  branchId: string | null;
  generatedAt: string;
  items: BusinessActionItem[];
  /** Number newly created by the current explicit Generate request. */
  createdCount?: number;
}
export interface BusinessActionTransition {
  state: BusinessActionState;
  /** Mandatory optimistic concurrency check. */
  expectedState: BusinessActionState;
}
