import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { requireBusinessRole } from "./auth/authorization.js";
import { type DatabaseClient, type DatabasePool, withTransaction } from "./db.js";
import { HubtelStatusClient, HubtelStatusError, type HubtelStatusVerification } from "./platform-admin/hubtel-status-client.js";
import { hubtelPosConnection, requireHubtelPosConnection, HubtelPosError } from "./commerce/hubtel-pos-config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"] as const;
const COOLDOWN_MINUTES = 5;

class OriginalOrderError extends Error {
  constructor(message: string, readonly statusCode = 400,
    readonly code = "REFUND_ORIGINAL_ORDER_INVALID") { super(message); }
}
type Context = {
  id: string; business_id: string; branch_id: string; status: string;
  amount_minor: string; currency_code: string; method: string;
  original_payment_id: string; original_sale_id: string;
  payment_id: string; payment_status: string; payment_method: string;
  payment_amount_minor: string; payment_currency: string;
  payment_provider_reference: string | null;
  checkout_id: string; checkout_state: string;
  client_reference: string; merchant_collection_account: string;
  expected_amount_minor: string; checkout_currency: string;
  original_transaction_id: string | null;
  credential_source: "PLATFORM_ALIAS" | "MERCHANT_VAULT";
  merchant_credential_revision: number | null;
};
type ObservationRow = {
  id: string; refund_transaction_id: string; actor_user_id: string;
  client_request_id: string; original_order_status: "PAID"|"UNPAID"|"REFUNDED";
  observation_kind: ObservationKind; recorded_at: Date; verified_at: Date;
};
type ObservationKind = "ORIGINAL_ORDER_PAID" | "ORIGINAL_ORDER_UNPAID_CONFLICT" |
  "ORIGINAL_ORDER_REFUND_REPORTED" | "ORIGINAL_ORDER_REFERENCE_CONFLICT";

