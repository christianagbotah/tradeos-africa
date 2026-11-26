import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { withTransaction, type DatabasePool, type DatabaseClient } from "./db.js";
import { proportionalMinor, safeMinor } from "./commerce/valuation.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
type Status="DRAFT"|"ISSUED"|"CANCELLED";
const READ_ROLES:readonly BusinessRole[]=[
  "OWNER","ADMIN","MANAGER","ACCOUNTANT","INVENTORY","CASHIER","SALES","STAFF","VIEWER",
];
const WRITE_ROLES:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER","INVENTORY"];
const CONTROL_ROLES:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER"];

interface PurchaseOrderInput {
  businessId?:string;branchId?:string;clientRequestId?:string;
  supplierId?:string;notes?:string;expectedDeliveryDate?:string;
  lines?:Array<{itemId?:string;purchaseUnitCode?:string;quantity?:number;unitCostMinor?:number}>;
}
interface OrderRow {
  id:string;business_id:string;branch_id:string;supplier_id:string;
  order_number:string;status:Status;currency_code:string;
  supplier_name_snapshot:string;supplier_phone_snapshot:string|null;
  supplier_email_snapshot:string|null;supplier_address_snapshot:string|null;
  business_name_snapshot:string;branch_name_snapshot:string;
  notes:string;expected_delivery_at:Date|null;
  subtotal_minor:string;tax_minor:string;total_minor:string;
  issued_at:Date|null;cancelled_at:Date|null;created_at:Date;updated_at:Date;
}
interface LineRow {
  id:string;item_id:string;item_name_snapshot:string;item_sku_snapshot:string|null;
  purchase_unit_code:string;purchase_unit_label_snapshot:string;
  quantity:string;received_quantity:string;received_cost_minor:string;
  unit_cost_minor:string;line_net_minor:string;
  line_tax_minor:string;line_total_minor:string;
}
class PurchaseOrderError extends Error {
  constructor(message:string,readonly code="PURCHASE_ORDER_INVALID",readonly statusCode=400){
    super(message);this.name="PurchaseOrderError";
  }
}
function requireId(value:unknown,label:string):string {
  if(typeof value!=="string"||!UUID.test(value))throw new PurchaseOrderError(
    `Valid ${label} is required`,"PURCHASE_ORDER_ID_INVALID");
  return value;
}
function str(value:unknown,max:number,label:string):string {
  if(value!==undefined&&typeof value!=="string")throw new PurchaseOrderError(
    `${label} must be text`);
  const trimmed=typeof value==="string"?value.trim():"";
  if(trimmed.length>max)throw new PurchaseOrderError(`${label} is too long`);
  return trimmed;
}
function validate(input:PurchaseOrderInput|undefined){
  if(!input||typeof input!=="object")
    throw new PurchaseOrderError("Purchase order information is required");
  const businessId=requireId(input.businessId,"businessId");
  const branchId=requireId(input.branchId,"branchId");
  const supplierId=requireId(input.supplierId,"supplierId");
  const requestId=requireId(input.clientRequestId,"clientRequestId");
  const notes=str(input.notes,2000,"Notes");
  let expectedDeliveryDate:string|null=null;
  if(input.expectedDeliveryDate){
    const dateValue=typeof input.expectedDeliveryDate==="string"?
      Date.parse(input.expectedDeliveryDate+"T00:00:00.000Z"):NaN;
    if(typeof input.expectedDeliveryDate!=="string"||!DAY.test(input.expectedDeliveryDate)||
      !Number.isFinite(dateValue)||
      new Date(dateValue).toISOString().slice(0,10)!==input.expectedDeliveryDate)
      throw new PurchaseOrderError("Expected delivery date must be a valid date");
    expectedDeliveryDate=input.expectedDeliveryDate;
  }
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>50)
    throw new PurchaseOrderError("Add between 1 and 50 purchase-order lines");
  const lines=input.lines.map((line,index)=>{
    const itemId=requireId(line?.itemId,`itemId on line ${index+1}`);
    const unit=str(line?.purchaseUnitCode,40,"Purchase unit");
    if(!unit)throw new PurchaseOrderError("Purchase unit is required");
    const qty=line?.quantity;
    if(typeof qty!=="number"||!Number.isFinite(qty)||qty<=0||qty>1_000_000||
      Math.abs(qty*1e8-Math.round(qty*1e8))>.001)
      throw new PurchaseOrderError("Quantity must be positive with at most 8 decimals");
    const cost=line?.unitCostMinor;
    if(typeof cost!=="number"||!Number.isSafeInteger(cost)||cost<0)
      throw new PurchaseOrderError("Unit cost must be a nonnegative integer in pesewas");
    return {itemId,unit,quantity:qty,unitCostMinor:cost};
  });
  if(new Set(lines.map(line=>line.itemId)).size!==lines.length)
    throw new PurchaseOrderError("Each product can appear only once in a purchase order");
  return {businessId,branchId,supplierId,requestId,notes,expectedDeliveryDate,lines};
}
function view(row:OrderRow){
  return {id:row.id,businessId:row.business_id,branchId:row.branch_id,
    supplierId:row.supplier_id,orderNumber:row.order_number,status:row.status,
    currencyCode:row.currency_code,supplierName:row.supplier_name_snapshot,
    supplierPhone:row.supplier_phone_snapshot,supplierEmail:row.supplier_email_snapshot,
    supplierAddress:row.supplier_address_snapshot,businessName:row.business_name_snapshot,
    branchName:row.branch_name_snapshot,notes:row.notes,
    expectedDeliveryDate:row.expected_delivery_at?.toISOString().slice(0,10)??null,
    subtotalMinor:Number(row.subtotal_minor),taxMinor:Number(row.tax_minor),
    totalMinor:Number(row.total_minor),issuedAt:row.issued_at?.toISOString()??null,
    cancelledAt:row.cancelled_at?.toISOString()??null,
    createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()};
}
const SELECT_ORDER=`SELECT id,business_id,branch_id,supplier_id,order_number,status,currency_code,
 supplier_name_snapshot,supplier_phone_snapshot,supplier_email_snapshot,
 supplier_address_snapshot,business_name_snapshot,branch_name_snapshot,notes,
 expected_delivery_at,subtotal_minor::text,tax_minor::text,total_minor::text,
 issued_at,cancelled_at,created_at,updated_at FROM supplier_purchase_orders`;
