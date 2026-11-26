import type { BusinessHealthConfidence, BusinessHealthStatus, BusinessInsightEvidence, BusinessInsightSeverity, CfoActionArea, CfoActionPriority } from "./insights.js";
import type { FinancialPeriod } from "./reports.js";

export type BusinessBriefingRange = "today" | "week" | "month";
export type BusinessBriefingDataQuality = "INSUFFICIENT" | "LIMITED" | "ESTABLISHED";

/** Read-only, deterministic decision support sourced from reconciled financial reports.
 * This contract does not represent an LLM prediction or authorization to post transactions.
 */
export interface BusinessBriefing {
  businessId: string;
  branchId: string | null;
  currencyCode: string;
  generatedAt: string;
  period: FinancialPeriod;
  range: BusinessBriefingRange;
  engine: "DETERMINISTIC_HEALTH_V1";
  dataQuality: BusinessBriefingDataQuality;
  dataQualityMessage: string;
  health: {
    status: BusinessHealthStatus;
    score: number | null;
    confidence: BusinessHealthConfidence;
    headline: string;
  };
  metrics: {
    salesCount: number;
    returnCount: number;
    netRevenueMinor: number;
    grossProfitMinor: number;
    expenseMinor: number;
    operatingProfitMinor: number;
    netCashMovementMinor: number;
    cashBalanceMinor: number;
    receivablesMinor: number;
    payablesMinor: number;
  };
  inventorySnapshotAt: string;
  inventorySnapshotAligned: boolean;
  signals: Array<{
    code: string;
    severity: BusinessInsightSeverity;
    title: string;
    message: string;
    evidence: BusinessInsightEvidence[];
  }>;
  actions: Array<{
    code: string;
    priority: CfoActionPriority;
    area: CfoActionArea;
    title: string;
    reason: string;
    action: string;
    href: string;
    evidence: BusinessInsightEvidence[];
  }>;
}
