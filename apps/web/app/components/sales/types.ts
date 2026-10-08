export type SalePaymentSummary = {
  method: string;
  amountMinor: number;
  status: string;
};

export type SaleSummary = {
  id: string;
  status: string;
  currencyCode: string;
  totalMinor: number;
  refundTotalMinor: number;
  completedAt: string | null;
  createdAt: string;
  customer: { name: string | null; phone: string | null } | null;
  cashierName: string | null;
  payments: SalePaymentSummary[];
};

export type SaleLine = {
  id: string;
  itemId: string;
  itemName: string;
  itemKind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  quantity: number;
  quantityReturned: number;
  quantityReturnable: number;
  saleUnitCode: string;
  unitNetMinor: number;
  unitTaxMinor: number;
  lineTotalMinor: number;
};

export type SaleDetail = {
  id: string;
  businessId: string;
  branchId: string;
  status: string;
  currencyCode: string;
  totalMinor: number;
  completedAt: string | null;
  createdAt: string;
  customer: { id: string; name: string | null; phone: string | null } | null;
  cashierName: string | null;
  lines: SaleLine[];
  payments: Array<{
    id: string;
    method: string;
    amountMinor: number;
    refundedMinor: number;
    status: string;
    providerReference: string | null;
  }>;
};
