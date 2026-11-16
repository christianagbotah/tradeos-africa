import type { FastifyInstance } from "fastify";
import type { DatabasePool,DatabaseClient } from "../db.js";
import {withTransaction} from "../db.js";
import {authenticateAccessToken,AuthError} from "../auth/security.js";
import {requireBusinessRole,type BusinessAccess,type BusinessRole} from "../auth/authorization.js";
import {PriceRuleError,pricingFail,pricingUuid,pricingUnit,pricingMinor,pricingQty,
  ensureCustomer,priceCatalogBase,resolveCustomerPrice} from "./price-rules.js";

const SELL_ROLES:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER","CASHIER","SALES","STAFF"];
const CONTROL_ROLES:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function optionalCustomer(v:unknown):string|null{
  return v===null||v===undefined||v===""?null:pricingUuid(v,"customerId");
}
function customerId(v:unknown):string{return pricingUuid(v,"customerId");}
async function audit(db:DatabaseClient,a:BusinessAccess,event:string,type:string,
  id:string,details:unknown,branchId:string|null=null){
  await db.query(`INSERT INTO audit_events(business_id,branch_id,actor_staff_id,
    event_type,entity_type,entity_id,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [a.businessId,branchId,a.staffId,event,type,id,JSON.stringify(details)]);
}
function sendError(request:{log:{error:(e:unknown)=>void}},
  reply:{code:(n:number)=>{send:(x:unknown)=>unknown}},e:unknown){
  if(e instanceof PriceRuleError||e instanceof AuthError)
    return reply.code(e.statusCode).send({error:e.code,message:e.message});
  request.log.error(e);
  return reply.code(500).send({error:"PRICING_FAILED",
    message:"Could not process this pricing request safely"});
}
async function authorized(pool:DatabasePool,header:string|undefined,
  businessId:unknown,roles:readonly BusinessRole[]){
  const business=pricingUuid(businessId,"businessId");
  return requireBusinessRole(pool,await authenticateAccessToken(pool,header),
    business,roles);
}
async function verifyBranch(db:DatabaseClient,a:BusinessAccess,branchId:string){
  const q=await db.query(`SELECT id FROM branches
     WHERE id=$1 AND business_id=$2 AND is_active=true`,
     [branchId,a.businessId]);
  if(!q.rows[0])pricingFail("Branch is unavailable","PRICING_BRANCH_NOT_FOUND",404);
}
type QuoteLine={itemId:unknown;unitCode:unknown;quantity:unknown};
type QuoteBody={businessId?:string;branchId?:string;
  customerId?:string|null;lines?:QuoteLine[]};
type RateBody={businessId?:string;customerId?:string;itemId?:string;
  unitCode?:string;priceMinor?:number;active?:boolean};
type RequestBody={businessId?:string;branchId?:string;customerId?:string|null;
  itemId?:string;unitCode?:string;quantity?:number;requestedPriceMinor?:number;
  clientRequestId?:string;reason?:string};
type ReviewBody={businessId?:string;note?:string};

export function registerPricingRoutes(app:FastifyInstance,pool:DatabasePool){
  app.post<{Body:QuoteBody}>("/v1/pricing/quote",async(req,reply)=>{
    try{
      const a=await authorized(pool,req.headers.authorization,req.body?.businessId,SELL_ROLES);
      const branchId=pricingUuid(req.body?.branchId,"branchId");
      const customer=optionalCustomer(req.body?.customerId);
      const lines=req.body?.lines;
      if(!Array.isArray(lines)||lines.length===0||lines.length>50)
        pricingFail("Provide one to 50 sale lines","PRICING_LINES_INVALID");
      const quote=await withTransaction(pool,async db=>{
        await verifyBranch(db,a,branchId);
        await ensureCustomer(db,a.businessId,customer);
        const verified=[];
        let totalMinor=0;
        for(const line of lines){
          const itemId=pricingUuid(line.itemId,"itemId");
          const unitCode=pricingUnit(line.unitCode);
          const qty=pricingQty(line.quantity);
          const base=await priceCatalogBase(db,a.businessId,itemId,unitCode);
          const effective=await resolveCustomerPrice(db,{
            businessId:a.businessId,itemId,unitCode,
            customerId:customer,catalogMinor:base.minor,
          });
          const lineTotalMinor=Math.round(effective.unitPriceMinor*qty);
          if(!Number.isSafeInteger(lineTotalMinor)||lineTotalMinor<0||
            !Number.isSafeInteger(totalMinor+lineTotalMinor))
            pricingFail("Sale exceeds supported amount","PRICING_TOTAL_INVALID");
          totalMinor+=lineTotalMinor;
          verified.push({itemId,itemName:base.name,unitCode,quantity:qty,
            standardPriceMinor:base.minor,unitPriceMinor:effective.unitPriceMinor,
            lineTotalMinor,source:effective.source});
        }
        return {branchId,customerId:customer,lines:verified,totalMinor,
          warning:"Quote only. Prices and customer eligibility are revalidated at checkout."};
      });
      return reply.header("Cache-Control","private, no-store").send(quote);
    }catch(e){return sendError(req,reply,e);}
  });

  app.get<{Querystring:{businessId?:string;customerId?:string}}>(
    "/v1/pricing/customer-rates",async(req,reply)=>{
      try{
        const a=await authorized(pool,req.headers.authorization,
          req.query.businessId,CONTROL_ROLES);
        const customer=customerId(req.query.customerId);
        const q=await pool.query<{id:string;item_id:string;item_name:string;
          sale_unit_code:string;unit_price_minor:string;active:boolean;updated_at:Date}>(
          `SELECT p.id,p.item_id,ci.name AS item_name,p.sale_unit_code,
            p.unit_price_minor,p.active,p.updated_at
            FROM customer_special_prices p
            JOIN catalog_items ci ON ci.id=p.item_id AND ci.business_id=p.business_id
            WHERE p.business_id=$1 AND p.customer_id=$2
            ORDER BY p.active DESC,ci.name,p.sale_unit_code LIMIT 300`,
          [a.businessId,customer]);
        return {rates:q.rows.map(r=>({id:r.id,itemId:r.item_id,itemName:r.item_name,
          unitCode:r.sale_unit_code,priceMinor:Number(r.unit_price_minor),
          active:r.active,updatedAt:r.updated_at.toISOString()}))};
      }catch(e){return sendError(req,reply,e);}
    });

  app.put<{Body:RateBody}>("/v1/pricing/customer-rates",async(req,reply)=>{
    try{
      const a=await authorized(pool,req.headers.authorization,
        req.body?.businessId,CONTROL_ROLES);
      const customer=customerId(req.body?.customerId);
      const itemId=pricingUuid(req.body?.itemId,"itemId");
      const unitCode=pricingUnit(req.body?.unitCode);
      const priceMinor=pricingMinor(req.body?.priceMinor);
      const active=req.body?.active!==false;
      const rate=await withTransaction(pool,async db=>{
        await ensureCustomer(db,a.businessId,customer);
        const base=await priceCatalogBase(db,a.businessId,itemId,unitCode);
        if(priceMinor>base.minor)pricingFail(
          "Special rate must not exceed standard selling price",
          "PRICING_ABOVE_STANDARD",409);
        const q=await db.query<{id:string}>(
          `INSERT INTO customer_special_prices(business_id,customer_id,item_id,
             sale_unit_code,unit_price_minor,active,created_by_membership_id,
             updated_by_membership_id)
             VALUES($1,$2,$3,$4,$5,$6,$7,$7)
             ON CONFLICT(business_id,customer_id,item_id,sale_unit_code)
             DO UPDATE SET unit_price_minor=EXCLUDED.unit_price_minor,
               active=EXCLUDED.active,updated_by_membership_id=EXCLUDED.updated_by_membership_id,
               updated_at=now() RETURNING id`,
          [a.businessId,customer,itemId,unitCode,priceMinor,active,a.membershipId]);
        const id=q.rows[0]!.id;
        await audit(db,a,"CUSTOMER_SPECIAL_PRICE_SET","CUSTOMER_SPECIAL_PRICE",
          id,{customerId:customer,itemId,unitCode,priceMinor,active,
            standardPriceMinor:base.minor});
        return {id,customerId:customer,itemId,unitCode,priceMinor,active};
      });
      return reply.code(200).send({rate});
    }catch(e){return sendError(req,reply,e);}
  });

  app.post<{Body:RequestBody}>("/v1/pricing/discount-requests",async(req,reply)=>{
    try{
      const a=await authorized(pool,req.headers.authorization,
        req.body?.businessId,SELL_ROLES);
      const branchId=pricingUuid(req.body?.branchId,"branchId");
      const customer=optionalCustomer(req.body?.customerId);
      const itemId=pricingUuid(req.body?.itemId,"itemId");
      const unitCode=pricingUnit(req.body?.unitCode);
      const qty=pricingQty(req.body?.quantity);
      const proposed=pricingMinor(req.body?.requestedPriceMinor);
      const clientRequestId=pricingUuid(req.body?.clientRequestId,"clientRequestId");
      const reason=req.body?.reason?.trim()??"";
      if(reason.length<8||reason.length>500)
        pricingFail("Explain the requested discount in 8–500 characters",
          "PRICING_REASON_REQUIRED");
      const result=await withTransaction(pool,async db=>{
        // Replay first: a user retry must not be affected by catalog changes.
        const prior=await db.query<{
          id:string;status:string;branch_id:string;customer_id:string|null;
          item_id:string;sale_unit_code:string;quantity:string;
          requested_unit_price_minor:string;reason:string;
          requested_by_membership_id:string;
        }>(
          `SELECT id,status,branch_id,customer_id,item_id,sale_unit_code,
            quantity,requested_unit_price_minor,reason,requested_by_membership_id
            FROM sale_price_approval_requests
            WHERE business_id=$1 AND client_request_id=$2`,
          [a.businessId,clientRequestId]);
        if(prior.rows[0]){
          const r=prior.rows[0];
          if(r.branch_id!==branchId||r.customer_id!==customer||
            r.item_id!==itemId||r.sale_unit_code!==unitCode||
            Number(r.quantity)!==qty||
            Number(r.requested_unit_price_minor)!==proposed||
            r.reason!==reason||r.requested_by_membership_id!==a.membershipId)
            pricingFail("Request identifier was reused with different details",
              "PRICING_IDEMPOTENCY_CONFLICT",409);
          return {id:r.id,status:r.status};
        }
        await verifyBranch(db,a,branchId);
        await ensureCustomer(db,a.businessId,customer);
        const base=await priceCatalogBase(db,a.businessId,itemId,unitCode);
        const effective=await resolveCustomerPrice(db,{
          businessId:a.businessId,customerId:customer,itemId,unitCode,
          catalogMinor:base.minor});
        if(proposed>=effective.unitPriceMinor)pricingFail(
          "Requested discount must be below the current selling price",
          "PRICING_NOT_DISCOUNTED",409);
        const q=await db.query<{id:string}>(
          `INSERT INTO sale_price_approval_requests(business_id,branch_id,
            client_request_id,customer_id,item_id,sale_unit_code,quantity,
            base_unit_price_minor,requested_unit_price_minor,reason,
            requested_by_membership_id,requested_by_staff_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [a.businessId,branchId,clientRequestId,customer,itemId,unitCode,
            qty,effective.unitPriceMinor,proposed,reason,a.membershipId,a.staffId]);
        const id=q.rows[0]!.id;
        await audit(db,a,"SALE_DISCOUNT_REQUESTED","SALE_PRICE_APPROVAL",id,
          {customerId:customer,itemId,unitCode,quantity:qty,
            currentUnitPriceMinor:effective.unitPriceMinor,
            proposedUnitPriceMinor:proposed},branchId);
        return {id,status:"PENDING"};
      });
      return reply.code(201).send({request:result});
    }catch(e){return sendError(req,reply,e);}
  });

  app.get<{Querystring:{businessId?:string;status?:string}}>(
    "/v1/pricing/discount-requests",async(req,reply)=>{
      try{
        const a=await authorized(pool,req.headers.authorization,
          req.query.businessId,SELL_ROLES);
        const canControl=CONTROL_ROLES.includes(a.role);
        const status=["PENDING","APPROVED","REJECTED","USED"].includes(
          req.query.status??"")?req.query.status:null;
        const q=await pool.query<{
          id:string;branch_id:string;customer_id:string|null;
          customer_name:string|null;item_id:string;item_name:string;
          sale_unit_code:string;quantity:string;base_unit_price_minor:string;
          requested_unit_price_minor:string;reason:string;status:string;
          requested_by_membership_id:string;created_at:Date;
          reviewed_at:Date|null;expires_at:Date|null;
        }>(
          `SELECT r.id,r.branch_id,r.customer_id,c.name AS customer_name,
             r.item_id,ci.name AS item_name,r.sale_unit_code,r.quantity,
             r.base_unit_price_minor,r.requested_unit_price_minor,r.reason,
             r.status,r.requested_by_membership_id,r.created_at,r.reviewed_at,r.expires_at
             FROM sale_price_approval_requests r
             JOIN catalog_items ci ON ci.id=r.item_id AND ci.business_id=r.business_id
             LEFT JOIN customers c ON c.id=r.customer_id AND c.business_id=r.business_id
             WHERE r.business_id=$1
               AND ($2::text IS NULL OR r.status=$2)
               AND ($3::boolean OR r.requested_by_membership_id=$4)
             ORDER BY r.created_at DESC,r.id DESC LIMIT 150`,
          [a.businessId,status,canControl,a.membershipId]);
        return reply.header("Cache-Control","private, no-store").send({
          requests:q.rows.map(r=>({
            id:r.id,branchId:r.branch_id,customerId:r.customer_id,
            customerName:r.customer_name??"Walk-in",itemId:r.item_id,
            itemName:r.item_name,unitCode:r.sale_unit_code,
            quantity:Number(r.quantity),baseUnitPriceMinor:Number(r.base_unit_price_minor),
            requestedUnitPriceMinor:Number(r.requested_unit_price_minor),
            reason:r.reason,status:r.status,
            requestedByMembershipId:r.requested_by_membership_id,
            createdAt:r.created_at.toISOString(),
            reviewedAt:r.reviewed_at?.toISOString()??null,
            expiresAt:r.expires_at?.toISOString()??null,
          })),
        });
      }catch(e){return sendError(req,reply,e);}
    });

  app.post<{Params:{requestId:string};Body:ReviewBody}>(
    "/v1/pricing/discount-requests/:requestId/approve",async(req,reply)=>{
      return review(req,reply,"APPROVED");
    });
  app.post<{Params:{requestId:string};Body:ReviewBody}>(
    "/v1/pricing/discount-requests/:requestId/reject",async(req,reply)=>{
      return review(req,reply,"REJECTED");
    });
  async function review(
    req:{headers:{authorization?:string|undefined};params:{requestId:string};
      body:ReviewBody;log:{error:(e:unknown)=>void}},
    reply:{code:(n:number)=>{send:(x:unknown)=>unknown}},
    decision:"APPROVED"|"REJECTED",
  ){
    try{
      const a=await authorized(pool,req.headers.authorization,
        req.body?.businessId,CONTROL_ROLES);
      const id=pricingUuid(req.params.requestId,"requestId");
      const note=String(req.body?.note??"").trim().slice(0,300);
      const result=await withTransaction(pool,async db=>{
        const q=await db.query<{
          branch_id:string;status:string;requested_by_membership_id:string;
          base_unit_price_minor:string;requested_unit_price_minor:string;
          created_at:Date;
        }>(
          `SELECT branch_id,status,requested_by_membership_id,
            base_unit_price_minor,requested_unit_price_minor,created_at
            FROM sale_price_approval_requests
            WHERE business_id=$1 AND id=$2 FOR UPDATE`,[a.businessId,id]);
        const r=q.rows[0];
        if(!r)pricingFail("Request was not found","PRICING_REQUEST_NOT_FOUND",404);
        if(r.status!=="PENDING")pricingFail(
          "This request was already reviewed","PRICING_ALREADY_REVIEWED",409);
        if(r.requested_by_membership_id===a.membershipId)
          pricingFail("A requester cannot approve or reject their own discount",
            "PRICING_SELF_REVIEW_FORBIDDEN",403);
        if(Date.now()-r.created_at.getTime()>24*60*60*1000)
          pricingFail("Request expired; please create a new one",
            "PRICING_REQUEST_EXPIRED",409);
        const reduction=(Number(r.base_unit_price_minor)-
          Number(r.requested_unit_price_minor))/Number(r.base_unit_price_minor);
        if(decision==="APPROVED"&&a.role==="MANAGER"&&
          (!Number.isFinite(reduction)||reduction>0.2+1e-10))
          pricingFail("Only owner/admin can approve reductions above 20%",
            "PRICING_OWNER_APPROVAL_REQUIRED",403);
        await db.query(`UPDATE sale_price_approval_requests
          SET status=$3,reviewed_by_membership_id=$4,reviewed_by_staff_id=$5,
          reviewed_at=now(),review_note=$6,
          expires_at=CASE WHEN $3='APPROVED'
            THEN now()+interval '30 minutes' ELSE NULL END,updated_at=now()
          WHERE business_id=$1 AND id=$2 AND status='PENDING'`,
          [a.businessId,id,decision,a.membershipId,a.staffId,note]);
        await audit(db,a,"SALE_DISCOUNT_"+decision,"SALE_PRICE_APPROVAL",id,
          {decision,note,discountPercent:Math.round(reduction*10000)/100},
          r.branch_id);
        return {id,status:decision};
      });
      return reply.code(200).send({request:result});
    }catch(e){return sendError(req,reply,e);}
  }
}
