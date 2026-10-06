import { recordCashbookEntry, isCashMethod } from "./cashbook.js";
import { consumeValuation, safeMinor, proportionalMinor } from "./valuation.js";
import { planConsumption, UnitConverter } from "@tradeos/domain";
import type { DatabaseClient, DatabasePool } from "../db.js";
import {
  assertCustomerCreditAvailable,
  loadCustomerAccount,
  recordCustomerAccountEntry,
} from "./customer-credit.js";
import { withTransaction } from "../db.js";
import { createCustomerCreditObligation } from "./credit-obligations.js";

export type PaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT" | "OTHER";

export interface SaleMutationPayload {
  currencyCode?: string;
  customerId?: string;
  cashierStaffId?: string;
  lines: Array<{ itemId: string; quantity: number; saleUnitCode?: string; saleUnit?: string }>;
  payments?: Array<{ method: PaymentMethod; amountMinor: number; moneyAccountId?: string; providerReference?: string }>;
  paymentMethod?: PaymentMethod;
}

export interface SaleMutationContext {
  businessId: string;
  branchId: string;
  clientMutationId: string;
  occurredAt: string;
}

export interface SaleMutationResult {
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

type ConversionRow = { from_unit_code: string; to_unit_code: string; factor: string | number };

export class SaleMutationError extends Error {
  constructor(message: string, readonly code = "SALE_INVALID") {
    super(message);
  }
}

export async function applySaleMutation(
  pool: DatabasePool,
  context: SaleMutationContext,
  payload: SaleMutationPayload,
): Promise<SaleMutationResult> {
  validateSale(context, payload);

  return withTransaction(pool, async (client) => {
    const prior = await client.query<{ id: string; status: string; total_minor: string | number }>(
      `SELECT id, status, total_minor FROM sales
       WHERE business_id = $1 AND client_mutation_id = $2`,
      [context.businessId, context.clientMutationId],
    );
    const replay = prior.rows[0];
    if (replay) {
      if (replay.status !== "COMPLETED") throw new SaleMutationError("Existing sale mutation is not complete", "SALE_REPLAY_INCOMPLETE");
      return { saleId: replay.id, status: "COMPLETED", totalMinor: Number(replay.total_minor), idempotentReplay: true };
    }

    const branch = await client.query<{ currency_code: string }>(
      `SELECT b.currency_code FROM branches br
       JOIN businesses b ON b.id=br.business_id
       WHERE br.id=$1 AND br.business_id=$2 AND br.is_active=true FOR SHARE OF br,b`,
      [context.branchId, context.businessId],
    );
    const businessCurrency = branch.rows[0]?.currency_code;
    if (!businessCurrency) throw new SaleMutationError("Branch was not found for this business", "BRANCH_NOT_FOUND");

    const currencyCode = (payload.currencyCode ?? businessCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyCode)) throw new SaleMutationError("Currency must be a three-letter code");
    if (currencyCode !== businessCurrency) {
      throw new SaleMutationError("Sale currency must match the business currency", "SALE_CURRENCY_MISMATCH");
    }
    const customerCreditRequested = payload.paymentMethod === "CUSTOMER_CREDIT"
      || Boolean(payload.payments?.some((payment) => payment.method === "CUSTOMER_CREDIT"));
    if (customerCreditRequested && !payload.customerId) {
      throw new SaleMutationError("Pay later requires a customer", "CUSTOMER_REQUIRED_FOR_CREDIT");
    }
    if (payload.customerId) {
      // Customer-credit mutations use one global lock order: customer first, then catalog/inventory.
      // Refunds already lock the customer before restoring stock, so this prevents the inverse
      // catalog -> customer order from deadlocking with a concurrent refund.
      const customer = await loadCustomerAccount(
        client, context.businessId, payload.customerId, customerCreditRequested,
      );
      if (!customer.is_active) throw new SaleMutationError("Customer account is inactive", "CUSTOMER_INACTIVE");
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sales (
         business_id, branch_id, customer_id, cashier_staff_id, status, currency_code,
         client_mutation_id, opened_at
       ) VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7) RETURNING id`,
      [
        context.businessId,
        context.branchId,
        payload.customerId ?? null,
        payload.cashierStaffId ?? null,
        currencyCode,
        context.clientMutationId,
        context.occurredAt,
      ],
    );
    const saleId = inserted.rows[0]?.id;
    if (!saleId) throw new SaleMutationError("Could not create sale", "SALE_CREATE_FAILED");

    await lockSaleCatalogItems(client, context.businessId, payload.lines.map((line) => line.itemId));

    let subtotalMinor = 0;
    let taxMinor = 0;

    for (let index = 0; index < payload.lines.length; index += 1) {
      const requested = payload.lines[index]!;
      const saleUnitCode = requested.saleUnitCode ?? requested.saleUnit;
      if (!saleUnitCode) throw new SaleMutationError("Each sale line needs a sale unit");

      const item = await loadItem(client, context.businessId, requested.itemId, saleUnitCode);
      const unitNetMinor = Number(item.default_sale_price_minor);
      if (!Number.isSafeInteger(unitNetMinor) || unitNetMinor < 0) {
        throw new SaleMutationError(`${item.name} has no valid price for ${saleUnitCode}`, "PRICE_NOT_CONFIGURED");
      }

      // Tax remains separate; physical products snapshot the branch moving-average cost.
      const unitTaxMinor = 0;

      const lineNetMinor = proportionalMinor(unitNetMinor, requested.quantity, 1);
      const lineTaxMinor = proportionalMinor(unitTaxMinor, requested.quantity, 1);
      const lineTotalMinor = safeMinor(lineNetMinor + lineTaxMinor);
      const stockQuantity = await stockQuantityForSale(client, item, requested.quantity, saleUnitCode);

      let lineCostMinor = item.kind === "PRODUCT" && item.track_stock && stockQuantity !== null
        ? await consumeValuation(client, context, item.id, stockQuantity) : 0;
      let unitCostMinor = proportionalMinor(lineCostMinor, 1, requested.quantity);
      const lineInsert = await client.query<{ id: string }>(
        `INSERT INTO sale_lines (
           sale_id, business_id, item_id, item_name_snapshot, item_kind, quantity,
           sale_unit_code, stock_quantity, stock_unit_code, unit_net_minor,
           unit_tax_minor, unit_cost_minor, line_net_minor, line_tax_minor, line_total_minor, line_cost_minor
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          saleId, context.businessId, item.id, item.name, item.kind, requested.quantity,
          saleUnitCode, stockQuantity, item.stock_unit_code, unitNetMinor,
          unitTaxMinor, unitCostMinor, lineNetMinor, lineTaxMinor, lineTotalMinor, lineCostMinor,
        ],
      );
      const saleLineId = lineInsert.rows[0]?.id;
      if (!saleLineId) throw new SaleMutationError("Could not create sale line", "SALE_LINE_CREATE_FAILED");

      if (item.kind === "PRODUCT" && item.track_stock) {
        if (!item.stock_unit_code || stockQuantity === null) throw new SaleMutationError(`${item.name} has invalid stock configuration`);
        await consumeStock(client, {
          businessId: context.businessId,
          branchId: context.branchId,
          itemId: item.id,
          itemName: item.name,
          unit: item.stock_unit_code,
          quantity: stockQuantity,
          reason: "SALE",
          referenceId: saleLineId,
          actorStaffId: payload.cashierStaffId ?? null,
          idempotencyKey: `${context.clientMutationId}:sale:${index}`,
          occurredAt: context.occurredAt,
        });
      }

      if (item.kind === "SERVICE" || item.kind === "PREPARED_PRODUCT") {
        lineCostMinor = await consumeDefinition(
          client, context, payload.cashierStaffId ?? null, item, requested.quantity, saleUnitCode, saleLineId, index,
        );
        unitCostMinor = proportionalMinor(lineCostMinor, 1, requested.quantity);
        await client.query(
          `UPDATE sale_lines SET unit_cost_minor=$2,line_cost_minor=$3 WHERE id=$1 AND business_id=$4`,
          [saleLineId, unitCostMinor, lineCostMinor, context.businessId],
        );
      }

      subtotalMinor = safeMinor(subtotalMinor + lineNetMinor);
      taxMinor = safeMinor(taxMinor + lineTaxMinor);
    }

