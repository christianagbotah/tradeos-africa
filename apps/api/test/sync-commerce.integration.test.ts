import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { ingestSyncBatch } from "../src/sync.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();

const businessId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const whiskyId = "33333333-3333-4333-8333-333333333333";
const customerId = "44444444-4444-4444-8444-444444444444";
const inactiveCustomerId = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE businesses CASCADE");
  await pool.query(
    `INSERT INTO businesses (id,name,business_type) VALUES ($1,'TradeOS Test Spot','DRINKING_SPOT')`,
    [businessId],
  );
  await pool.query(
    `INSERT INTO branches (id,business_id,name,code) VALUES ($1,$2,'Main','MAIN')`,
    [branchId, businessId],
  );
  await pool.query(
    `INSERT INTO customers (id,business_id,name,phone,credit_limit_minor,is_active)
     VALUES ($1,$3,'Ama Mensah','0240000000',NULL,true),
            ($2,$3,'Archived Customer','0200000000',NULL,false)`,
    [customerId, inactiveCustomerId, businessId],
  );
  await seedWhisky();
});

afterAll(async () => { await pool.end(); });

describe("offline commerce mutations", () => {
  it("applies a bulk-unit sale once and replays the same sync result idempotently", async () => {
    const mutation = {
      clientId: "test-device",
      clientMutationId: "sale-whisky-001",
      businessId,
      branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        paymentMethod: "CASH",
        lines: [{ itemId: whiskyId, quantity: 2, saleUnitCode: "glass" }],
      },
    };

    const first = await ingestSyncBatch(pool, { mutations: [mutation] });
    const second = await ingestSyncBatch(pool, { mutations: [mutation] });

    expect(first.mutationResults[0]?.status).toBe("APPLIED");
    expect(second.mutationResults[0]?.status).toBe("APPLIED");
    expect(await availableStock()).toBe(650);

    const counts = await pool.query<{ sales: string; movements: string }>(
      `SELECT (SELECT COUNT(*) FROM sales)::text AS sales,
              (SELECT COUNT(*) FROM inventory_movements WHERE reason='SALE')::text AS movements`,
    );
    expect(Number(counts.rows[0]?.sales)).toBe(1);
    expect(Number(counts.rows[0]?.movements)).toBe(1);
  });

  it("rejects a changed offline sale cart, tender or branch on reuse of the original mutation ID",async()=>{
    const mutation={clientId:"sale-replay-device",clientMutationId:"immutable-sale",businessId,branchId,
      occurredAt:new Date().toISOString(),mutationType:"SALE_CREATE",
      payload:{currencyCode:"GHS",paymentMethod:"CASH",lines:[{itemId:whiskyId,quantity:1,saleUnitCode:"glass"}]}};
    const first=(await ingestSyncBatch(pool,{mutations:[mutation]})).mutationResults[0]!;
    expect(first.status).toBe("APPLIED");
    const exact=(await ingestSyncBatch(pool,{mutations:[{...mutation,payload:{lines:mutation.payload.lines,paymentMethod:"CASH",currencyCode:"GHS"}}]})).mutationResults[0]!;
    expect(exact.result).toEqual(first.result);
    const otherBranch=randomUUID();
    await pool.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Second','SECOND')",[otherBranch,businessId]);
    for(const altered of [
      {...mutation,payload:{...mutation.payload,lines:[{...mutation.payload.lines[0]!,quantity:2}]}},
      {...mutation,payload:{...mutation.payload,paymentMethod:"MOMO"}},
      {...mutation,payload:{...mutation.payload,customerId}},
      {...mutation,branchId:otherBranch},
      {...mutation,mutationType:"RETURN_CREATE"},
    ]){
      expect((await ingestSyncBatch(pool,{mutations:[altered]})).mutationResults[0]).toMatchObject({status:"REJECTED",errorCode:"FINANCIAL_REPLAY_CONFLICT"});
    }
    expect(await availableStock()).toBe(700);
    const counts=(await pool.query("SELECT (SELECT count(*)::int FROM sales) AS sales,(SELECT count(*)::int FROM payments) AS payments,(SELECT count(*)::int FROM cashbook_entries WHERE entry_type='SALE_RECEIPT') AS receipts")).rows[0];
    expect(counts).toEqual({sales:1,payments:1,receipts:1});
    expect((await ingestSyncBatch(pool,{mutations:[mutation]})).mutationResults[0]?.result).toEqual(first.result);
  });

  it("serializes competing offline checkouts so only one can consume the remaining stock",async()=>{
    const mutation=(clientId:string)=>({clientId,clientMutationId:"stock-race-"+clientId,businessId,branchId,
      occurredAt:new Date().toISOString(),mutationType:"SALE_CREATE",
      payload:{currencyCode:"GHS",paymentMethod:"CASH",lines:[{itemId:whiskyId,quantity:10,saleUnitCode:"glass"}]}});
    const requests=[mutation("device-a"),mutation("device-b")];
    const results=await Promise.all(requests.map(async m=>(await ingestSyncBatch(pool,{mutations:[m]})).mutationResults[0]!));
    expect(results.map(r=>r.status).sort()).toEqual(["APPLIED","REJECTED"]);
    expect(await availableStock()).toBe(250);
    const counts=(await pool.query("SELECT (SELECT count(*)::int FROM sales) AS sales,(SELECT count(*)::int FROM payments) AS payments,(SELECT count(*)::int FROM cashbook_entries WHERE entry_type='SALE_RECEIPT') AS receipts")).rows[0];
    expect(counts).toEqual({sales:1,payments:1,receipts:1});
    for(let i=0;i<requests.length;i++){
      const replay=(await ingestSyncBatch(pool,{mutations:[requests[i]!]})).mutationResults[0]!;
      expect(replay.status).toBe(results[i]!.status);
    }
    expect(await availableStock()).toBe(250);
  });

  it("rolls back a new sale when writing its sync acknowledgement fails, then retries exactly once",async()=>{
    // Test-only fault injection against the disposable CI PostgreSQL database.
    const mutation={clientId:"atomic-sale-device",clientMutationId:"atomic-sale-fault",businessId,branchId,
      occurredAt:new Date().toISOString(),mutationType:"SALE_CREATE",
      payload:{currencyCode:"GHS",paymentMethod:"CASH",lines:[{itemId:whiskyId,quantity:2,saleUnitCode:"glass"}]}};
    await pool.query(`CREATE FUNCTION qa_fail_sale_ack() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.client_mutation_id='atomic-sale-fault' AND NEW.status='APPLIED' THEN
      RAISE EXCEPTION 'Synthetic acknowledgement failure'; END IF; RETURN NEW; END $$`);
    try{
      await pool.query("CREATE TRIGGER qa_fail_sale_ack BEFORE UPDATE ON sync_mutations FOR EACH ROW EXECUTE FUNCTION qa_fail_sale_ack()");
      await expect(ingestSyncBatch(pool,{mutations:[mutation]})).rejects.toThrow("Synthetic acknowledgement failure");
      const counts=(await pool.query("SELECT (SELECT count(*)::int FROM sales) AS sales,(SELECT count(*)::int FROM payments) AS payments,(SELECT count(*)::int FROM cashbook_entries) AS cashbook,(SELECT count(*)::int FROM sync_mutations) AS sync")).rows[0];
      expect(counts).toEqual({sales:0,payments:0,cashbook:0,sync:0});
      expect(await availableStock()).toBe(750);
    }finally{
      await pool.query("DROP TRIGGER IF EXISTS qa_fail_sale_ack ON sync_mutations");
      await pool.query("DROP FUNCTION IF EXISTS qa_fail_sale_ack()");
    }
    const first=(await ingestSyncBatch(pool,{mutations:[mutation]})).mutationResults[0]!;
    expect(first.status).toBe("APPLIED");
    expect((await ingestSyncBatch(pool,{mutations:[mutation]})).mutationResults[0]?.result).toEqual(first.result);
    expect(await availableStock()).toBe(650);
    expect((await pool.query("SELECT (SELECT count(*)::int FROM sales) AS sales,(SELECT count(*)::int FROM payments) AS payments,(SELECT count(*)::int FROM cashbook_entries) AS cashbook,(SELECT count(*)::int FROM sync_mutations WHERE status='APPLIED') AS sync")).rows[0]).toEqual({sales:1,payments:1,cashbook:1,sync:1});
  });

  it("rejects reuse of a sale identifier on another device and leaves historical RECEIVED records alone",async()=>{
    const mutation={clientId:"original-device",clientMutationId:"shared-sale-id",businessId,branchId,
      occurredAt:new Date().toISOString(),mutationType:"SALE_CREATE",
      payload:{currencyCode:"GHS",paymentMethod:"CASH",lines:[{itemId:whiskyId,quantity:1,saleUnitCode:"glass"}]}};
    const first=(await ingestSyncBatch(pool,{mutations:[mutation]})).mutationResults[0]!;
    expect(first.status).toBe("APPLIED");
    const other=(await ingestSyncBatch(pool,{mutations:[{...mutation,clientId:"other-device"}]})).mutationResults[0]!;
    expect(other).toMatchObject({status:"REJECTED",errorCode:"SALE_DEVICE_REPLAY_CONFLICT"});
    const historical={...mutation,clientMutationId:"historical-received"};
    await pool.query("INSERT INTO sync_mutations(business_id,branch_id,client_id,client_mutation_id,mutation_type,request_payload,status) VALUES($1,$2,$3,$4,'SALE_CREATE',$5::jsonb,'RECEIVED')",
      [businessId,branchId,historical.clientId,historical.clientMutationId,JSON.stringify(historical)]);
    expect((await ingestSyncBatch(pool,{mutations:[historical]})).mutationResults[0]?.status).toBe("RECEIVED");
    expect(await availableStock()).toBe(700);
    expect((await pool.query("SELECT count(*)::int AS count FROM sales")).rows[0]?.count).toBe(1);
  });

  it("associates named customers with immediate CASH and MOMO sales without creating credit debt", async () => {
    const cash = await ingestSyncBatch(pool, { mutations: [{
      clientId: "pos-device",
      clientMutationId: "named-cash-001",
      businessId,
      branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        customerId,
        paymentMethod: "CASH",
        lines: [{ itemId: whiskyId, quantity: 1, saleUnitCode: "glass" }],
      },
    }] });
    const momo = await ingestSyncBatch(pool, { mutations: [{
      clientId: "pos-device",
      clientMutationId: "named-momo-001",
      businessId,
      branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        customerId,
        paymentMethod: "MOMO",
        lines: [{ itemId: whiskyId, quantity: 1, saleUnitCode: "glass" }],
      },
    }] });

    expect(cash.mutationResults[0]?.status).toBe("APPLIED");
    expect(momo.mutationResults[0]?.status).toBe("APPLIED");

    const sales = await pool.query<{ client_mutation_id: string; customer_id: string | null }>(
      `SELECT client_mutation_id,customer_id FROM sales
       WHERE business_id=$1 AND client_mutation_id IN ('named-cash-001','named-momo-001')
       ORDER BY client_mutation_id`, [businessId],
    );
    expect(sales.rows).toEqual([
      { client_mutation_id: "named-cash-001", customer_id: customerId },
      { client_mutation_id: "named-momo-001", customer_id: customerId },
    ]);

    const creditEntries = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM customer_account_entries WHERE business_id=$1 AND customer_id=$2`,
      [businessId, customerId],
    );
    expect(Number(creditEntries.rows[0]?.count)).toBe(0);
  });

  it("keeps Walk-in sales customer-free and rejects invalid customer-credit combinations", async () => {
    const walkIn = await ingestSyncBatch(pool, { mutations: [{
      clientId: "pos-device",
      clientMutationId: "walk-in-cash-001",
      businessId,
      branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        paymentMethod: "CASH",
        lines: [{ itemId: whiskyId, quantity: 1, saleUnitCode: "glass" }],
      },
    }] });
    expect(walkIn.mutationResults[0]?.status).toBe("APPLIED");
    const walkInRow = await pool.query<{ customer_id: string | null }>(
      `SELECT customer_id FROM sales WHERE business_id=$1 AND client_mutation_id='walk-in-cash-001'`, [businessId],
    );
    expect(walkInRow.rows[0]?.customer_id).toBeNull();

    const inactive = await ingestSyncBatch(pool, { mutations: [{
      clientId: "pos-device",
      clientMutationId: "inactive-customer-cash-001",
      businessId,
      branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        customerId: inactiveCustomerId,
        paymentMethod: "CASH",
        lines: [{ itemId: whiskyId, quantity: 1, saleUnitCode: "glass" }],
      },
    }] });
    expect(inactive.mutationResults[0]?.status).toBe("REJECTED");
    expect(inactive.mutationResults[0]?.errorCode).toBe("CUSTOMER_INACTIVE");

    const noCustomerCredit = await ingestSyncBatch(pool, { mutations: [{
      clientId: "pos-device",
      clientMutationId: "walk-in-credit-001",
      businessId,
      branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        paymentMethod: "CUSTOMER_CREDIT",
        lines: [{ itemId: whiskyId, quantity: 1, saleUnitCode: "glass" }],
      },
    }] });
    expect(noCustomerCredit.mutationResults[0]?.status).toBe("REJECTED");
    expect(noCustomerCredit.mutationResults[0]?.errorCode).toBe("CUSTOMER_REQUIRED_FOR_CREDIT");
  });

  it("returns one sold glass as its historical 50 ml and reverses cash immediately", async () => {
    const saleMutation = {
      clientId: "test-device",
      clientMutationId: "sale-for-return-001",
      businessId,
      branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        paymentMethod: "CASH",
        lines: [{ itemId: whiskyId, quantity: 2, saleUnitCode: "glass" }],
      },
    };
    await ingestSyncBatch(pool, { mutations: [saleMutation] });

    const sale = await pool.query<{ sale_id: string; line_id: string }>(
      `SELECT s.id AS sale_id,sl.id AS line_id FROM sales s JOIN sale_lines sl ON sl.sale_id=s.id
       WHERE s.client_mutation_id=$1`, [saleMutation.clientMutationId],
    );
    const ids = sale.rows[0]!;
    const returnMutation = {
      clientId: "test-device",
      clientMutationId: "return-whisky-001",
      businessId,
      branchId,
      mutationType: "RETURN_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        originalSaleId: ids.sale_id,
        reason: "Wrong drink served",
        refundMethod: "ORIGINAL_METHOD",
        lines: [{ saleLineId: ids.line_id, quantity: 1, disposition: "RESTOCK" }],
      },
    };

    const response = await ingestSyncBatch(pool, { mutations: [returnMutation] });
    expect(response.mutationResults[0]?.status).toBe("APPLIED");
    expect(await availableStock()).toBe(700);

    const payment = await pool.query<{ status: string }>(`SELECT status FROM payments WHERE sale_id=$1`, [ids.sale_id]);
    expect(payment.rows[0]?.status).toBe("PARTIALLY_REVERSED");

    const returned = await pool.query<{ quantity_delta: string }>(
      `SELECT quantity_delta::text FROM inventory_movements WHERE reason='SALE_RETURN'`,
    );
    expect(Number(returned.rows[0]?.quantity_delta)).toBe(50);
  });

  it("reconciles repeated partial CASH returns through final refund without duplicating stock, money or audit", async () => {
    // A single sale of two glasses (2 × 50 ml) is refunded in two separate,
    // legitimate partial returns. This runs against the CI-only PostgreSQL DB.
    const saleMutation = {
      clientId: "multi-return-device",
      clientMutationId: "multi-return-sale-001",
      businessId, branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        customerId,
        paymentMethod: "CASH",
        lines: [{ itemId: whiskyId, quantity: 2, saleUnitCode: "glass" }],
      },
    };
    const postedSale = await ingestSyncBatch(pool, { mutations: [saleMutation] });
    expect(postedSale.mutationResults[0]?.status).toBe("APPLIED");
    const saleId = (postedSale.mutationResults[0]?.result as { saleId: string }).saleId;
    const saleLineId = (await pool.query<{ id: string }>(
      `SELECT id FROM sale_lines WHERE sale_id=$1`, [saleId],
    )).rows[0]!.id;
    expect(await availableStock()).toBe(650);

    const correction = (id: string) => ({
      clientId: "multi-return-device",
      clientMutationId: id,
      businessId, branchId,
      mutationType: "RETURN_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        originalSaleId: saleId,
        reason: "Customer returned one glass",
        refundMethod: "ORIGINAL_METHOD",
        lines: [{ saleLineId, quantity: 1, disposition: "RESTOCK" }],
      },
    });
    const first = correction("multi-return-1");
    const one = await ingestSyncBatch(pool, { mutations: [first] });
    expect(one.mutationResults[0]?.status).toBe("APPLIED");
    const firstCase = (one.mutationResults[0]?.result as { returnCaseId: string }).returnCaseId;
    expect(await availableStock()).toBe(700);
    expect((await pool.query<{ status: string }>(
      `SELECT status FROM sales WHERE id=$1`, [saleId],
    )).rows[0]?.status).toBe("PARTIALLY_REFUNDED");

    // Re-sending the same device+mutation ID is an idempotent query, not
    // another refund. Both return and cashbook ledger remain unchanged.
    const replay = await ingestSyncBatch(pool, { mutations: [first] });
    expect(replay.mutationResults[0]?.status).toBe("APPLIED");
    expect((replay.mutationResults[0]?.result as { returnCaseId: string }).returnCaseId).toBe(firstCase);
    expect(await availableStock()).toBe(700);
    const alteredReplay = {
      ...first,
      payload: {
        ...first.payload,
        reason: "A changed reason must not be accepted as the original posting",
      },
    };
    const conflicting = await ingestSyncBatch(pool, { mutations: [alteredReplay] });
    expect(conflicting.mutationResults[0]).toMatchObject({
      status: "REJECTED", errorCode: "FINANCIAL_REPLAY_CONFLICT",
    });
    expect(await availableStock()).toBe(700);

    const second = await ingestSyncBatch(pool, { mutations: [correction("multi-return-2")] });
    expect(second.mutationResults[0]?.status).toBe("APPLIED");
    expect(await availableStock()).toBe(750);
    expect((await pool.query<{ status: string }>(
      `SELECT status FROM sales WHERE id=$1`, [saleId],
    )).rows[0]?.status).toBe("REFUNDED");
    expect((await pool.query<{ status: string }>(
      `SELECT status FROM payments WHERE sale_id=$1`, [saleId],
    )).rows[0]?.status).toBe("REVERSED");

    const third = await ingestSyncBatch(pool, { mutations: [correction("multi-return-3")] });
    expect(third.mutationResults[0]?.status).toBe("REJECTED");
    expect(await availableStock()).toBe(750);

    const refundCases = await pool.query<{ id: string; refund_total_minor: string; status: string }>(
      `SELECT id,refund_total_minor,status FROM return_cases WHERE original_sale_id=$1 ORDER BY id`, [saleId],
    );
    expect(refundCases.rows).toHaveLength(2);
    expect(refundCases.rows.every((row) => row.status === "COMPLETED")).toBe(true);
    expect(refundCases.rows.reduce((sum, row) => sum + Number(row.refund_total_minor), 0)).toBe(3600);
    const refunds = await pool.query<{ status: string; amount_minor: string; method: string }>(
      `SELECT status,amount_minor,method FROM refund_transactions WHERE return_case_id=ANY($1::uuid[])`,
      [refundCases.rows.map((row) => row.id)],
    );
    expect(refunds.rows).toHaveLength(2);
    expect(refunds.rows.every((row) => row.status === "SUCCEEDED" && row.method === "CASH")).toBe(true);
    expect(refunds.rows.reduce((sum, row) => sum + Number(row.amount_minor), 0)).toBe(3600);

    const movements = await pool.query<{ quantity_delta: string }>(
      `SELECT quantity_delta FROM inventory_movements
       WHERE business_id=$1 AND item_id=$2 AND reason='SALE_RETURN'`, [businessId, whiskyId],
    );
    expect(movements.rows).toHaveLength(2);
    expect(movements.rows.map((row) => Number(row.quantity_delta)).sort()).toEqual([50, 50]);

    const cashbook = await pool.query<{ entry_type: string; amount_delta_minor: string }>(
      `SELECT entry_type,amount_delta_minor FROM cashbook_entries
       WHERE business_id=$1 AND source_type IN ('PAYMENT','REFUND_TRANSACTION')
       ORDER BY entry_type,amount_delta_minor`, [businessId],
    );
    expect(cashbook.rows.map((row) => [row.entry_type, Number(row.amount_delta_minor)]).sort())
      .toEqual([["SALE_RECEIPT", 3600], ["SALE_REFUND", -1800], ["SALE_REFUND", -1800]].sort());
    expect(cashbook.rows.reduce((sum, row) => sum + Number(row.amount_delta_minor), 0)).toBe(0);

    const audited = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE business_id=$1 AND entity_type='RETURN_CASE'
       AND entity_id=ANY($2::uuid[])`, [businessId, refundCases.rows.map((row) => row.id)],
    );
    expect(audited.rows).toHaveLength(2);
    expect(audited.rows.every((row) => row.event_type === "RETURN_ACCEPTED")).toBe(true);
  });

  it("separates quarantined, discarded and retained goods while reconciling cash and historical cost", async () => {
    await pool.query("INSERT INTO inventory_valuations(business_id,branch_id,item_id,location_type,quantity,value_minor) VALUES($1,$2,$3,'AVAILABLE',750,7500)",[businessId,branchId,whiskyId]);
    const context={clientId:"disposition-device",businessId,branchId,occurredAt:new Date().toISOString()};
    const sold=await ingestSyncBatch(pool,{mutations:[{...context,clientMutationId:"disposition-sale",mutationType:"SALE_CREATE",
      payload:{currencyCode:"GHS",paymentMethod:"CASH",lines:[{itemId:whiskyId,quantity:3,saleUnitCode:"glass"}]}}]});
    expect(sold.mutationResults[0]?.status).toBe("APPLIED");
    const saleId=(sold.mutationResults[0]?.result as {saleId:string}).saleId;
    const line=(await pool.query<{id:string;line_cost_minor:string}>("SELECT id,line_cost_minor FROM sale_lines WHERE sale_id=$1",[saleId])).rows[0]!;
    expect(Number(line.line_cost_minor)).toBe(1500);
    expect(await availableStock()).toBe(600);
    for(const disposition of ["QUARANTINE","DISCARD","NOT_RETURNED"] as const){
      const mutation={...context,clientMutationId:"disposition-"+disposition,mutationType:"RETURN_CREATE",
        payload:{originalSaleId:saleId,reason:"Synthetic return disposition",refundMethod:"ORIGINAL_METHOD",lines:[{saleLineId:line.id,quantity:1,disposition}]}};
      const first=await ingestSyncBatch(pool,{mutations:[mutation]});
      expect(first.mutationResults[0]?.status).toBe("APPLIED");
      const replay=await ingestSyncBatch(pool,{mutations:[mutation]});
      expect(replay.mutationResults[0]?.result).toMatchObject({returnCaseId:(first.mutationResults[0]?.result as {returnCaseId:string}).returnCaseId});
      expect(await availableStock()).toBe(600);
    }
    const rows=(await pool.query<{disposition:string;cogs_reversal_minor:string;discarded_cost_minor:string}>(
      "SELECT l.disposition,l.cogs_reversal_minor,l.discarded_cost_minor FROM return_lines l JOIN return_cases c ON c.id=l.return_case_id WHERE c.original_sale_id=$1 ORDER BY l.disposition",[saleId])).rows;
    expect(rows.map(r=>[r.disposition,Number(r.cogs_reversal_minor),Number(r.discarded_cost_minor)])).toEqual([["DISCARD",0,500],["NOT_RETURNED",0,0],["QUARANTINE",500,0]]);
    const stock=(await pool.query<{location_type:string;quantity:string;value_minor:string}>("SELECT location_type,quantity,value_minor FROM inventory_valuations WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 ORDER BY location_type",[businessId,branchId,whiskyId])).rows;
    expect(stock.map(r=>[r.location_type,Number(r.quantity),Number(r.value_minor)])).toEqual([["AVAILABLE",600,6000],["QUARANTINE",50,500]]);
    const movements=(await pool.query<{location_type:string;quantity_delta:string}>("SELECT location_type,quantity_delta FROM inventory_movements WHERE business_id=$1 AND reason='SALE_RETURN'",[businessId])).rows;
    expect(movements.map(r=>[r.location_type,Number(r.quantity_delta)])).toEqual([["QUARANTINE",50]]);
    const cash=(await pool.query<{entry_type:string;amount_delta_minor:string}>("SELECT entry_type,amount_delta_minor FROM cashbook_entries WHERE business_id=$1 AND source_type IN ('PAYMENT','REFUND_TRANSACTION')",[businessId])).rows;
    expect(cash.map(r=>[r.entry_type,Number(r.amount_delta_minor)]).sort()).toEqual([["SALE_RECEIPT",5400],["SALE_REFUND",-1800],["SALE_REFUND",-1800],["SALE_REFUND",-1800]].sort());
    expect((await pool.query("SELECT status FROM sales WHERE id=$1",[saleId])).rows[0]?.status).toBe("REFUNDED");
    expect((await pool.query("SELECT status FROM payments WHERE sale_id=$1",[saleId])).rows[0]?.status).toBe("REVERSED");
  });

  it("keeps MoMo refunds pending instead of pretending the provider already reversed money", async () => {
    const saleMutation = {
      clientId: "test-device",
      clientMutationId: "sale-momo-001",
      businessId,
      branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        paymentMethod: "MOMO",
        lines: [{ itemId: whiskyId, quantity: 1, saleUnitCode: "glass" }],
      },
    };
    await ingestSyncBatch(pool, { mutations: [saleMutation] });
    const sale = await pool.query<{ sale_id: string; line_id: string }>(
      `SELECT s.id AS sale_id,sl.id AS line_id FROM sales s JOIN sale_lines sl ON sl.sale_id=s.id
       WHERE s.client_mutation_id=$1`, [saleMutation.clientMutationId],
    );
    const ids = sale.rows[0]!;

    const response = await ingestSyncBatch(pool, {
      mutations: [{
        clientId: "test-device",
        clientMutationId: "return-momo-001",
        businessId,
        branchId,
        mutationType: "RETURN_CREATE",
        occurredAt: new Date().toISOString(),
        payload: {
          originalSaleId: ids.sale_id,
          reason: "Customer requested refund",
          refundMethod: "ORIGINAL_METHOD",
          lines: [{ saleLineId: ids.line_id, quantity: 1, disposition: "RESTOCK" }],
        },
      }],
    });

    expect(response.mutationResults[0]?.status).toBe("APPLIED");
    const refund = await pool.query<{ status: string; method: string }>(`SELECT status,method FROM refund_transactions`);
    expect(refund.rows[0]).toMatchObject({ status: "PENDING", method: "MOMO" });
    const returnCase = await pool.query<{ status: string }>(`SELECT status FROM return_cases`);
    expect(returnCase.rows[0]?.status).toBe("PROCESSING");
  });
});

