export type MasterDataRevision = {
  expectedUpdatedAt: string;
};

export type CatalogMutationType =
  | "CATALOG_ITEM_CREATE"
  | "CATALOG_ITEM_UPDATE"
  | "CATALOG_ITEM_ARCHIVE"
  | "CATALOG_ITEM_REACTIVATE";

export type CustomerCreateInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  creditLimitMinor?: number | null;
  creditTermsDays?: number;
};

export type CustomerUpdateInput = MasterDataRevision & Partial<CustomerCreateInput> & {
  active?: boolean;
};

export type SupplierCreateInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  paymentTermsDays?: number;
};

export type SupplierUpdateInput = MasterDataRevision & Partial<SupplierCreateInput> & {
  active?: boolean;
};

export type ExpenseCategoryCreateInput = {
  name: string;
};

export type ExpenseCategoryUpdateInput = MasterDataRevision & {
  name?: string;
  active?: boolean;
};

export type MoneyAccountCreateInput = {
  branchId?: string | null;
  name: string;
  method: "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";
  kind: "CASH_DRAWER" | "MOMO_WALLET" | "BANK_ACCOUNT" | "CARD_CLEARING" | "OTHER";
  currencyCode?: string;
  provider?: string | null;
  referenceLabel?: string | null;
  allowNegative?: boolean;
};

export type MoneyAccountUpdateInput = MasterDataRevision & {
  name?: string;
  active?: boolean;
  provider?: string | null;
  referenceLabel?: string | null;
  allowNegative?: boolean;
};

export type MoneyAccountDefaultUpdateInput = MasterDataRevision & {
  moneyAccountId: string;
};

export type CustomerMutationType = "CUSTOMER_CREATE" | "CUSTOMER_UPDATE";
export type SupplierMutationType = "SUPPLIER_CREATE" | "SUPPLIER_UPDATE";

export type MasterDataMutationType =
  | CatalogMutationType
  | CustomerMutationType
  | SupplierMutationType;