export function classifyAuthenticatedOriginalOrderStatus(
  verified: Pick<HubtelStatusVerification,
    "status"|"transactionId"|"paymentMethod">,
  originalTransactionId: string,
): ObservationKind {
  if (verified.status === "UNPAID") return "ORIGINAL_ORDER_UNPAID_CONFLICT";
  if (verified.transactionId !== originalTransactionId ||
      verified.paymentMethod !== "MOMO") return "ORIGINAL_ORDER_REFERENCE_CONFLICT";
  return verified.status === "REFUNDED"
    ? "ORIGINAL_ORDER_REFUND_REPORTED" : "ORIGINAL_ORDER_PAID";
}
function required(value: unknown, name: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new OriginalOrderError(
    "Valid " + name + " is required.", 400, "REFUND_ORIGINAL_ORDER_ID_INVALID");
  return value;
}
function safeMinor(raw: string, name: string) {
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new OriginalOrderError("Invalid " + name + " money precision.", 409,
      "REFUND_ORIGINAL_ORDER_PRECISION_INVALID");
  return Number(raw);
}
function publicObservation(row: ObservationRow, replay = false) {
  return {
    id: row.id, refundId: row.refund_transaction_id,
    actorUserId: row.actor_user_id, originalOrderStatus: row.original_order_status,
    observationKind: row.observation_kind, checkedAt: row.verified_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(), idempotentReplay: replay,
    source: "AUTHENTICATED_HUBTEL_STATUS_API" as const,
    evidenceScope: "ORIGINAL_PAYMENT_ONLY" as const,
    refundDestinationVerified: false as const,
    refundSpecificSettlementVerified: false as const,
    providerFinality: "NOT_ESTABLISHED" as const,
    canMarkPaid: false as const,
    paymentStatusUnchanged: true as const,
  };
}
async function loadContext(db: Pick<DatabasePool, "query"> | Pick<DatabaseClient, "query">,
  businessId: string, branchId: string, refundId: string, lock = false,
): Promise<Context | null> {
  const r = await db.query<Context>(
    `SELECT rt.id,rt.business_id,rc.branch_id,rt.status,
            rt.amount_minor::text,rt.currency_code,rt.method,
            rt.original_payment_id,rc.original_sale_id,
            p.id AS payment_id,p.status AS payment_status,p.method AS payment_method,
            p.amount_minor::text AS payment_amount_minor,
            p.currency_code AS payment_currency,
            p.provider_reference AS payment_provider_reference,
            a.id AS checkout_id,a.state AS checkout_state,
            a.client_reference,a.merchant_collection_account,
            a.expected_amount_minor::text,a.currency_code AS checkout_currency,
            a.verified_provider_transaction_id AS original_transaction_id,
            a.credential_source,a.merchant_credential_revision
       FROM refund_transactions rt
       JOIN return_cases rc ON rc.id=rt.return_case_id
         AND rc.business_id=rt.business_id AND rc.branch_id=$3
       JOIN payments p ON p.id=rt.original_payment_id
         AND p.business_id=rt.business_id AND p.branch_id=rc.branch_id
         AND p.sale_id=rc.original_sale_id
       JOIN hubtel_sale_checkout_attempts a ON a.payment_id=p.id
         AND a.business_id=rt.business_id AND a.branch_id=rc.branch_id
         AND a.sale_id=rc.original_sale_id
      WHERE rt.business_id=$1 AND rt.id=$2
      ${lock ? "FOR UPDATE OF rt,p,a" : ""}`,
    [businessId, refundId, branchId],
  );
  return r.rows[0] ?? null;
}
function assertEligible(context: Context | null): asserts context is Context {
  if (!context) throw new OriginalOrderError(
    "A linked original Hubtel payment was not found in this branch.", 404,
    "REFUND_ORIGINAL_ORDER_NOT_FOUND");
  const originalMinor = safeMinor(context.payment_amount_minor, "original");
  const refundMinor = safeMinor(context.amount_minor, "refund");
  if (!["PENDING", "FAILED"].includes(context.status) ||
      context.method !== "MOMO" || context.payment_method !== "MOMO" ||
      context.payment_status !== "SUCCEEDED" ||
      context.checkout_state !== "RECONCILED" ||
      !context.original_transaction_id ||
      context.payment_provider_reference !== context.original_transaction_id ||
      context.currency_code !== "GHS" ||
      context.payment_currency !== context.currency_code ||
      context.checkout_currency !== context.currency_code ||
      safeMinor(context.expected_amount_minor, "checkout") !== originalMinor ||
      refundMinor !== originalMinor) {
    throw new OriginalOrderError(
      "Original Hubtel payment is not an eligible, fully matched refund source.",
      409, "REFUND_ORIGINAL_ORDER_NOT_ELIGIBLE");
  }
}
function sameContext(a: Context, b: Context) {
  const keys: (keyof Context)[] = [
    "id","business_id","branch_id","status","amount_minor","currency_code",
    "method","original_payment_id","original_sale_id","payment_id",
    "payment_status","payment_method","payment_amount_minor","payment_currency",
    "payment_provider_reference","checkout_id","checkout_state",
    "client_reference","merchant_collection_account","expected_amount_minor",
    "checkout_currency","original_transaction_id","credential_source",
    "merchant_credential_revision",
  ];
  return keys.every((key) => a[key] === b[key]);
}
function responseError(
  request: {log:{error:(error:unknown)=>void}},
  reply: {code:(status:number)=>{send:(payload:unknown)=>unknown}},
  error: unknown,
) {
  if (error instanceof OriginalOrderError || error instanceof AuthError ||
      error instanceof HubtelPosError || error instanceof HubtelStatusError)
    return reply.code(error.statusCode).send({error:error.code,message:error.message});
  request.log.error(error);
  return reply.code(500).send({error:"REFUND_ORIGINAL_ORDER_FAILED",
    message:"The original payment could not be checked safely."});
}
async function authScope(pool: DatabasePool, headers: {authorization?:string|undefined},
  businessId: string, branchId: string) {
  const auth = await authenticateAccessToken(pool, headers.authorization);
  await requireBusinessRole(pool, auth, businessId, ROLES);
  const branch = await pool.query(
    "SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true",
    [branchId,businessId]);
  if (branch.rowCount !== 1) throw new OriginalOrderError(
    "Branch was not found.",404,"REFUND_ORIGINAL_ORDER_BRANCH_NOT_FOUND");
  return auth;
}