async function seedWhisky(): Promise<void> {
  await pool.query(
    `INSERT INTO catalog_items (id,business_id,sku,name,kind,stock_unit_code,track_stock)
     VALUES ($1,$2,'WHISKY-750','Whisky 750 ml','PRODUCT','ml',true)`, [whiskyId,businessId],
  );
  await pool.query(
    `INSERT INTO catalog_item_units (business_id,item_id,unit_code,unit_label,can_purchase,can_sell,can_stock,default_sale_price_minor)
     VALUES ($1,$2,'ml','Millilitre',false,false,true,NULL),
            ($1,$2,'bottle','Bottle',true,true,false,27000),
            ($1,$2,'glass','Glass',false,true,false,1800)`, [businessId,whiskyId],
  );
  await pool.query(
    `INSERT INTO item_unit_conversions (business_id,item_id,from_unit_code,to_unit_code,factor)
     VALUES ($1,$2,'bottle','ml',750),($1,$2,'glass','ml',50)`, [businessId,whiskyId],
  );
  await pool.query(
    `INSERT INTO inventory_movements (
       business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,reason,
       reference_type,reference_id,idempotency_key,occurred_at
     ) VALUES ($1,$2,$3,'ml',750,'AVAILABLE','OPENING_BALANCE','TEST',$4,$5,now())`,
    [businessId,branchId,whiskyId,randomUUID(),randomUUID()],
  );
}

async function availableStock(): Promise<number> {
  const result = await pool.query<{ quantity: string | number }>(
    `SELECT COALESCE(SUM(quantity_delta),0) AS quantity FROM inventory_movements
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND stock_unit_code='ml' AND location_type='AVAILABLE'`,
    [businessId,branchId,whiskyId],
  );
  return Number(result.rows[0]?.quantity ?? 0);
}
