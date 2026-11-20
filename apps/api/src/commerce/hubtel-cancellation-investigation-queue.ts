import type { DatabasePool } from "../db.js";
import { posFail } from "./hubtel-pos-config.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type InvestigationOutcome="ALL"|"PENDING"|"PAID"|"OTHER";
type ResultRow={
  id:string;sale_id:string;branch_id:string;created_at:Date;
  sale_status:string;payment_status:string;checkout_state:string;
  currency_code:string;amount_minor:string;reason:string;
  outcome:"PENDING"|"PAID"|"OTHER";
};
const outcomeSql=`CASE WHEN s.status='OPEN' AND p.status='PENDING'
  THEN 'PENDING' WHEN s.status='COMPLETED' AND p.status='SUCCEEDED'
  THEN 'PAID' ELSE 'OTHER' END`;
const joinSql=
  "FROM hubtel_pos_cancellation_investigations c "+
  "JOIN sales s ON s.id=c.sale_id AND s.business_id=c.business_id "+
  "AND s.branch_id=c.branch_id "+
  "JOIN payments p ON p.id=c.payment_id AND p.sale_id=c.sale_id "+
  "AND p.business_id=c.business_id AND p.branch_id=c.branch_id "+
  "JOIN hubtel_sale_checkout_attempts a ON a.id=c.attempt_id "+
  "AND a.business_id=c.business_id AND a.branch_id=c.branch_id "+
  "AND a.sale_id=c.sale_id AND a.payment_id=c.payment_id ";

function unsigned(value:string|number,label:string):number{
  const v=Number(value);
  if(!Number.isSafeInteger(v)||v<0)
    posFail("Hubtel investigation "+label+" is not safely representable.",
      "HUBTEL_CANCEL_QUEUE_INVALID_AMOUNT",500);
  return v;
}
export async function listHubtelCancellationInvestigations(
  pool:DatabasePool,
  input:{businessId:string;branchId?:string;outcome?:string;limit?:number;offset?:number},
){
  if(!UUID.test(input.businessId)||(input.branchId&&!UUID.test(input.branchId)))
    posFail("Valid business and branch are required.","HUBTEL_CANCEL_QUEUE_ID_INVALID",400);
  const outcome=input.outcome??"ALL";
  if(!["ALL","PENDING","PAID","OTHER"].includes(outcome))
    posFail("Unknown investigation outcome filter.","HUBTEL_CANCEL_QUEUE_FILTER_INVALID",400);
  const limit=input.limit??20,offset=input.offset??0;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||
     !Number.isSafeInteger(offset)||offset<0||offset>100000)
    posFail("Invalid investigation page request.","HUBTEL_CANCEL_QUEUE_PAGE_INVALID",400);
  const args=[input.businessId,input.branchId??null,outcome,limit,offset];
  const scope="WHERE c.business_id=$1 AND ($2::uuid IS NULL OR c.branch_id=$2::uuid) ";
  // A historical investigation remains visible after independently verified
  // payment. PAID means CURRENT ledger settlement, not provider void/expiry.
  const filtered="AND ($3::text='ALL' OR "+outcomeSql+"=$3::text) ";
  const results=await pool.query<ResultRow>(
    "SELECT c.id,c.sale_id,c.branch_id,c.created_at,c.reason,"+
    "s.status AS sale_status,p.status AS payment_status,a.state AS checkout_state,"+
    "a.currency_code,a.expected_amount_minor::text AS amount_minor,"+
    outcomeSql+" AS outcome "+joinSql+scope+filtered+
    "ORDER BY c.created_at DESC,c.id DESC LIMIT $4::integer OFFSET $5::integer",
    args,
  );
  const counts=await pool.query<{
    total:string;pending:string;paid:string;other:string;
  }>(
    "SELECT COUNT(*)::text AS total,"+
    "COUNT(*) FILTER (WHERE s.status='OPEN' AND p.status='PENDING')::text AS pending,"+
    "COUNT(*) FILTER (WHERE s.status='COMPLETED' AND p.status='SUCCEEDED')::text AS paid,"+
    "COUNT(*) FILTER (WHERE NOT ((s.status='OPEN' AND p.status='PENDING') "+
      "OR (s.status='COMPLETED' AND p.status='SUCCEEDED')))::text AS other "+
    joinSql+scope,
    [input.businessId,input.branchId??null],
  );
  const total=unsigned(counts.rows[0]?.total??"0","total");
  const pending=unsigned(counts.rows[0]?.pending??"0","pending count");
  const paid=unsigned(counts.rows[0]?.paid??"0","paid count");
  const other=unsigned(counts.rows[0]?.other??"0","other count");
  const filteredCount=outcome==="PENDING"?pending:
    outcome==="PAID"?paid:outcome==="OTHER"?other:total;
  return {
    scope:"BRANCH_ALL_TIME" as const,
    cases:results.rows.map(row=>({
      reviewId:row.id,saleId:row.sale_id,branchId:row.branch_id,
      requestedAt:row.created_at.toISOString(),
      reason:row.reason,
      saleStatus:row.sale_status,paymentStatus:row.payment_status,
      checkoutState:row.checkout_state,
      amountMinor:unsigned(row.amount_minor,"checkout amount"),
      currencyCode:row.currency_code,
      outcome:row.outcome,
      providerFinality:"NOT_ESTABLISHED" as const,
      canReleaseStock:false as const,
    })),
    summary:{total,pending,paid,other},
    outcome,limit,offset,hasMore:offset+results.rows.length<filteredCount,
    filteredCount,
  };
}
