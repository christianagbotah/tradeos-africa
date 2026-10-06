import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createReturn } from "../src/commerce/returns.js";
import { createSale } from "../src/commerce/sales.js";
import { createPool } from "../src/db.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://tradeos:tradeos@localhost:5432/tradeos_ci";
const pool = createPool(databaseUrl);

const businessId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const whiskyId = "33333333-3333-4333-8333-333333333333";
const waakyeId = "44444444-4444-4444-8444-444444444444";
const riceId = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE businesses CASCADE");
  await pool.query(
    `INSERT INTO businesses (id, name, business_type) VALUES ($1, 'TradeOS Test Shop', 'BAR_AND_FOOD')`,
    [businessId],
  );
  await pool.query(
    `INSERT INTO branches (id, business_id, name, code) VALUES ($1, $2, 'Main', 'MAIN')`,
    [branchId, businessId],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("commerce transactions", () => {
  it("sells a bulk-stocked product in smaller units and makes retries idempotent", async () => {
    await seedWhisky();

    const occurredAt = new Date().toISOString();
    const input = {
      businessId,
      branchId,
      clientMutationId: "sale-whisky-001",
      currencyCode: "GHS",
      occurredAt,
      lines: [{ itemId: whiskyId, quantity: 2, saleUnitCode: "glass" }],
      payments: [{ clientMutationId: "payment-whisky-001", method: "CASH" as const, amountMinor: 3600 }],
    };

    const first = await createSale(pool, input);
    const replay = await createSale(pool, input);

    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.saleId).toBe(first.saleId);

    const stock = await availableStock(whiskyId, "ml");
    expect(stock).toBe(650);

    const movementCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM inventory_movements WHERE reason = 'SALE'`,
    );
    expect(Number(movementCount.rows[0]?.count)).toBe(1);
  });

  it("restocks the converted stock quantity and partially reverses an immediate original payment", async () => {
    await seedWhisky();
    const occurredAt = new Date().toISOString();
    const sale = await createSale(pool, {
      businessId,
      branchId,
      clientMutationId: "sale-return-base-001",
      currencyCode: "GHS",
      occurredAt,
      lines: [{ itemId: whiskyId, quantity: 2, saleUnitCode: "glass" }],
      payments: [{ clientMutationId: "payment-return-base-001", method: "CASH", amountMinor: 3600 }],
    });
    const line = await pool.query<{ id: string }>(`SELECT id FROM sale_lines WHERE sale_id = $1`, [sale.saleId]);
    const saleLineId = line.rows[0]!.id;

    const input = {
      businessId,
      branchId,
      originalSaleId: sale.saleId,
      clientMutationId: "return-whisky-001",
      reason: "Wrong drink served",
      refundMethod: "ORIGINAL_METHOD" as const,
      occurredAt: new Date().toISOString(),
      lines: [{ saleLineId, quantity: 1, disposition: "RESTOCK" as const }],
    };

    const first = await createReturn(pool, input);
    const replay = await createReturn(pool, input);

    expect(first.status).toBe("COMPLETED");
    expect(first.refundTotalMinor).toBe(1800);
    expect(first.pendingRefundMinor).toBe(0);
    expect(replay.idempotentReplay).toBe(true);
    expect(await availableStock(whiskyId, "ml")).toBe(700);

    const payment = await pool.query<{ status: string }>(`SELECT status FROM payments WHERE sale_id = $1`, [sale.saleId]);
    expect(payment.rows[0]?.status).toBe("PARTIALLY_REVERSED");
  });

  it("scales batch recipes when a prepared item is sold", async () => {
    await pool.query(
      `INSERT INTO catalog_items (id, business_id, sku, name, kind, track_stock)
       VALUES ($1, $2, 'WAA-MED', 'Medium Waakye', 'PREPARED_PRODUCT', false)`,
      [waakyeId, businessId],
    );
    await pool.query(
      `INSERT INTO catalog_item_units (business_id, item_id, unit_code, unit_label, can_sell, default_sale_price_minor)
       VALUES ($1, $2, 'plate', 'Plate', true, 3000)`,
      [businessId, waakyeId],
    );
    await pool.query(
      `INSERT INTO catalog_items (id, business_id, sku, name, kind, stock_unit_code, track_stock)
       VALUES ($1, $2, 'RICE', 'Rice', 'PRODUCT', 'kg', true)`,
      [riceId, businessId],
    );
    await pool.query(
      `INSERT INTO catalog_item_units (business_id, item_id, unit_code, unit_label, can_purchase, can_stock)
       VALUES ($1, $2, 'kg', 'Kilogram', true, true)`,
      [businessId, riceId],
    );
    await addOpeningStock(riceId, "kg", 30);

    const definition = await pool.query<{ id: string }>(
      `INSERT INTO consumption_definitions (business_id, output_item_id, output_quantity, output_unit_code)
       VALUES ($1, $2, 100, 'plate') RETURNING id`,
      [businessId, waakyeId],
    );
    await pool.query(
      `INSERT INTO consumption_components (
         definition_id, component_item_id, stock_unit_code, quantity_per_output, expected_waste_percent
       ) VALUES ($1, $2, 'kg', 25, 0)`,
      [definition.rows[0]!.id, riceId],
    );

    await createSale(pool, {
      businessId,
      branchId,
      clientMutationId: "sale-waakye-001",
      currencyCode: "GHS",
      occurredAt: new Date().toISOString(),
      lines: [{ itemId: waakyeId, quantity: 10, saleUnitCode: "plate" }],
      payments: [{ clientMutationId: "payment-waakye-001", method: "CASH", amountMinor: 30000 }],
    });

    expect(await availableStock(riceId, "kg")).toBe(27.5);
    const consumption = await pool.query<{ quantity_delta: string }>(
      `SELECT quantity_delta::text FROM inventory_movements WHERE reason = 'RECIPE_CONSUMPTION'`,
    );
    expect(Number(consumption.rows[0]?.quantity_delta)).toBe(-2.5);
  });

  it("keeps an external original-method refund pending until the provider settles it", async () => {
    await seedWhisky();
    const sale = await createSale(pool, {
      businessId,
      branchId,
      clientMutationId: "sale-momo-001",
      currencyCode: "GHS",
      occurredAt: new Date().toISOString(),
      lines: [{ itemId: whiskyId, quantity: 1, saleUnitCode: "glass" }],
      payments: [{ clientMutationId: "payment-momo-001", method: "MOMO", amountMinor: 1800 }],
    });
    const line = await pool.query<{ id: string }>(`SELECT id FROM sale_lines WHERE sale_id = $1`, [sale.saleId]);

    const result = await createReturn(pool, {
      businessId,
      branchId,
      originalSaleId: sale.saleId,
      clientMutationId: "return-momo-001",
      reason: "Customer requested refund",
      refundMethod: "ORIGINAL_METHOD",
      occurredAt: new Date().toISOString(),
      lines: [{ saleLineId: line.rows[0]!.id, quantity: 1, disposition: "RESTOCK" }],
    });

    expect(result.status).toBe("PROCESSING");
    expect(result.pendingRefundMinor).toBe(1800);
    const refund = await pool.query<{ status: string; method: string }>(
      `SELECT status, method FROM refund_transactions WHERE return_case_id = $1`,
      [result.returnCaseId],
    );
    expect(refund.rows[0]).toMatchObject({ status: "PENDING", method: "MOMO" });
  });
});

async function seedWhisky(): Promise<void> {
  await pool.query(
    `INSERT INTO catalog_items (id, business_id, sku, name, kind, stock_unit_code, track_stock)
     VALUES ($1, $2, 'WHISKY-750', 'Whisky 750 ml', 'PRODUCT', 'ml', true)`,
    [whiskyId, businessId],
  );
  await pool.query(
    `INSERT INTO catalog_item_units (
       business_id, item_id, unit_code, unit_label, can_purchase, can_sell, can_stock, default_sale_price_minor
     ) VALUES
       ($1, $2, 'ml', 'Millilitre', false, false, true, NULL),
       ($1, $2, 'bottle', 'Bottle', true, true, false, 27000),
       ($1, $2, 'glass', 'Glass', false, true, false, 1800)`,
    [businessId, whiskyId],
  );
  await pool.query(
    `INSERT INTO item_unit_conversions (business_id, item_id, from_unit_code, to_unit_code, factor)
     VALUES
       ($1, $2, 'bottle', 'ml', 750),
       ($1, $2, 'glass', 'ml', 50)`,
    [businessId, whiskyId],
  );
  await addOpeningStock(whiskyId, "ml", 750);
}

async function addOpeningStock(itemId: string, unit: string, quantity: number): Promise<void> {
  await pool.query(
    `INSERT INTO inventory_movements (
       business_id, branch_id, item_id, stock_unit_code, quantity_delta,
       location_type, reason, reference_type, reference_id, idempotency_key, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, 'AVAILABLE', 'OPENING_BALANCE', 'TEST', $6, $7, now())`,
    [businessId, branchId, itemId, unit, quantity, randomUUID(), randomUUID()],
  );
}

async function availableStock(itemId: string, unit: string): Promise<number> {
  const result = await pool.query<{ quantity: string | number }>(
    `SELECT COALESCE(SUM(quantity_delta), 0) AS quantity
       FROM inventory_movements
      WHERE business_id = $1
        AND branch_id = $2
        AND item_id = $3
        AND stock_unit_code = $4
        AND location_type = 'AVAILABLE'`,
    [businessId, branchId, itemId, unit],
  );
  return Number(result.rows[0]?.quantity ?? 0);
}
