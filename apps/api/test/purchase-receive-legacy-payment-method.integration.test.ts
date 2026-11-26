import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";

const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("purchase receipt compatibility", () => {
  it("treats missing and blank legacy payment methods as supplier credit without deducting cash", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        displayName: "Legacy Buyer",
        email: "legacy-purchase@tradeos.test",
        password: "TradeOS-Test-1234",
        platform: "WEB",
        deviceKey: "legacy-purchase-device",
        appVersion: "legacy-test",
      },
    });
    expect(registration.statusCode).toBe(201);
    const headers = { authorization: `Bearer ${registration.json().session.accessToken}` };

    const onboard = await app.inject({
      method: "POST",
      url: "/v1/onboarding/business",
      headers,
      payload: { name: "Legacy Shop", businessType: "DRINKING_SPOT", branchName: "Main" },
    });
    expect(onboard.statusCode).toBe(201);
    const businessId = onboard.json().business.id as string;
    const branchId = onboard.json().branch.id as string;

    const supplier = await app.inject({
      method: "POST",
      url: "/v1/suppliers",
      headers,
      payload: { businessId, name: "Legacy Supplier", paymentTermsDays: 30 },
    });
    expect(supplier.statusCode).toBe(201);
    const supplierId = supplier.json().supplier.id as string;

    const catalog = await app.inject({
      method: "POST",
      url: "/v1/catalog/items",
      headers,
      payload: {
        businessId,
        name: "Legacy Stock Item",
        kind: "PRODUCT",
        trackStock: true,
        stockUnitCode: "piece",
        units: [{ code: "piece", label: "Piece", canStock: true, canPurchase: true }],
      },
    });
    expect(catalog.statusCode).toBe(201);
    const itemId = catalog.json().item.id as string;

    const sync = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers,
      payload: {
        mutations: [
          {
            clientId: "legacy-purchase-device",
            clientMutationId: "legacy-receipt-no-method",
            businessId,
            branchId,
            mutationType: "PURCHASE_RECEIVE_CREATE",
            occurredAt: new Date().toISOString(),
            payload: {
              supplierId,
              currencyCode: "GHS",
              lines: [{ itemId, quantity: 2, costMinor: 12000 }],
            },
          },
          {
            clientId: "legacy-purchase-device",
            clientMutationId: "legacy-receipt-blank-method",
            businessId,
            branchId,
            mutationType: "PURCHASE_RECEIVE_CREATE",
            occurredAt: new Date().toISOString(),
            payload: {
              supplierId,
              settlementMethod: "   ",
              currencyCode: "GHS",
              lines: [{ itemId, quantity: 1, costMinor: 5000 }],
            },
          },
        ],
      },
    });

    expect(sync.statusCode).toBe(200);
    const [missingMethod, blankMethod] = sync.json().mutationResults;
    expect(missingMethod.status).toBe("APPLIED");
    expect(missingMethod.result.totalMinor).toBe(24000);
    expect(blankMethod.status).toBe("APPLIED");
    expect(blankMethod.result.totalMinor).toBe(5000);

    const purchases = await pool.query<{ client_mutation_id: string; settlement_method: string; total_minor: string }>(
      `SELECT client_mutation_id,settlement_method,total_minor
       FROM purchases
       WHERE business_id=$1
       ORDER BY client_mutation_id`,
      [businessId],
    );
    expect(purchases.rows).toEqual([
      { client_mutation_id: "legacy-receipt-blank-method", settlement_method: "SUPPLIER_CREDIT", total_minor: "5000" },
      { client_mutation_id: "legacy-receipt-no-method", settlement_method: "SUPPLIER_CREDIT", total_minor: "24000" },
    ]);

    const payable = await pool.query<{ balance: string }>(
      `SELECT COALESCE(SUM(balance_delta_minor),0)::text AS balance
       FROM supplier_payable_ledger
       WHERE business_id=$1 AND supplier_id=$2`,
      [businessId, supplierId],
    );
    expect(Number(payable.rows[0]!.balance)).toBe(29000);

    const cashbook = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM cashbook_entries
       WHERE business_id=$1 AND source_type='PURCHASE'`,
      [businessId],
    );
    expect(Number(cashbook.rows[0]!.count)).toBe(0);
  });

  it("recovers only an identical authorized historical rejection once, even with concurrent retries", async () => {
    const device = "historical-recovery-device";
    const registration = await app.inject({
      method: "POST", url: "/v1/auth/register",
      payload: { displayName: "Historical Buyer", email: "historical-recovery@tradeos.test",
        password: "TradeOS-Test-1234", platform: "WEB", deviceKey: device, appVersion: "legacy-test" },
    });
    expect(registration.statusCode).toBe(201);
    const headers = { authorization: `Bearer ${registration.json().session.accessToken}` };
    const onboard = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers,
      payload: { name: "Historical Shop", businessType: "DRINKING_SPOT", branchName: "Main" } });
    expect(onboard.statusCode).toBe(201);
    const businessId = onboard.json().business.id as string;
    const branchId = onboard.json().branch.id as string;
    const actor = (await pool.query<{staff_id:string}>(
      "SELECT staff_id FROM business_memberships WHERE business_id=$1 AND is_active=true LIMIT 1", [businessId]
    )).rows[0]!.staff_id;
    expect(actor).toBeTruthy();
    const supplier = await app.inject({method:"POST",url:"/v1/suppliers",headers,
      payload:{businessId,name:"Historical Supplier",paymentTermsDays:30}});
    expect(supplier.statusCode).toBe(201);
    const supplierId = supplier.json().supplier.id as string;
    const item = await app.inject({method:"POST",url:"/v1/catalog/items",headers,
      payload:{businessId,name:"Historical Stock",kind:"PRODUCT",trackStock:true,stockUnitCode:"piece",
        units:[{code:"piece",label:"Piece",canStock:true,canPurchase:true}]}});
    expect(item.statusCode).toBe(201);
    const itemId = item.json().item.id as string;
    const mutation = {clientId:device,clientMutationId:"historical-original",businessId,branchId,
      mutationType:"PURCHASE_RECEIVE_CREATE",occurredAt:new Date().toISOString(),
      payload:{supplierId,currencyCode:"GHS",lines:[{itemId,quantity:2,costMinor:12000}]}};
    const oldError = {errorCode:"PURCHASE_INVALID",errorMessage:"Invalid settlement method"};
    async function seed(value:typeof mutation, error=oldError, storedActor=actor) {
      await pool.query(
        `INSERT INTO sync_mutations (business_id,branch_id,client_id,client_mutation_id,mutation_type,request_payload,status,result_payload,applied_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,'REJECTED',$7::jsonb,now())`,
        [businessId,branchId,device,value.clientMutationId,value.mutationType,
         JSON.stringify({...value,payload:{...value.payload,receivedByStaffId:storedActor}}),JSON.stringify(error)]);
    }
    const send = (value:unknown) => app.inject({method:"POST",url:"/v1/sync",headers,payload:{mutations:[value]}});
    await seed(mutation);
    const changed = await send({...mutation,payload:{...mutation.payload,lines:[{itemId,quantity:3,costMinor:12000}]}});
    expect(changed.statusCode).toBe(200);
    expect(changed.json().mutationResults[0]).toMatchObject({status:"REJECTED",errorCode:"PURCHASE_REPLAY_CONFLICT"});
    const timestampChanged = await send({...mutation,occurredAt:new Date(Date.parse(mutation.occurredAt)+1000).toISOString()});
    expect(timestampChanged.json().mutationResults[0]).toMatchObject({status:"REJECTED",errorCode:"PURCHASE_REPLAY_CONFLICT"});
    const wrongType = await send({...mutation,mutationType:"SUPPLIER_PAYMENT_CREATE"});
    expect(wrongType.json().mutationResults[0]).toMatchObject({status:"REJECTED",errorCode:"PURCHASE_REPLAY_CONFLICT"});
    const wrongActor = {...mutation,clientMutationId:"historical-other-actor"};
    await seed(wrongActor,oldError,"00000000-0000-4000-8000-000000000001");
    expect((await send(wrongActor)).json().mutationResults[0]).toMatchObject({status:"REJECTED",errorCode:"PURCHASE_REPLAY_CONFLICT"});
    const unrelated = {...mutation,clientMutationId:"historical-unrelated"};
    await seed(unrelated,{errorCode:"PURCHASE_INVALID",errorMessage:"Item/unit is not configured for purchasing"});
    expect((await send(unrelated)).json().mutationResults[0]).toMatchObject({status:"REJECTED",errorMessage:"Item/unit is not configured for purchasing"});
    const attempts = await Promise.all([send(mutation),send(mutation)]);
    for(const response of attempts) {
      expect(response.statusCode).toBe(200);
      expect(["APPLIED","RECEIVED"]).toContain(response.json().mutationResults[0].status);
    }
    const replay=await send(mutation);
    expect(replay.json().mutationResults[0]).toMatchObject({status:"APPLIED",result:{totalMinor:24000}});
    const receipts=await pool.query<{count:string,total:string}>(
      "SELECT COUNT(*)::text AS count,COALESCE(SUM(total_minor),0)::text AS total FROM purchases WHERE business_id=$1",[businessId]);
    expect(receipts.rows[0]).toEqual({count:"1",total:"24000"});
    const ledger=await pool.query<{count:string,total:string}>(
      "SELECT COUNT(*)::text AS count,COALESCE(SUM(balance_delta_minor),0)::text AS total FROM supplier_payable_ledger WHERE business_id=$1 AND supplier_id=$2",[businessId,supplierId]);
    expect(ledger.rows[0]).toEqual({count:"1",total:"24000"});
    const cash=await pool.query<{count:string}>("SELECT COUNT(*)::text AS count FROM cashbook_entries WHERE business_id=$1 AND source_type='PURCHASE'",[businessId]);
    expect(cash.rows[0]!.count).toBe("0");
    const audit=await pool.query<{payload:{previousError:typeof oldError}}>({
      text:"SELECT payload FROM audit_events WHERE business_id=$1 AND event_type='LEGACY_PURCHASE_RECOVERY_CLAIMED'",values:[businessId]});
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.payload.previousError).toEqual(oldError);
    const revoked={...mutation,clientMutationId:"historical-revoked"};
    await seed(revoked);
    await pool.query("UPDATE business_memberships SET is_active=false WHERE business_id=$1",[businessId]);
    expect((await send(revoked)).statusCode).toBeGreaterThanOrEqual(400);
    const state=await pool.query<{status:string}>("SELECT status FROM sync_mutations WHERE business_id=$1 AND client_mutation_id=$2",[businessId,revoked.clientMutationId]);
    expect(state.rows[0]!.status).toBe("REJECTED");
  });
});
