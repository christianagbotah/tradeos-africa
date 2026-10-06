import { planConsumption, UnitConverter } from "@tradeos/domain";
import type { DbClient, DbPool } from "../db.js";
import { withTransaction } from "../db.js";
import { AppError, assertApp } from "../errors.js";

export type PaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT" | "OTHER";

export interface CreateSaleLineInput {
  itemId: string;
  quantity: number;
  saleUnitCode: string;
}

export interface CreateSalePaymentInput {
  clientMutationId: string;
  method: PaymentMethod;
  amountMinor: number;
  providerReference?: string;
}

export interface CreateSaleInput {
  businessId: string;
  branchId: string;
  clientMutationId: string;
  currencyCode: string;
  customerId?: string;
  cashierStaffId?: string;
  occurredAt: string;
  lines: CreateSaleLineInput[];
  payments: CreateSalePaymentInput[];
}

export interface CreateSaleResult {
  saleId: string;
  status: "COMPLETED";
  totalMinor: number;
  idempotentReplay: boolean;
}

type CatalogRow = {
  id: string;
  name: string;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  track_stock: boolean;
  stock_unit_code: string | null;
  default_sale_price_minor: string | number | null;
};

type ConversionRow = {
  from_unit_code: string;
  to_unit_code: string;
  factor: string | number;
};