async function load(db:Pick<DatabasePool,"query">|Pick<DatabaseClient,"query">,
  businessId:string,orderId:string){
  const order=(await db.query<OrderRow>(
    SELECT_ORDER+" WHERE business_id=$1 AND id=$2",[businessId,orderId])).rows[0];
  if(!order)throw new PurchaseOrderError("Purchase order not found",
    "PURCHASE_ORDER_NOT_FOUND",404);
  const lines=await db.query<LineRow>(
    `SELECT pol.id,pol.item_id,pol.item_name_snapshot,pol.item_sku_snapshot,
    pol.purchase_unit_code,pol.purchase_unit_label_snapshot,pol.quantity::text,
    pol.unit_cost_minor::text,pol.line_net_minor::text,pol.line_tax_minor::text,
    pol.line_total_minor::text,
    COALESCE(SUM(pl.purchase_quantity) FILTER (WHERE p.id IS NOT NULL),0)::text AS received_quantity,
    COALESCE(SUM(pl.line_cost_minor) FILTER (WHERE p.id IS NOT NULL),0)::text AS received_cost_minor
    FROM supplier_purchase_order_lines pol
    LEFT JOIN purchase_lines pl ON pl.business_id=pol.business_id
      AND pl.purchase_order_line_id=pol.id
    LEFT JOIN purchases p ON p.id=pl.purchase_id AND p.business_id=pol.business_id
      AND p.purchase_order_id=pol.order_id AND p.status='RECEIVED'
    WHERE pol.business_id=$1 AND pol.order_id=$2
    GROUP BY pol.id
    ORDER BY pol.sort_order`,
    [businessId,orderId]);
  const mapped=lines.rows.map(row=>{
    const received=Number(row.received_quantity);
    const remaining=Number((BigInt(Math.round(Number(row.quantity)*1e8))-
      BigInt(Math.round(received*1e8))))/1e8;
    const expectedReceivedCost=proportionalMinor(Number(row.unit_cost_minor),received,1);
    return {
      id:row.id,itemId:row.item_id,itemName:row.item_name_snapshot,
      itemSku:row.item_sku_snapshot,purchaseUnitCode:row.purchase_unit_code,
      purchaseUnitLabel:row.purchase_unit_label_snapshot,quantity:Number(row.quantity),
      receivedQuantity:received,remainingQuantity:remaining,
      unitCostMinor:Number(row.unit_cost_minor),lineNetMinor:Number(row.line_net_minor),
      lineTaxMinor:Number(row.line_tax_minor),lineTotalMinor:Number(row.line_total_minor),
      receivedCostMinor:Number(row.received_cost_minor),
      priceVarianceMinor:Number(row.received_cost_minor)-expectedReceivedCost,
    };
  });
  const receipts=(await db.query<{
    id:string;received_at:Date;total_minor:string;supplier_reference:string|null;
    settlement_method:string;
  }>(
    `SELECT id,received_at,total_minor::text,supplier_reference,settlement_method
     FROM purchases WHERE business_id=$1 AND purchase_order_id=$2 AND status='RECEIVED'
     ORDER BY received_at DESC,id DESC LIMIT 100`,[businessId,orderId])).rows;
  // The history list is intentionally bounded, but totals must cover ALL
  // posted receipts, even for a PO with more than 100 partial deliveries.
  const receiptTotals=(await db.query<{receipt_count:string;received_minor:string}>(
    `SELECT COUNT(*)::text AS receipt_count,
      COALESCE(SUM(total_minor),0)::text AS received_minor
     FROM purchases WHERE business_id=$1 AND purchase_order_id=$2
       AND status='RECEIVED'`,[businessId,orderId])).rows[0];
  const receivedLines=mapped.filter(line=>line.receivedQuantity>0);
  return {...view(order),lines:mapped,
    fulfillmentStatus:receivedLines.length===0?"NOT_RECEIVED":
      mapped.every(line=>line.remainingQuantity===0)?"RECEIVED":"PARTIAL",
    canReceive:order.status==="ISSUED"&&mapped.some(line=>line.remainingQuantity>0),
    receivedTotalMinor:safeMinor(Number(receiptTotals?.received_minor??0)),
    priceVarianceMinor:mapped.reduce((sum,line)=>sum+line.priceVarianceMinor,0),
    receiptCount:Number(receiptTotals?.receipt_count??0),
    receipts:receipts.map(row=>({id:row.id,receivedAt:row.received_at.toISOString(),
      totalMinor:Number(row.total_minor),supplierReference:row.supplier_reference,
      settlementMethod:row.settlement_method})),
  };
}
async function audit(tx:DatabaseClient,input:{
  businessId:string;branchId:string;staffId:string|null;orderId:string;
  eventType:string;orderNumber:string
}){
  await tx.query(
    `INSERT INTO audit_events
      (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,payload)
      VALUES($1,$2,$3,$4,'PURCHASE_ORDER',$5,$6::jsonb)`,
    [input.businessId,input.branchId,input.staffId,input.eventType,input.orderId,
      JSON.stringify({orderNumber:input.orderNumber})]);
}
function errorResponse(
  request:{log:{error:(error:unknown)=>void}},
  reply:{code:(status:number)=>{send:(payload:unknown)=>unknown}},
  error:unknown
){
  if(error instanceof PurchaseOrderError||error instanceof AuthError)
    return reply.code(error.statusCode).send({error:error.code,message:error.message});
  request.log.error(error);
  return reply.code(500).send({error:"PURCHASE_ORDER_FAILED",
    message:"Purchase order could not be completed safely"});
}

