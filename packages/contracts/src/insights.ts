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

export interface BusinessHealthSummary {
  algorithmVersion: "health-v1";
  score: number | null;
  status: BusinessHealthStatus;
  confidence: BusinessHealthConfidence;
  headline: string;
  periodDays: number;
  dimensions: BusinessHealthDimension[];
  insights: BusinessInsight[];
}