export async function createSale(pool: DbPool, input: CreateSaleInput): Promise<CreateSaleResult> {
  validateCreateSale(input);

  return withTransaction(pool, async (client) => {
    const existing = await client.query<{
      id: string;
      status: string;
      total_minor: string | number;
    }>(
      `SELECT id, status, total_minor
         FROM sales
        WHERE business_id = $1 AND client_mutation_id = $2`,
      [input.businessId, input.clientMutationId],
    );

    const replay = existing.rows[0];
    if (replay) {
      if (replay.status !== "COMPLETED") {
        throw new AppError("SALE_REPLAY_NOT_COMPLETE", "The original sale mutation exists but is not completed", 409);
      }
      return {
        saleId: replay.id,
        status: "COMPLETED",
        totalMinor: Number(replay.total_minor),
        idempotentReplay: true,
      };
    }

    const branch = await client.query(
      `SELECT id
         FROM branches
        WHERE id = $1 AND business_id = $2 AND is_active = true
        FOR SHARE`,
      [input.branchId, input.businessId],
    );
    assertApp(branch.rowCount === 1, "BRANCH_NOT_FOUND", "Branch was not found for this business", 404);

    const saleInsert = await client.query<{ id: string }>(
      `INSERT INTO sales (
         business_id, branch_id, customer_id, cashier_staff_id, status, currency_code,
         client_mutation_id, opened_at
       ) VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7)
       RETURNING id`,
      [
        input.businessId,
        input.branchId,
        input.customerId ?? null,
        input.cashierStaffId ?? null,
        input.currencyCode,
        input.clientMutationId,
        input.occurredAt,
      ],
    );
    const saleId = saleInsert.rows[0]?.id;
    assertApp(saleId, "SALE_CREATE_FAILED", "Could not create sale", 500);

    let subtotalNetMinor = 0;
    let taxMinor = 0;

    for (let index = 0; index < input.lines.length; index += 1) {
      const line = input.lines[index]!;
      const item = await loadSellableItem(client, input.businessId, line.itemId, line.saleUnitCode);
      const unitNetMinor = Number(item.default_sale_price_minor);
      assertApp(Number.isSafeInteger(unitNetMinor) && unitNetMinor >= 0, "PRICE_NOT_CONFIGURED", `${item.name} has no valid price for ${line.saleUnitCode}`, 409);

      // Tax is intentionally zero until the tax engine is introduced. The snapshot fields
      // are already present so Ghana VAT/e-invoicing rules can be added without rewriting sales.
      const unitTaxMinor = 0;
      const lineNetMinor = Math.round(unitNetMinor * line.quantity);
      const lineTaxMinor = Math.round(unitTaxMinor * line.quantity);
      const lineTotalMinor = lineNetMinor + lineTaxMinor;

      const stockQuantity = await calculateStockQuantity(client, item, line.quantity, line.saleUnitCode);
      const unitCostMinor = 0;

      const saleLineInsert = await client.query<{ id: string }>(
        `INSERT INTO sale_lines (
           sale_id, business_id, item_id, item_name_snapshot, item_kind,
           quantity, sale_unit_code, stock_quantity, stock_unit_code,
           unit_net_minor, unit_tax_minor, unit_cost_minor,
           line_net_minor, line_tax_minor, line_total_minor
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10, $11, $12,
           $13, $14, $15
         )
         RETURNING id`,
        [
          saleId,
          input.businessId,
          item.id,
          item.name,
          item.kind,
          line.quantity,
          line.saleUnitCode,
          stockQuantity,
          item.stock_unit_code,
          unitNetMinor,
          unitTaxMinor,
          unitCostMinor,
          lineNetMinor,
          lineTaxMinor,
          lineTotalMinor,
        ],
      );
      const saleLineId = saleLineInsert.rows[0]?.id;
      assertApp(saleLineId, "SALE_LINE_CREATE_FAILED", "Could not create sale line", 500);

      if (item.kind === "PRODUCT" && item.track_stock) {
        assertApp(item.stock_unit_code && stockQuantity !== null, "STOCK_CONFIGURATION_INVALID", `${item.name} is stock-tracked but has no valid stock unit`, 409);
        await consumeAvailableStock(client, {
          businessId: input.businessId,
          branchId: input.branchId,
          itemId: item.id,
          stockUnitCode: item.stock_unit_code,
          quantity: stockQuantity,
          reason: "SALE",
          referenceType: "SALE_LINE",
          referenceId: saleLineId,
          actorStaffId: input.cashierStaffId,
          idempotencyKey: `${input.clientMutationId}:sale:${index}`,
          occurredAt: input.occurredAt,
          itemName: item.name,
        });
      }

      if (item.kind === "SERVICE" || item.kind === "PREPARED_PRODUCT") {
        await consumeDefinitionComponents(client, {
          businessId: input.businessId,
          branchId: input.branchId,
          item,
          saleQuantity: line.quantity,
          saleUnitCode: line.saleUnitCode,
          saleLineId,
          actorStaffId: input.cashierStaffId,
          idempotencyPrefix: `${input.clientMutationId}:consume:${index}`,
          occurredAt: input.occurredAt,
        });
      }

      subtotalNetMinor += lineNetMinor;
      taxMinor += lineTaxMinor;
    }

    const totalMinor = subtotalNetMinor + taxMinor;
    const paymentTotal = input.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
    assertApp(paymentTotal === totalMinor, "PAYMENT_TOTAL_MISMATCH", `Payments total ${paymentTotal} but sale total is ${totalMinor}`, 409);

    for (const payment of input.payments) {
      await client.query(
        `INSERT INTO payments (
           business_id, branch_id, sale_id, amount_minor, currency_code,
           method, provider_reference, status, client_mutation_id, received_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'SUCCEEDED', $8, $9)`,
        [
          input.businessId,
          input.branchId,
          saleId,
          payment.amountMinor,
          input.currencyCode,
          payment.method,
          payment.providerReference ?? null,
          payment.clientMutationId,
          input.occurredAt,
        ],
      );
    }

    await client.query(
      `UPDATE sales
          SET subtotal_net_minor = $2,
              tax_minor = $3,
              total_minor = $4,
              status = 'COMPLETED',
              completed_at = $5
        WHERE id = $1`,
      [saleId, subtotalNetMinor, taxMinor, totalMinor, input.occurredAt],
    );

    await client.query(
      `INSERT INTO audit_events (
         business_id, branch_id, actor_staff_id, event_type, entity_type, entity_id, correlation_id, payload, occurred_at
       ) VALUES ($1, $2, $3, 'SALE_COMPLETED', 'SALE', $4, $5, $6::jsonb, $7)`,
      [
        input.businessId,
        input.branchId,
        input.cashierStaffId ?? null,
        saleId,
        input.clientMutationId,
        JSON.stringify({ totalMinor, lineCount: input.lines.length, paymentCount: input.payments.length }),
        input.occurredAt,
      ],
    );

    await client.query(
      `INSERT INTO outbox_events (
         business_id, branch_id, aggregate_type, aggregate_id, event_type, payload, occurred_at
       ) VALUES ($1, $2, 'SALE', $3, 'SALE_COMPLETED', $4::jsonb, $5)`,
      [input.businessId, input.branchId, saleId, JSON.stringify({ saleId, totalMinor }), input.occurredAt],
    );

    return { saleId, status: "COMPLETED", totalMinor, idempotentReplay: false };
  });
}