    const totalMinor = safeMinor(subtotalMinor + taxMinor);
    const payments = normalizePayments(payload, totalMinor);
    if (payments.reduce((sum, payment) => sum + payment.amountMinor, 0) !== totalMinor) {
      throw new SaleMutationError("Payment total does not equal the server-calculated sale total", "PAYMENT_TOTAL_MISMATCH");
    }
    const creditMinor = payments
      .filter((payment) => payment.method === "CUSTOMER_CREDIT")
      .reduce((sum, payment) => sum + payment.amountMinor, 0);
    let creditTermsDays = 0;
    if (creditMinor > 0) {
      if (!payload.customerId) throw new SaleMutationError("Pay later requires a customer", "CUSTOMER_REQUIRED_FOR_CREDIT");
      const credit = await assertCustomerCreditAvailable(client, context.businessId, payload.customerId, currencyCode, creditMinor);
      creditTermsDays = credit.creditTermsDays;
    }

    for (let index = 0; index < payments.length; index += 1) {
      const payment = payments[index]!;
      const insertedPayment = await client.query<{id:string}>(
        `INSERT INTO payments (
           business_id, branch_id, sale_id, amount_minor, currency_code, method,
           provider_reference, status, client_mutation_id, received_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'SUCCEEDED',$8,$9) RETURNING id`,
        [
          context.businessId, context.branchId, saleId, payment.amountMinor, currencyCode,
          payment.method, payment.providerReference ?? null,
          `${context.clientMutationId}:payment:${index}`, context.occurredAt,
        ],
      );
      if(payment.method==='CUSTOMER_CREDIT' && payment.moneyAccountId !== undefined) throw new SaleMutationError('Credit payments cannot have money accounts');
      if(payment.amountMinor>0 && isCashMethod(payment.method)) await recordCashbookEntry(client,{...context,moneyAccountId:payment.moneyAccountId,currencyCode,method:payment.method,amountDeltaMinor:payment.amountMinor,entryType:"SALE_RECEIPT",sourceType:"PAYMENT",sourceId:insertedPayment.rows[0]!.id,actorStaffId:payload.cashierStaffId,idempotencyKey:`sale-payment:${insertedPayment.rows[0]!.id}`});
    }

