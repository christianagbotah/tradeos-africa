/** Shared by web, desktop and mobile offline sync clients. Counts are integer minor units. */
export type ReconciliationMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";
export type OperationsMutationType = "OPERATING_DAY_OPEN_CREATE" | "OPERATING_DAY_CLOSE_CREATE" | "SHIFT_OPEN_CREATE" | "SHIFT_CLOSE_CREATE";
export interface CountedBalance { method: ReconciliationMethod; countedMinor: number }
export interface OperationsMutationPayload { businessDate?: string; dayId?: string; shiftId?: string; note?: string; openingBalances?: CountedBalance[]; closingBalances?: CountedBalance[] }
export interface MethodReconciliation { method: ReconciliationMethod; openingCountedMinor: number; movementMinor: number; expectedClosingMinor: number; closingCountedMinor: number | null; varianceMinor: number | null }
export interface OperationsInterval { id: string; businessId: string; branchId: string; currencyCode: string; status: "OPEN" | "CLOSED"; openedAt: string; closedAt: string | null; note: string | null; openedByStaffId: string; closedByStaffId: string | null; businessDate?: string; operatingDayId?: string; staffId?: string; balances: MethodReconciliation[] }
export interface CurrentOperations { operatingDay: OperationsInterval | null; shift: OperationsInterval | null; openShiftCount: number }