function validateCreateSale(input: CreateSaleInput): void {
  assertApp(input.businessId.trim(), "BUSINESS_REQUIRED", "Business id is required");
  assertApp(input.branchId.trim(), "BRANCH_REQUIRED", "Branch id is required");
  assertApp(input.clientMutationId.trim(), "IDEMPOTENCY_REQUIRED", "Client mutation id is required");
  assertApp(/^[A-Z]{3}$/.test(input.currencyCode), "CURRENCY_INVALID", "Currency must be a three-letter ISO code");
  assertApp(!Number.isNaN(Date.parse(input.occurredAt)), "OCCURRED_AT_INVALID", "occurredAt must be an ISO date-time");
  assertApp(input.lines.length > 0, "SALE_LINES_REQUIRED", "At least one sale line is required");
  assertApp(input.payments.length > 0, "PAYMENT_REQUIRED", "At least one payment is required");

  for (const line of input.lines) {
    assertApp(line.itemId.trim(), "ITEM_REQUIRED", "Sale line item id is required");
    assertApp(line.saleUnitCode.trim(), "SALE_UNIT_REQUIRED", "Sale unit is required");
    assertApp(Number.isFinite(line.quantity) && line.quantity > 0, "QUANTITY_INVALID", "Sale quantity must be positive");
  }

  for (const payment of input.payments) {
    assertApp(payment.clientMutationId.trim(), "PAYMENT_IDEMPOTENCY_REQUIRED", "Payment mutation id is required");
    assertApp(Number.isSafeInteger(payment.amountMinor) && payment.amountMinor > 0, "PAYMENT_AMOUNT_INVALID", "Payment amount must be a positive integer in minor currency units");
  }
}

async function loadSellableItem(client: DbClient, businessId: string, itemId: string, saleUnitCode: string): Promise<CatalogRow> {
  const result = await client.query<CatalogRow>(
    `SELECT ci.id, ci.name, ci.kind, ci.track_stock, ci.stock_unit_code, u.default_sale_price_minor
       FROM catalog_items ci
       JOIN catalog_item_units u
         ON u.item_id = ci.id AND u.business_id = ci.business_id
      WHERE ci.id = $1
        AND ci.business_id = $2
        AND ci.is_active = true
        AND u.unit_code = $3
        AND u.can_sell = true
      FOR UPDATE OF ci`,
    [itemId, businessId, saleUnitCode],
  );
  const item = result.rows[0];
  if (!item) throw new AppError("ITEM_NOT_SELLABLE", "Item/unit is not available for sale", 404);
  return item;
}

async function calculateStockQuantity(
  client: DbClient,
  item: CatalogRow,
  saleQuantity: number,
  saleUnitCode: string,
): Promise<number | null> {
  if (!item.track_stock || !item.stock_unit_code) return null;
  if (saleUnitCode === item.stock_unit_code) return saleQuantity;

  const conversions = await client.query<ConversionRow>(
    `SELECT from_unit_code, to_unit_code, factor
       FROM item_unit_conversions
      WHERE item_id = $1`,
    [item.id],
  );
  const converter = new UnitConverter(
    conversions.rows.map((row) => ({
      from: row.from_unit_code,
      to: row.to_unit_code,
      factor: Number(row.factor),
    })),
  );

  try {
    return converter.convert(saleQuantity, saleUnitCode, item.stock_unit_code);
  } catch {
    throw new AppError(
      "UNIT_CONVERSION_MISSING",
      `No unit conversion is configured from ${saleUnitCode} to ${item.stock_unit_code} for ${item.name}`,
      409,
    );
  }
}

async function currentAvailableStock(
  client: DbClient,
  businessId: string,
  branchId: string,
  itemId: string,
  stockUnitCode: string,
): Promise<number> {
  const result = await client.query<{ quantity: string | number }>(
    `SELECT COALESCE(SUM(quantity_delta), 0) AS quantity
       FROM inventory_movements
      WHERE business_id = $1
        AND branch_id = $2
        AND item_id = $3
        AND stock_unit_code = $4
        AND location_type = 'AVAILABLE'`,
    [businessId, branchId, itemId, stockUnitCode],
  );
  return Number(result.rows[0]?.quantity ?? 0);
}

interface ConsumeStockInput {
  businessId: string;
  branchId: string;
  itemId: string;
  stockUnitCode: string;
  quantity: number;
  reason: "SALE" | "SERVICE_CONSUMPTION" | "RECIPE_CONSUMPTION";
  referenceType: string;
  referenceId: string;
  actorStaffId?: string;
  idempotencyKey: string;
  occurredAt: string;
  itemName: string;
}