export async function checkOriginalHubtelRefundOrder(
  pool: DatabasePool, input: {
    businessId:string;branchId:string;refundId:string;
    actorUserId:string;clientRequestId:string;
  },
  verify?: (context: Context,config: {
    apiId:string;apiKey:string;collectionAccount:string;
  })=>Promise<HubtelStatusVerification>,
) {
  const {businessId,branchId,refundId,clientRequestId,actorUserId}=input;
  const context=await loadContext(pool,businessId,branchId,refundId);
  assertEligible(context);

  const existing=(await pool.query<ObservationRow>(
    `SELECT * FROM refund_provider_order_observations
     WHERE refund_transaction_id=$1 AND client_request_id=$2`,
    [refundId,clientRequestId])).rows[0];
  if(existing){
    if(existing.actor_user_id!==actorUserId) throw new OriginalOrderError(
      "This request ID is already assigned to another reviewer.",409,
      "REFUND_ORIGINAL_ORDER_IDEMPOTENCY_CONFLICT");
    return publicObservation(existing,true);
  }

  const config=await requireHubtelPosConnection(pool,businessId,context.credential_source);
  if(config.collectionAccount!==context.merchant_collection_account ||
      config.credentialSource!==context.credential_source ||
      config.merchantCredentialRevision!==context.merchant_credential_revision) {
    throw new OriginalOrderError(
      "Original merchant account credentials no longer match; manual review required.",
      409, "REFUND_ORIGINAL_ORDER_CREDENTIAL_SCOPE_CHANGED");
  }
  // Atomic five-minute throttle, including errors or timeouts.
  // A failed network call cannot trigger an uncontrolled retry flood.
  const claimed=await pool.query<{refund_transaction_id:string}>(
    `INSERT INTO refund_provider_order_check_cooldowns
       (refund_transaction_id,business_id,branch_id)
     VALUES($1,$2,$3)
     ON CONFLICT(refund_transaction_id) DO UPDATE SET
       last_claimed_at=now(),
       attempt_count=refund_provider_order_check_cooldowns.attempt_count+1
     WHERE refund_provider_order_check_cooldowns.business_id=excluded.business_id
       AND refund_provider_order_check_cooldowns.branch_id=excluded.branch_id
       AND refund_provider_order_check_cooldowns.last_claimed_at
           <= now()-interval '5 minutes'
     RETURNING refund_transaction_id`,
    [refundId,businessId,branchId],
  );
  if(!claimed.rows[0]) throw new OriginalOrderError(
    "Original provider order was checked recently. Try again later.",429,
    "REFUND_ORIGINAL_ORDER_COOLDOWN");

  // This is ONLY the authenticated status of the ORIGINAL collection.
  // It never proves the recipient received a particular refund.
  const verified=verify
    ? await verify(context,config)
    : await new HubtelStatusClient({
        apiId:config.apiId,apiKey:config.apiKey,
        collectionAccount:config.collectionAccount,
      }).verifyStatus({
        clientReference:context.client_reference,
        expectedAmountMinor:safeMinor(context.expected_amount_minor,"checkout"),
        currencyCode:context.currency_code,
      });
  if(verified.clientReference!==context.client_reference ||
      verified.collectionAccount!==config.collectionAccount ||
      verified.currencyCode!=="GHS" ||
      (verified.status!=="UNPAID" &&
        verified.amountMinor!==safeMinor(context.expected_amount_minor,"checkout"))) {
    throw new OriginalOrderError(
      "Authenticated Hubtel order result differs from this original payment.",
      409,"REFUND_ORIGINAL_ORDER_STATUS_SCOPE_MISMATCH");
  }
  return withTransaction(pool,async tx=>{
    const current=await loadContext(tx,businessId,branchId,refundId,true);
    assertEligible(current);
    if(!sameContext(context,current)) throw new OriginalOrderError(
      "Original refund or payment changed while checking the provider.",409,
      "REFUND_ORIGINAL_ORDER_CHANGED");
    const kind=classifyAuthenticatedOriginalOrderStatus(
      verified,context.original_transaction_id!);
    const inserted=(await tx.query<ObservationRow>(
      `INSERT INTO refund_provider_order_observations
      (business_id,branch_id,refund_transaction_id,original_payment_id,
       checkout_attempt_id,actor_user_id,client_request_id,
       original_order_status,observation_kind,original_transaction_id,
       provider_transaction_id,original_payment_minor,refund_amount_minor,
       currency_code,verified_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'GHS',$14)
      RETURNING *`,
      [businessId,branchId,refundId,current.payment_id,current.checkout_id,
       actorUserId,clientRequestId,verified.status,kind,current.original_transaction_id,
       verified.transactionId,safeMinor(current.payment_amount_minor,"original"),
       safeMinor(current.amount_minor,"refund"),verified.verifiedAt],
    )).rows[0];
    if(!inserted) throw new OriginalOrderError(
      "Provider observation was not recorded.",409,
      "REFUND_ORIGINAL_ORDER_RECORD_FAILED");
    await tx.query(
      `INSERT INTO audit_events
       (business_id,branch_id,event_type,entity_type,entity_id,
        correlation_id,payload,occurred_at)
       VALUES($1,$2,'REFUND_ORIGINAL_HUBTEL_ORDER_CHECKED','REFUND_TRANSACTION',
       $3,$4,$5::jsonb,now())`,
      [businessId,branchId,refundId,inserted.id,
       JSON.stringify({observationId:inserted.id,actorUserId,kind,
         proofScope:"ORIGINAL_PAYMENT_ONLY",refundSettlementVerified:false})],
    );
    return publicObservation(inserted);
  });
}
export function registerRefundOriginalOrderRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{Querystring:{businessId?:string;branchId?:string;refundId?:string}}>(
    "/v1/refunds/hubtel-original-order-observations",async(request,reply)=>{
      reply.header("Cache-Control","private, no-store, max-age=0");
      try {
        const auth=await authenticateAccessToken(pool,request.headers.authorization);
        const businessId=required(request.query.businessId,"business ID");
        const branchId=required(request.query.branchId,"branch ID");
        const refundId=required(request.query.refundId,"refund ID");
        await requireBusinessRole(pool,auth,businessId,ROLES);
        const branch=await pool.query(
          "SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true",
          [branchId,businessId]);
        if(branch.rowCount!==1) throw new OriginalOrderError(
          "Branch was not found.",404,"REFUND_ORIGINAL_ORDER_BRANCH_NOT_FOUND");
        const scope=await pool.query(
          `SELECT rt.id FROM refund_transactions rt JOIN return_cases rc
           ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
           WHERE rt.id=$1 AND rt.business_id=$2 AND rc.branch_id=$3`,
          [refundId,businessId,branchId]);
        if(scope.rowCount!==1) throw new OriginalOrderError(
          "Refund was not found in this branch.",404,"REFUND_ORIGINAL_ORDER_NOT_FOUND");
        const context=await loadContext(pool,businessId,branchId,refundId);
        let eligible=false;
        try {assertEligible(context); eligible=true;} catch {eligible=false;}
        const config=eligible && context
          ? await hubtelPosConnection(pool,businessId,context.credential_source)
          : null;
        const recheckAvailable=Boolean(
          eligible && config && context &&
          config.collectionAccount===context.merchant_collection_account &&
          config.credentialSource===context.credential_source &&
          config.merchantCredentialRevision===context.merchant_credential_revision);
        const history=await pool.query<ObservationRow>(
          `SELECT o.* FROM refund_provider_order_observations o
           WHERE o.business_id=$1 AND o.branch_id=$2 AND o.refund_transaction_id=$3
           ORDER BY o.recorded_at DESC,o.id DESC LIMIT 20`,
          [businessId,branchId,refundId]);
        const cooldown=await pool.query<{last_claimed_at:Date}>(
          `SELECT last_claimed_at FROM refund_provider_order_check_cooldowns
           WHERE business_id=$1 AND branch_id=$2 AND refund_transaction_id=$3`,
          [businessId,branchId,refundId]);
        const claimedAt=cooldown.rows[0]?.last_claimed_at;
        const nextCheckAt=claimedAt
          ? new Date(claimedAt.getTime()+COOLDOWN_MINUTES*60000).toISOString()
          : null;
        return {
          refundId,
          observations:history.rows.map((row)=>publicObservation(row)),
          recheckAvailable,
          nextCheckAt,
          providerFinality:"NOT_ESTABLISHED" as const,
          refundDestinationVerified:false as const,
          refundSpecificSettlementVerified:false as const,
          canMarkPaid:false as const,
        };
      } catch(error){return responseError(request,reply,error);}
    });
  app.post<{Body:Record<string,unknown>}>(
    "/v1/refunds/hubtel-original-order-recheck",async(request,reply)=>{
      reply.header("Cache-Control","private, no-store, max-age=0");
      try{
        const b=request.body??{};
        const businessId=required(b.businessId,"business ID");
        const branchId=required(b.branchId,"branch ID");
        const refundId=required(b.refundId,"refund ID");
        const clientRequestId=required(b.clientRequestId,"request ID");
        const auth=await authScope(pool,request.headers,businessId,branchId);
        const result=await checkOriginalHubtelRefundOrder(pool,{
          businessId,branchId,refundId,clientRequestId,actorUserId:auth.userId,
        });
        return reply.code(result.idempotentReplay?200:201).send({observation:result});
      }catch(error){return responseError(request,reply,error);}
    });
}
