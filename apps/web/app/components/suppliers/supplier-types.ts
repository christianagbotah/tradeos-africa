export type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  balanceMinor: number;
  paymentTermsDays: number;
  createdAt: string;
  updatedAt: string;
};

export type SupplierObligation = {
  id: string;
  purchaseId: string;
  originalMinor: number;
  openMinor: number;
  issuedAt: string;
  dueAt: string;
};

export type SupplierLedgerEntry = {
  id: string;
  branchId: string;
  currencyCode: string;
  balanceDeltaMinor: number;
  method: string;
  sourceType: string;
  sourceId: string;
  actorStaffId: string;
  occurredAt: string;
};

export type SupplierDetail = {
  supplier: Supplier;
  obligations: SupplierObligation[];
  ledger: SupplierLedgerEntry[];
};

export type SupplierCapabilities = {
  canCreate: boolean;
  canEdit: boolean;
  canChangeStatus: boolean;
  canManageTerms: boolean;
  canPay: boolean;
};

const writeRoles = new Set(["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"]);
const termsRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

export function supplierCapabilities(role: string): SupplierCapabilities {
  const canWrite = writeRoles.has(role);
  const canManageTerms = termsRoles.has(role);
  return {
    canCreate: canWrite,
    canEdit: canWrite,
    canChangeStatus: canWrite,
    canManageTerms,
    canPay: canManageTerms,
  };
}
