export type BusinessQuestionIntent =
  | "SALES" | "PROFIT" | "CASH" | "TOP_ITEMS"
  | "CUSTOMERS_OVERDUE" | "SUPPLIERS_OVERDUE"
  | "REPLENISHMENT" | "UNSUPPORTED";

export interface BusinessQuestionRequest {
  businessId: string;
  branchId?: string;
  question: string;
}
export interface BusinessQuestionFact {
  key: string;
  label: string;
  value: number;
  unit: "MINOR" | "COUNT" | "STOCK_UNITS";
  source: "FINANCIAL_REPORT" | "CREDIT_AGING" | "INVENTORY_REPORT";
}
export interface BusinessQuestionResultItem {
  id: string;
  label: string;
  detail: string;
}
export interface BusinessQuestionResponse {
  businessId: string;
  branchId: string | null;
  question: string;
  intent: BusinessQuestionIntent;
  answer: string;
  currencyCode: string | null;
  generatedAt: string;
  engine: "DETERMINISTIC_GROUNDED_V1";
  dataQuality: "ESTABLISHED" | "LIMITED" | "INSUFFICIENT" | "NOT_APPLICABLE";
  evidence: BusinessQuestionFact[];
  items: BusinessQuestionResultItem[];
  sourcePage: "/reports" | "/customers" | "/suppliers" | "/inventory" | null;
  limitations: string[];
}