export function registerPurchaseOrderRoutes(app:FastifyInstance,pool:DatabasePool):void{
  app.get<{Querystring:{businessId?:string;branchId?:string;limit?:string}}>(
    "/v1/purchase-orders",async(request,reply)=>{
      try{
        const businessId=requireId(request.query.businessId,"businessId");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,READ_ROLES);
        const branchId=request.query.branchId?
          requireId(request.query.branchId,"branchId"):null;
        const limit=Math.max(1,Math.min(100,Number(request.query.limit)||50));
        const result=await pool.query<OrderRow>(
          SELECT_ORDER+" WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2::uuid)"+
          " ORDER BY created_at DESC,id DESC LIMIT $3::integer",
          [businessId,branchId,Math.floor(limit)]);
        return {orders:result.rows.map(view)};
      }catch(error){return errorResponse(request,reply,error);}
    });
  app.get<{Params:{orderId:string};Querystring:{businessId?:string}}>(
    "/v1/purchase-orders/:orderId",async(request,reply)=>{
      try{
        const businessId=requireId(request.query.businessId,"businessId");
        const orderId=requireId(request.params.orderId,"orderId");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,READ_ROLES);
        return {order:await load(pool,businessId,orderId)};
      }catch(error){return errorResponse(request,reply,error);}
    });
  app.post<{Body:PurchaseOrderInput}>("/v1/purchase-orders",async(request,reply)=>{
    try{
      const input=validate(request.body);
      const auth=await authenticateAccessToken(pool,request.headers.authorization);
      const access=await requireBusinessRole(pool,auth,input.businessId,WRITE_ROLES);
      const fingerprint=createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const created=await withTransaction(pool,async tx=>{
        // Business row serializes purchase-order numbering and request retries.
        const business=(await tx.query<{name:string;currency_code:string}>(
          "SELECT name,currency_code FROM businesses WHERE id=$1 FOR UPDATE",
          [input.businessId])).rows[0];
        if(!business)throw new PurchaseOrderError("Business not found","BUSINESS_NOT_FOUND",404);
        const prior=(await tx.query<{id:string;request_fingerprint:string}>(
          "SELECT id,request_fingerprint FROM supplier_purchase_orders "+
          "WHERE business_id=$1 AND client_request_id=$2",
          [input.businessId,input.requestId])).rows[0];
        if(prior){
          if(prior.request_fingerprint!==fingerprint)
            throw new PurchaseOrderError("This request ID was used for different order content",
              "PURCHASE_ORDER_REQUEST_CONFLICT",409);
          return {id:prior.id,replay:true};
        }
        const branch=(await tx.query<{name:string}>(
          "SELECT name FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true",
          [input.branchId,input.businessId])).rows[0];
        if(!branch)throw new PurchaseOrderError("Branch unavailable in this business",
          "PURCHASE_ORDER_BRANCH_INVALID",404);
        const supplier=(await tx.query<{
          name:string;phone:string|null;email:string|null;address:string|null
        }>(
          "SELECT name,phone,email,address FROM suppliers "+
          "WHERE id=$1 AND business_id=$2 AND is_active=true",
          [input.supplierId,input.businessId])).rows[0];
        if(!supplier)throw new PurchaseOrderError("Supplier not active in this business",
          "PURCHASE_ORDER_SUPPLIER_INVALID",404);
        const snapshots:Array<{
          itemId:string;name:string;sku:string|null;unit:string;label:string;
          quantity:number;unitCostMinor:number;lineMinor:number;
        }>=[];
        let subtotal=0;
        for(const line of input.lines){
          const item=(await tx.query<{
            name:string;sku:string|null;unit_label:string;
          }>(
            `SELECT i.name,i.sku,u.unit_label FROM catalog_items i
             JOIN catalog_item_units u ON u.item_id=i.id AND u.business_id=i.business_id
             WHERE i.id=$1 AND i.business_id=$2 AND i.is_active=true
               AND i.kind='PRODUCT' AND i.track_stock=true
               AND u.unit_code=$3 AND u.can_purchase=true
             FOR SHARE OF i,u`,
            [line.itemId,input.businessId,line.unit])).rows[0];
          if(!item)throw new PurchaseOrderError(
            "Item/unit cannot be ordered from this business catalog",
            "PURCHASE_ORDER_UNIT_INVALID",409);
          const lineMinor=proportionalMinor(safeMinor(line.unitCostMinor),line.quantity,1);
          subtotal=safeMinor(subtotal+lineMinor);
          snapshots.push({itemId:line.itemId,name:item.name,sku:item.sku,
            unit:line.unit,label:item.unit_label,quantity:line.quantity,
            unitCostMinor:line.unitCostMinor,lineMinor});
        }
        const year=new Date().getUTCFullYear();
        const serial=(await tx.query<{last_number:number}>(
          `INSERT INTO supplier_purchase_order_sequences(business_id,year,last_number)
           VALUES($1,$2,1) ON CONFLICT(business_id,year)
           DO UPDATE SET last_number=supplier_purchase_order_sequences.last_number+1
           RETURNING last_number`,
          [input.businessId,year])).rows[0]!.last_number;
        const orderNumber=`PO-${year}-${String(serial).padStart(6,"0")}`;
        const inserted=(await tx.query<{id:string}>(
          `INSERT INTO supplier_purchase_orders(
            business_id,branch_id,supplier_id,created_by_staff_id,
            client_request_id,request_fingerprint,order_number,currency_code,
            supplier_name_snapshot,supplier_phone_snapshot,supplier_email_snapshot,
            supplier_address_snapshot,business_name_snapshot,branch_name_snapshot,
            expected_delivery_at,notes,subtotal_minor,tax_minor,total_minor
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,0,$17)
          RETURNING id`,
          [input.businessId,input.branchId,input.supplierId,access.staffId,
            input.requestId,fingerprint,orderNumber,business.currency_code,
            supplier.name,supplier.phone,supplier.email,supplier.address,
            business.name,branch.name,input.expectedDeliveryDate,input.notes,subtotal])).rows[0]!;
        for(const [index,line] of snapshots.entries()){
          await tx.query(
            `INSERT INTO supplier_purchase_order_lines(
              business_id,order_id,sort_order,item_id,item_name_snapshot,item_sku_snapshot,
              purchase_unit_code,purchase_unit_label_snapshot,quantity,unit_cost_minor,
              line_net_minor,line_tax_minor,line_total_minor
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$11)`,
            [input.businessId,inserted.id,index,line.itemId,line.name,line.sku,
              line.unit,line.label,line.quantity,line.unitCostMinor,line.lineMinor]);
        }
        await audit(tx,{businessId:input.businessId,branchId:input.branchId,
          staffId:access.staffId,orderId:inserted.id,eventType:"PURCHASE_ORDER_CREATED",
          orderNumber});
        return {id:inserted.id,replay:false};
      });
      return reply.code(created.replay?200:201).send({
        order:await load(pool,input.businessId,created.id),idempotentReplay:created.replay,
      });
    }catch(error){return errorResponse(request,reply,error);}
  });

  // Editing a saved PO is permitted only before issuance. The server locks
  // the draft, rejects stale versions, and replaces its unposted line snapshot
  // in one transaction. Issued/cancelled documents and receipts remain immutable.
  app.patch<{Params:{orderId:string};Body:PurchaseOrderInput&{
    expectedUpdatedAt?:string;
  }}>("/v1/purchase-orders/:orderId",async(request,reply)=>{
    try{
      const orderId=requireId(request.params.orderId,"orderId");
      const body=request.body;
      const businessId=requireId(body?.businessId,"businessId");
      if(typeof body.expectedUpdatedAt!=="string"||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.expectedUpdatedAt)||
        !Number.isFinite(Date.parse(body.expectedUpdatedAt)))
        throw new PurchaseOrderError("Current order version is required",
          "PURCHASE_ORDER_VERSION_REQUIRED");
      const auth=await authenticateAccessToken(pool,request.headers.authorization);
      const access=await requireBusinessRole(pool,auth,businessId,WRITE_ROLES);
      await withTransaction(pool,async tx=>{
        const row=(await tx.query<{
          id:string;branch_id:string;order_number:string;status:Status;
          updated_at:Date;
        }>(
          "SELECT id,branch_id,order_number,status,updated_at "+
          "FROM supplier_purchase_orders "+
          "WHERE id=$1 AND business_id=$2 FOR UPDATE",
          [orderId,businessId])).rows[0];
        if(!row)throw new PurchaseOrderError("Purchase order not found",
          "PURCHASE_ORDER_NOT_FOUND",404);
        if(row.status!=="DRAFT")throw new PurchaseOrderError(
          "Only unissued drafts can be edited","PURCHASE_ORDER_NOT_DRAFT",409);
        if(row.updated_at.toISOString()!==body.expectedUpdatedAt)
          throw new PurchaseOrderError(
            "Purchase order changed elsewhere. Reload before editing.",
            "PURCHASE_ORDER_VERSION_CONFLICT",409);
        const input=validate({...body,branchId:row.branch_id,
          clientRequestId:randomUUID()});
        const supplier=(await tx.query<{
          name:string;phone:string|null;email:string|null;address:string|null;
        }>(
          "SELECT name,phone,email,address FROM suppliers "+
          "WHERE id=$1 AND business_id=$2 AND is_active=true",
          [input.supplierId,businessId])).rows[0];
        if(!supplier)throw new PurchaseOrderError(
          "Supplier is not active in this business",
          "PURCHASE_ORDER_SUPPLIER_INVALID",404);
        const snapshots:Array<{
          itemId:string;name:string;sku:string|null;unit:string;label:string;
          quantity:number;unitCostMinor:number;lineMinor:number;
        }>=[];
        let subtotal=0;
        for(const line of input.lines){
          const item=(await tx.query<{
            name:string;sku:string|null;unit_label:string;
          }>(
            `SELECT i.name,i.sku,u.unit_label FROM catalog_items i
             JOIN catalog_item_units u ON u.item_id=i.id AND u.business_id=i.business_id
             WHERE i.id=$1 AND i.business_id=$2 AND i.is_active=true
               AND i.kind='PRODUCT' AND i.track_stock=true
               AND u.unit_code=$3 AND u.can_purchase=true FOR SHARE OF i,u`,
            [line.itemId,businessId,line.unit])).rows[0];
          if(!item)throw new PurchaseOrderError(
            "Item/unit cannot be ordered from this business catalog",
            "PURCHASE_ORDER_UNIT_INVALID",409);
          const lineMinor=proportionalMinor(safeMinor(line.unitCostMinor),line.quantity,1);
          subtotal=safeMinor(subtotal+lineMinor);
          snapshots.push({itemId:line.itemId,name:item.name,sku:item.sku,
            unit:line.unit,label:item.unit_label,quantity:line.quantity,
            unitCostMinor:line.unitCostMinor,lineMinor});
        }
        await tx.query(
          `UPDATE supplier_purchase_orders SET
             supplier_id=$3,supplier_name_snapshot=$4,supplier_phone_snapshot=$5,
             supplier_email_snapshot=$6,supplier_address_snapshot=$7,
             notes=$8,expected_delivery_at=$9,subtotal_minor=$10,
             tax_minor=0,total_minor=$10,
             updated_at=GREATEST(clock_timestamp(),updated_at + interval '1 millisecond')
           WHERE id=$1 AND business_id=$2`,
          [orderId,businessId,input.supplierId,supplier.name,supplier.phone,
            supplier.email,supplier.address,input.notes,input.expectedDeliveryDate,subtotal]);
        await tx.query("DELETE FROM supplier_purchase_order_lines "+
          "WHERE business_id=$1 AND order_id=$2",[businessId,orderId]);
        for(const [index,line] of snapshots.entries()){
          await tx.query(
            `INSERT INTO supplier_purchase_order_lines(
              business_id,order_id,sort_order,item_id,item_name_snapshot,item_sku_snapshot,
              purchase_unit_code,purchase_unit_label_snapshot,quantity,unit_cost_minor,
              line_net_minor,line_tax_minor,line_total_minor
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$11)`,
            [businessId,orderId,index,line.itemId,line.name,line.sku,
              line.unit,line.label,line.quantity,line.unitCostMinor,line.lineMinor]);
        }
        await audit(tx,{businessId,branchId:row.branch_id,
          staffId:access.staffId,orderId,eventType:"PURCHASE_ORDER_DRAFT_UPDATED",
          orderNumber:row.order_number});
      });
      return {order:await load(pool,businessId,orderId)};
    }catch(error){return errorResponse(request,reply,error);}
  });

  for(const action of ["issue","cancel"] as const){
    app.post<{Params:{orderId:string};Body:{businessId?:string}}>(
      `/v1/purchase-orders/:orderId/${action}`,async(request,reply)=>{
        try{
          const businessId=requireId(request.body?.businessId,"businessId");
          const orderId=requireId(request.params.orderId,"orderId");
          const access=await requireBusinessRole(pool,
            await authenticateAccessToken(pool,request.headers.authorization),
            businessId,CONTROL_ROLES);
          await withTransaction(pool,async tx=>{
            const row=(await tx.query<{
              id:string;branch_id:string;order_number:string;status:Status;
            }>(
              "SELECT id,branch_id,order_number,status "+
              "FROM supplier_purchase_orders WHERE id=$1 AND business_id=$2 FOR UPDATE",
              [orderId,businessId])).rows[0];
            if(!row)throw new PurchaseOrderError(
              "Purchase order not found","PURCHASE_ORDER_NOT_FOUND",404);
            const target:Status=action==="issue"?"ISSUED":"CANCELLED";
            if(row.status===target)return;
            if(action==="issue"&&row.status!=="DRAFT")
              throw new PurchaseOrderError("Only drafts can be issued",
                "PURCHASE_ORDER_STATE_INVALID",409);
            await tx.query(
              `UPDATE supplier_purchase_orders SET status=$3,
               issued_at=CASE WHEN $3='ISSUED' THEN now() ELSE issued_at END,
               cancelled_at=CASE WHEN $3='CANCELLED' THEN now() ELSE cancelled_at END,
               updated_at=now() WHERE id=$1 AND business_id=$2`,
              [orderId,businessId,target]);
            if(target==="CANCELLED"){
              // A cancelled PO must not have unsubmitted or queued supplier
              // emails delivered later. The provider may already have accepted
              // an in-flight email; those records remain immutable and visible.
              await tx.query(
                `UPDATE supplier_document_deliveries
                 SET status='CANCELLED',authorized_at=NULL,
                   next_attempt_at=NULL,last_error_code='PO_CANCELLED',
                   updated_at=now()
                 WHERE business_id=$1 AND purchase_order_id=$2
                   AND status IN ('PREPARED','QUEUED')`,
                [businessId,orderId]);
            }
            await audit(tx,{businessId,branchId:row.branch_id,staffId:access.staffId,
              orderId,eventType:target==="ISSUED"?"PURCHASE_ORDER_ISSUED":"PURCHASE_ORDER_CANCELLED",
              orderNumber:row.order_number});
          });
          return {order:await load(pool,businessId,orderId)};
        }catch(error){return errorResponse(request,reply,error);}
      });
  }
}