async function consumeAvailableStock(client: DbClient, input: ConsumeStockInput): Promise<void> {
  const available = await currentAvailableStock(
    client,
    input.businessId,
    input.branchId,
    input.itemId,
    input.stockUnitCode,
  );
  if (available + Number.EPSILON < input.quantity) {
    throw new AppError(
      "INSUFFICIENT_STOCK",
      `${input.itemName} has ${available} ${input.stockUnitCode} available; ${input.quantity} is required`,
      409,
      { available, required: input.quantity, unit: input.stockUnitCode },
    );
  }

  await client.query(
    `INSERT INTO inventory_movements (
       business_id, branch_id, item_id, stock_unit_code, quantity_delta,
       location_type, reason, reference_type, reference_id, actor_staff_id,
       idempotency_key, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, 'AVAILABLE', $6, $7, $8, $9, $10, $11)`,
    [
      input.businessId,
      input.branchId,
      input.itemId,
      input.stockUnitCode,
      -input.quantity,
      input.reason,
      input.referenceType,
      input.referenceId,
      input.actorStaffId ?? null,
      input.idempotencyKey,
      input.occurredAt,
    ],
  );
}

interface ConsumeDefinitionInput {
  businessId: string;
  branchId: string;
  item: CatalogRow;
  saleQuantity: number;
  saleUnitCode: string;
  saleLineId: string;
  actorStaffId?: string;
  idempotencyPrefix: string;
  occurredAt: string;
}

async function consumeDefinitionComponents(client: DbClient, input: ConsumeDefinitionInput): Promise<void> {
  const definitionResult = await client.query<{
    id: string;
    output_quantity: string | number;
    output_unit_code: string;
  }>(
    `SELECT id, output_quantity, output_unit_code
       FROM consumption_definitions
      WHERE business_id = $1 AND output_item_id = $2
      ORDER BY updated_at DESC, id
      LIMIT 1`,
    [input.businessId, input.item.id],
  );
  const definition = definitionResult.rows[0];
  if (!definition) return;

  let outputQuantity = input.saleQuantity;
  if (input.saleUnitCode !== definition.output_unit_code) {
    const conversions = await client.query<ConversionRow>(
      `SELECT from_unit_code, to_unit_code, factor
         FROM item_unit_conversions
        WHERE item_id = $1`,
      [input.item.id],
    );
    const converter = new UnitConverter(
      conversions.rows.map((row) => ({ from: row.from_unit_code, to: row.to_unit_code, factor: Number(row.factor) })),
    );
    try {
      outputQuantity = converter.convert(input.saleQuantity, input.saleUnitCode, definition.output_unit_code);
    } catch {
      throw new AppError(
        "CONSUMPTION_UNIT_CONVERSION_MISSING",
        `Cannot convert ${input.saleUnitCode} to recipe/service unit ${definition.output_unit_code} for ${input.item.name}`,
        409,
      );
    }
  }

  const components = await client.query<{
    component_item_id: string;
    stock_unit_code: string;
    quantity_per_output: string | number;
    expected_waste_percent: string | number;
    component_name: string;
  }>(
    `SELECT cc.component_item_id,
            cc.stock_unit_code,
            cc.quantity_per_output,
            cc.expected_waste_percent,
            ci.name AS component_name
       FROM consumption_components cc
       JOIN catalog_items ci ON ci.id = cc.component_item_id
      WHERE cc.definition_id = $1
      ORDER BY cc.id`,
    [definition.id],
  );

  const plan = planConsumption(
    {
      id: definition.id,
      outputId: input.item.id,
      outputKind: input.item.kind,
      outputUnitId: definition.output_unit_code,
      outputQuantity: Number(definition.output_quantity),
      components: components.rows.map((component) => ({
        componentProductId: component.component_item_id,
        stockUnitId: component.stock_unit_code,
        quantityPerOutput: Number(component.quantity_per_output),
        expectedWastePercent: Number(component.expected_waste_percent),
      })),
    },
    outputQuantity,
  );

  for (let index = 0; index < plan.length; index += 1) {
    const component = plan[index]!;
    const componentRow = components.rows[index]!;

    // Lock component item so two concurrent service/recipe sales cannot both
    // validate against the same stock balance and oversell it.
    await client.query(`SELECT id FROM catalog_items WHERE id = $1 FOR UPDATE`, [component.componentProductId]);

    await consumeAvailableStock(client, {
      businessId: input.businessId,
      branchId: input.branchId,
      itemId: component.componentProductId,
      stockUnitCode: component.stockUnitId,
      quantity: component.totalPlannedQuantity,
      reason: input.item.kind === "SERVICE" ? "SERVICE_CONSUMPTION" : "RECIPE_CONSUMPTION",
      referenceType: "SALE_LINE",
      referenceId: input.saleLineId,
      actorStaffId: input.actorStaffId,
      idempotencyKey: `${input.idempotencyPrefix}:${index}`,
      occurredAt: input.occurredAt,
      itemName: componentRow.component_name,
    });
  }
}
