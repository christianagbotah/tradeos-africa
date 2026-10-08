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