    // Receipts remain gross even when their payments are later reversed by a refund.
    await client.query(
      `UPDATE sales SET subtotal_net_minor=$2, tax_minor=$3, total_minor=$4,
       status='COMPLETED', completed_at=$5 WHERE id=$1`,
      [saleId, subtotalMinor, taxMinor, totalMinor, context.occurredAt],
    );
    if (creditMinor > 0 && payload.customerId) {
      await recordCustomerAccountEntry(client, {
        businessId: context.businessId,
        branchId: context.branchId,
        customerId: payload.customerId,
        currencyCode,
        entryType: "CREDIT_SALE",
        balanceDeltaMinor: creditMinor,
        sourceType: "SALE",
        sourceId: saleId,
        actorStaffId: payload.cashierStaffId ?? null,
        idempotencyKey: `${context.clientMutationId}:credit-ledger`,
        occurredAt: context.occurredAt,
      });
      await createCustomerCreditObligation(client,{businessId:context.businessId,branchId:context.branchId,customerId:payload.customerId,saleId,currencyCode,amountMinor:creditMinor,termsDays:creditTermsDays,occurredAt:context.occurredAt});
    }
    await writeEvent(client, context, payload.cashierStaffId ?? null, saleId, totalMinor);

    return { saleId, status: "COMPLETED", totalMinor, idempotentReplay: false };
  });
}

function validateSale(context: SaleMutationContext, payload: SaleMutationPayload): void {
  if (!context.branchId) throw new SaleMutationError("branchId is required");
  if (!context.clientMutationId) throw new SaleMutationError("clientMutationId is required");
  if (Number.isNaN(Date.parse(context.occurredAt))) throw new SaleMutationError("occurredAt must be an ISO date-time");
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) throw new SaleMutationError("At least one sale line is required");
  for (const line of payload.lines) {
    if (!line.itemId || !Number.isFinite(line.quantity) || line.quantity <= 0) throw new SaleMutationError("Sale lines need an item and positive quantity");
  }
}

function normalizePayments(payload: SaleMutationPayload, totalMinor: number): Array<{ method: PaymentMethod; amountMinor: number; moneyAccountId?: string; providerReference?: string }> {
  if (payload.payments?.length) {
    for (const payment of payload.payments) {
      if (!Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0) throw new SaleMutationError("Payment amounts must be positive minor-unit integers");
    }
    return payload.payments;
  }
  if (!payload.paymentMethod) throw new SaleMutationError("A payment method is required", "PAYMENT_REQUIRED");
  return [{ method: payload.paymentMethod, amountMinor: totalMinor }];
}

