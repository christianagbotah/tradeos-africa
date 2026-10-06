import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { withTransaction, type DatabasePool, type DatabaseClient } from "./db.js";
import { CashbookError } from "./commerce/cashbook.js";
import { signedMinor } from "./commerce/valuation.js";
const roles: readonly BusinessRole[] = ["OWNER","ADMIN","MANAGER","CASHIER","ACCOUNTANT","VIEWER"];
function uuid(value: unknown, name: string): string {
  if (typeof value!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new CashbookError(`${name} must be a UUID`);
  return value;
}
async function detail(client: DatabaseClient, row: Record<string,any>, shift: boolean) {
  const kind=shift ? "staff_shift" : "operating_day";
  const balances=(await client.query(`SELECT * FROM ${kind}_method_balances WHERE ${kind}_id=$1 ORDER BY method`,[row.id])).rows.map(b=>({method:b.method,openingCountedMinor:signedMinor(Number(b.opening_counted_minor)),movementMinor:signedMinor(Number(b.movement_minor)),expectedClosingMinor:signedMinor(Number(b.expected_closing_minor)),closingCountedMinor:b.closing_counted_minor===null ? null : signedMinor(Number(b.closing_counted_minor)),varianceMinor:b.variance_minor===null ? null : signedMinor(Number(b.variance_minor))}));
  return {id:row.id,businessId:row.business_id,branchId:row.branch_id,currencyCode:row.currency_code,status:row.status,openedAt:row.opened_at.toISOString(),closedAt:row.closed_at?.toISOString() ?? null,note:row.note,openedByStaffId:row.opened_by_staff_id,closedByStaffId:row.closed_by_staff_id,...(shift ? {operatingDayId:row.operating_day_id,staffId:row.staff_id} : {businessDate:row.business_date instanceof Date ? row.business_date.toISOString().slice(0,10) : row.business_date}),balances};
}
export function registerOperationsRoutes(app: FastifyInstance,pool: DatabasePool) {
  for (const resource of ["current","days","shifts"] as const) app.get<{Querystring:{businessId?:string;branchId?:string;dayId?:string;limit?:string}}>(`/v1/operations/${resource}`,async(request,reply)=>{
    try {
      const auth=await authenticateAccessToken(pool,request.headers.authorization);
      const businessId=uuid(request.query.businessId,"businessId"),branchId=uuid(request.query.branchId,"branchId");
      const access=await requireBusinessRole(pool,auth,businessId,roles);
      if (!(await pool.query(`SELECT id FROM branches WHERE business_id=$1 AND id=$2 AND is_active=true`,[businessId,branchId])).rowCount) throw new CashbookError("Branch not found","BRANCH_NOT_FOUND",404);
      const limit=Number(request.query.limit ?? 30);
      if (!/^\d+$/.test(request.query.limit ?? "30") || !Number.isInteger(limit) || limit<1 || limit>100) throw new CashbookError("Limit must be 1–100");
      const dayId=request.query.dayId ? uuid(request.query.dayId,"dayId") : null;
      return await withTransaction(pool,async client=>{
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        if (dayId && !(await client.query(`SELECT id FROM operating_days WHERE id=$1 AND business_id=$2 AND branch_id=$3`,[dayId,businessId,branchId])).rowCount) throw new CashbookError("Day not found","DAY_NOT_FOUND",404);
        if (resource==="current") {
          const day=(await client.query(`SELECT * FROM operating_days WHERE business_id=$1 AND branch_id=$2 AND status='OPEN'`,[businessId,branchId])).rows[0];
          const shift=(await client.query(`SELECT * FROM staff_shifts WHERE business_id=$1 AND branch_id=$2 AND staff_id=$3 AND status='OPEN'`,[businessId,branchId,access.staffId])).rows[0];
          const count=day ? Number((await client.query(`SELECT COUNT(*) FROM staff_shifts WHERE operating_day_id=$1 AND status='OPEN'`,[day.id])).rows[0].count) : 0;
          return {operatingDay:day ? await detail(client,day,false) : null,shift:shift ? await detail(client,shift,true) : null,openShiftCount:count};
        }
        const shift=resource==="shifts";
        const rows=await client.query(`SELECT * FROM ${shift ? "staff_shifts" : "operating_days"} WHERE business_id=$1 AND branch_id=$2 ${shift ? "AND ($4::uuid IS NULL OR operating_day_id=$4) AND ($5::uuid IS NULL OR staff_id=$5)" : ""} ORDER BY opened_at DESC,id DESC LIMIT $3`,shift ? [businessId,branchId,limit,dayId,access.role==="CASHIER" ? access.staffId : null] : [businessId,branchId,limit]);
        const items=[];
        for (const row of rows.rows) items.push(await detail(client,row,shift));
        return shift ? {shifts:items} : {days:items};
      });
    } catch(error) {
      if (error instanceof CashbookError || error instanceof AuthError) return reply.code(error.statusCode).send({error:error.code,message:error.message});
      throw error;
    }
  });
}
