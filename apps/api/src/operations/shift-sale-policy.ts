import type { DatabaseClient } from "../db.js";

export interface BranchShiftSalePolicy {
  required:boolean;
  revision:string|null;
  changedAt:string|null;
}

export async function readBranchShiftSalePolicy(
  client:Pick<DatabaseClient,'query'>,businessId:string,branchId:string,
):Promise<BranchShiftSalePolicy>{
  const row=(await client.query<{
    id:string;required:boolean;effective_at:Date;
  }>(
    `SELECT id,required,effective_at FROM branch_shift_sale_policy_events
     WHERE business_id=$1 AND branch_id=$2
     ORDER BY effective_at DESC,id DESC LIMIT 1`,
    [businessId,branchId],
  )).rows[0];
  return row?{required:row.required,revision:row.id,
    changedAt:row.effective_at.toISOString()}:
    {required:false,revision:null,changedAt:null};
}

/** Validate authenticated staff and the original interval at occurredAt.
 * Closed shifts remain valid for legitimate late offline synchronization.
 */
export async function assertBranchShiftAtSaleTime(
  client:DatabaseClient, input:{
    businessId:string;branchId:string;cashierStaffId:string|undefined;
    occurredAt:string;
  },
):Promise<void>{
  const policy=(await client.query<{required:boolean}>(
    `SELECT required FROM branch_shift_sale_policy_events
     WHERE business_id=$1 AND branch_id=$2 AND effective_at<=$3
     ORDER BY effective_at DESC,id DESC LIMIT 1`,
    [input.businessId,input.branchId,input.occurredAt],
  )).rows[0];
  if(!policy?.required)return;
  if(!input.cashierStaffId)throw new ShiftSalePolicyError(
    "A verified cashier is required for this branch.", "SHIFT_CASHIER_REQUIRED");
  const found=await client.query(
    `SELECT sh.id FROM staff_shifts sh
     JOIN operating_days d ON d.id=sh.operating_day_id
     WHERE sh.business_id=$1 AND sh.branch_id=$2 AND sh.staff_id=$3
       AND d.business_id=$1 AND d.branch_id=$2
       AND sh.opened_at<=$4 AND (sh.closed_at IS NULL OR sh.closed_at>=$4)
       AND d.opened_at<=$4 AND (d.closed_at IS NULL OR d.closed_at>=$4)
     LIMIT 1`,
    [input.businessId,input.branchId,input.cashierStaffId,input.occurredAt],
  );
  if(!found.rowCount)throw new ShiftSalePolicyError(
    "This branch requires a cashier shift covering the sale time. Ask a supervisor to open the day, then open your shift.",
    "SHIFT_REQUIRED_FOR_SALE",
  );
}

export class ShiftSalePolicyError extends Error {
  constructor(message:string,readonly code:string){
    super(message);
  }
}
