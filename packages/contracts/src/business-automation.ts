export type MerchantAlertThreshold = "MEDIUM" | "HIGH" | "CRITICAL";
export type MerchantAutomationState = "WAITING_APPROVAL" | "SUCCEEDED" | "REJECTED" | "CANCELED";

export interface MerchantAutomationPolicy {
  id: string;
  businessId: string;
  branchId: string;
  enabled: boolean;
  minSeverity: MerchantAlertThreshold;
  policyVersion: number;
  approvalRole: "OWNER";
  updatedAt: string;
}
export interface MerchantAutomationRun {
  id: string;
  policyVersion: number;
  state: MerchantAutomationState;
  sourceAttentionId: string;
  title: string;
  summary: string;
  severity: string;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  outputSummary: Record<string, unknown>;
}
export interface MerchantAutomationView {
  businessId: string;
  branchId: string;
  policy: MerchantAutomationPolicy | null;
  pending: MerchantAutomationRun[];
  recent: MerchantAutomationRun[];
  generatedAt: string;
}
export interface MerchantAutomationConfigUpdate {
  enabled: boolean;
  minSeverity: MerchantAlertThreshold;
  /** Null means no policy yet; otherwise prevents a stale device overwriting settings. */
  expectedVersion: number | null;
}