async function lockSaleCatalogItems(client: DatabaseClient, businessId: string, itemIds: string[]): Promise<void> {
  const directIds = [...new Set(itemIds)].sort();
  if (directIds.length === 0) return;

  // A service/prepared-product sale may consume hidden ingredient products. Include the
  // components from each output item's current definition before taking any catalog locks,
  // then lock the full affected set in one deterministic UUID order. This matches the
  // purchase/return lock order and prevents sale-vs-return deadlocks.
  const components = await client.query<{ component_item_id: string }>(
    `SELECT DISTINCT cc.component_item_id
     FROM unnest($2::uuid[]) AS requested(output_item_id)
     JOIN LATERAL (
       SELECT cd.id
       FROM consumption_definitions cd
       WHERE cd.business_id=$1 AND cd.output_item_id=requested.output_item_id
       ORDER BY cd.updated_at DESC,cd.id
       LIMIT 1
     ) latest ON true
     JOIN consumption_components cc ON cc.definition_id=latest.id`,
    [businessId, directIds],
  );
  const affectedIds = [...new Set([
    ...directIds,
    ...components.rows.map((row) => row.component_item_id),
  ])].sort();
  await client.query(
    `SELECT id FROM catalog_items WHERE business_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [businessId, affectedIds],
  );
}

async function loadItem(client: DatabaseClient, businessId: string, itemId: string, unit: string): Promise<CatalogRow> {
  const result = await client.query<CatalogRow>(
    `SELECT ci.id, ci.name, ci.kind, ci.track_stock, ci.stock_unit_code, u.default_sale_price_minor
     FROM catalog_items ci JOIN catalog_item_units u ON u.item_id=ci.id AND u.business_id=ci.business_id
     WHERE ci.id=$1 AND ci.business_id=$2 AND ci.is_active=true AND u.unit_code=$3 AND u.can_sell=true
     FOR UPDATE OF ci`,
    [itemId, businessId, unit],
  );
  const item = result.rows[0];
  if (!item) throw new SaleMutationError("Item/unit is not available for sale", "ITEM_NOT_SELLABLE");
  return item;
}

async function conversionRows(client: DatabaseClient, itemId: string): Promise<ConversionRow[]> {
  const result = await client.query<ConversionRow>(
    `SELECT from_unit_code,to_unit_code,factor FROM item_unit_conversions WHERE item_id=$1`, [itemId],
  );
  return result.rows;
}

async function stockQuantityForSale(client: DatabaseClient, item: CatalogRow, quantity: number, saleUnit: string): Promise<number | null> {
  if (!item.track_stock || !item.stock_unit_code) return null;
  if (saleUnit === item.stock_unit_code) return quantity;
  const rows = await conversionRows(client, item.id);
  const converter = new UnitConverter(rows.map((r) => ({ from: r.from_unit_code, to: r.to_unit_code, factor: Number(r.factor) })));
  try {
    return converter.convert(quantity, saleUnit, item.stock_unit_code);
  } catch {
    throw new SaleMutationError(`No conversion from ${saleUnit} to ${item.stock_unit_code} for ${item.name}`, "UNIT_CONVERSION_MISSING");
  }
}

interface StockUse {
  businessId: string; branchId: string; itemId: string; itemName: string; unit: string; quantity: number;
  reason: "SALE" | "SERVICE_CONSUMPTION" | "RECIPE_CONSUMPTION"; referenceId: string;
  actorStaffId: string | null; idempotencyKey: string; occurredAt: string;
}

async function consumeStock(client: DatabaseClient, input: StockUse): Promise<void> {
  const balance = await client.query<{ quantity: string | number }>(
    `SELECT COALESCE(SUM(quantity_delta),0) AS quantity FROM inventory_movements
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND stock_unit_code=$4 AND location_type='AVAILABLE'`,
    [input.businessId, input.branchId, input.itemId, input.unit],
  );
  const available = Number(balance.rows[0]?.quantity ?? 0);
  if (available + Number.EPSILON < input.quantity) {
    throw new SaleMutationError(`${input.itemName} has ${available} ${input.unit}; ${input.quantity} is required`, "INSUFFICIENT_STOCK");
  }
  await client.query(
    `INSERT INTO inventory_movements (
       business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,reason,
       reference_type,reference_id,actor_staff_id,idempotency_key,occurred_at
     ) VALUES ($1,$2,$3,$4,$5,'AVAILABLE',$6,'SALE_LINE',$7,$8,$9,$10)`,
    [input.businessId,input.branchId,input.itemId,input.unit,-input.quantity,input.reason,input.referenceId,input.actorStaffId,input.idempotencyKey,input.occurredAt],
  );
}

async function consumeDefinition(
  client: DatabaseClient,
  context: SaleMutationContext,
  actorStaffId: string | null,
  item: CatalogRow,
  saleQuantity: number,
  saleUnit: string,
  saleLineId: string,
  lineIndex: number,
): Promise<number> {
  const definitionResult = await client.query<{ id: string; output_quantity: string | number; output_unit_code: string }>(
    `SELECT id,output_quantity,output_unit_code FROM consumption_definitions
     WHERE business_id=$1 AND output_item_id=$2 ORDER BY updated_at DESC,id LIMIT 1`,
    [context.businessId, item.id],
  );
  const definition = definitionResult.rows[0];
  if (!definition) return 0;

  let outputQuantity = saleQuantity;
  if (saleUnit !== definition.output_unit_code) {
    const rows = await conversionRows(client, item.id);
    const converter = new UnitConverter(rows.map((r) => ({ from: r.from_unit_code, to: r.to_unit_code, factor: Number(r.factor) })));
    try { outputQuantity = converter.convert(saleQuantity, saleUnit, definition.output_unit_code); }
    catch { throw new SaleMutationError(`Cannot convert ${saleUnit} to ${definition.output_unit_code} for ${item.name}`, "CONSUMPTION_UNIT_CONVERSION_MISSING"); }
  }

  const components = await client.query<{
    component_item_id: string; stock_unit_code: string; quantity_per_output: string | number;
    expected_waste_percent: string | number; component_name: string;
  }>(
    `SELECT cc.component_item_id,cc.stock_unit_code,cc.quantity_per_output,cc.expected_waste_percent,ci.name AS component_name
     FROM consumption_components cc JOIN catalog_items ci ON ci.id=cc.component_item_id
     WHERE cc.definition_id=$1 ORDER BY cc.component_item_id`, [definition.id],
  );
  if (!components.rowCount) return 0;

  const ids = components.rows.map((row) => row.component_item_id);
  await client.query(`SELECT id FROM catalog_items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [ids]);

  const plan = planConsumption({
    id: definition.id,
    outputId: item.id,
    outputKind: item.kind,
    outputUnitId: definition.output_unit_code,
    outputQuantity: Number(definition.output_quantity),
    components: components.rows.map((row) => ({
      componentProductId: row.component_item_id,
      stockUnitId: row.stock_unit_code,
      quantityPerOutput: Number(row.quantity_per_output),
      expectedWastePercent: Number(row.expected_waste_percent),
    })),
  }, outputQuantity);

  let componentCostMinor = 0;
  for (let index = 0; index < plan.length; index += 1) {
    const component = plan[index]!;
    const row = components.rows[index]!;
    const componentCost = await consumeValuation(
      client, context, component.componentProductId, component.totalPlannedQuantity,
    );
    componentCostMinor = safeMinor(componentCostMinor + componentCost);
    await consumeStock(client, {
      businessId: context.businessId, branchId: context.branchId, itemId: component.componentProductId,
      itemName: row.component_name, unit: component.stockUnitId, quantity: component.totalPlannedQuantity,
      reason: item.kind === "SERVICE" ? "SERVICE_CONSUMPTION" : "RECIPE_CONSUMPTION",
      referenceId: saleLineId, actorStaffId,
      idempotencyKey: `${context.clientMutationId}:consume:${lineIndex}:${index}`,
      occurredAt: context.occurredAt,
    });
  }
  return componentCostMinor;
}

async function writeEvent(client: DatabaseClient, context: SaleMutationContext, actorStaffId: string | null, saleId: string, totalMinor: number): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at)
     VALUES ($1,$2,$3,'SALE_COMPLETED','SALE',$4,$5,$6::jsonb,$7)`,
    [context.businessId,context.branchId,actorStaffId,saleId,context.clientMutationId,JSON.stringify({ totalMinor }),context.occurredAt],
  );
  await client.query(
    `INSERT INTO outbox_events (business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at)
     VALUES ($1,$2,'SALE',$3,'SALE_COMPLETED',$4::jsonb,$5)`,
    [context.businessId,context.branchId,saleId,JSON.stringify({ saleId,totalMinor }),context.occurredAt],
  );
}
