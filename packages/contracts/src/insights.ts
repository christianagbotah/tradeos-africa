export type BusinessHealthStatus = "EXCELLENT" | "GOOD" | "WATCH" | "AT_RISK" | "INSUFFICIENT_DATA";
export type BusinessHealthConfidence = "LOW" | "MEDIUM" | "HIGH";
export type BusinessHealthDimensionKey = "PROFITABILITY" | "CASH_FLOW" | "CREDIT" | "INVENTORY" | "SALES_QUALITY";
export type BusinessInsightSeverity = "CRITICAL" | "WARNING" | "OPPORTUNITY" | "POSITIVE" | "INFO";

export interface BusinessHealthMetric {
  key: string;
  label: string;
  value: number | null;
  unit: "PERCENT" | "MONTHS" | "RATIO" | "MINOR" | "COUNT";
}

export interface BusinessHealthDimension {
  key: BusinessHealthDimensionKey;
  label: string;
  weight: number;
  applicable: boolean;
  score: number | null;
  summary: string;
  metrics: BusinessHealthMetric[];
}

export interface BusinessInsightEvidence {
  key: string;
  label: string;
  value: number;
  unit: "PERCENT" | "MONTHS" | "RATIO" | "MINOR" | "COUNT";
}

export interface BusinessInsight {
  code: string;
  severity: BusinessInsightSeverity;
  title: string;
  message: string;
  action: string;
  evidence: BusinessInsightEvidence[];
}

export type WorkingCapitalStatus = "HEALTHY" | "WATCH" | "PRESSURED" | "INSUFFICIENT_DATA";

export interface WorkingCapitalSummary {
  status: WorkingCapitalStatus;
  headline: string;
  inventorySnapshotAligned: boolean;
  cashAfterPayablesMinor: number;
  netTradeCreditMinor: number;
  operatingWorkingCapitalMinor: number | null;
  payableCoverageRatio: number | null;
  receivableMonths: number | null;
  inventoryMonths: number | null;
  operatingCashConversionPercent: number | null;
}

export type CfoActionPriority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";
export type CfoActionArea = "CASH" | "CUSTOMERS" | "INVENTORY" | "SALES" | "EXPENSES" | "PRICING" | "BRANCHES" | "REPORTS";

export interface CfoAction {
  code: string;
  sourceInsightCode: string;
  priority: CfoActionPriority;
  area: CfoActionArea;
  title: string;
  reason: string;
  action: string;
  href: string;
  navigationLabel: string;
  evidence: BusinessInsightEvidence[];
}

export interface BusinessHealthSummary {
  algorithmVersion: "health-v1";
  score: number | null;
  status: BusinessHealthStatus;
  confidence: BusinessHealthConfidence;
  headline: string;
  periodDays: number;
  dimensions: BusinessHealthDimension[];
  insights: BusinessInsight[];
  workingCapital: WorkingCapitalSummary;
  actions: CfoAction[];
}
