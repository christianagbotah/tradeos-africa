export type MoneyAccount = {
  id: string;
  branchId: string | null;
  name: string;
  method: string;
  kind: string;
  currencyCode: string;
  provider: string | null;
  referenceLabel: string | null;
  active: boolean;
  allowNegative: boolean;
  balanceMinor: number;
  createdAt: string;
  updatedAt: string;
};

export type MoneyAccountDefault = {
  branchId: string;
  method: string;
  moneyAccountId: string;
  accountName: string;
  updatedAt: string;
};

export type Reconciliation = {
  id: string;
  status: string;
  differenceMinor: number;
  moneyAccountId: string;
  periodEnd: string;
};
