import type { FastifyInstance } from "fastify";
import type {
  BranchFinancialRow,
  DailyFinancialPoint,
  FinancialComparison,
  FinancialFlowSummary,
  FinancialPositionSummary,
  FinancialSummaryReport,
  ItemPerformanceRow,
} from "@tradeos/contracts";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "./db.js";
import { addSignedMinor, signedMinor } from "./commerce/valuation.js";

const READ_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "VIEWER"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

type Query = { businessId?: string; branchId?: string; from?: string; to?: string };

class ReportError extends Error {
  constructor(message: string, readonly code = "REPORT_INVALID", readonly statusCode = 400) { super(message); }
}

export function registerReportRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: Query }>("/v1/reports/financial-summary", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const branchId = request.query.branchId ? uuid(request.query.branchId, "branchId") : null;
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const from = instant(request.query.from, "from");
      const to = instant(request.query.to, "to");
      const duration = to.getTime() - from.getTime();
      if (duration <= 0) throw new ReportError("to must be later than from");
      if (duration > MAX_RANGE_MS) throw new ReportError("Report range may not exceed 366 days");
      const previousTo = from;
      const previousFrom = new Date(from.getTime() - duration);

      const report = await withTransaction(pool, async client => {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const scope = await loadScope(client, businessId, branchId);
        // Keep every report query on the same repeatable-read snapshot. node-postgres clients do not
        // support concurrent queries; sequential reads are deterministic and avoid pg@9 breakage.
        const flow = await loadFlow(client, businessId, branchId, from, to);
        const previousFlow = await loadFlow(client, businessId, branchId, previousFrom, previousTo);
        const position = await loadPosition(client, businessId, branchId, to, true);
        const previousPoint = await loadPosition(client, businessId, branchId, previousTo, false);
        const daily = await loadDaily(client, businessId, branchId, from, to, scope.timezone);
        const branches = await loadBranches(client, businessId, branchId, from, to);
        const topItems = await loadTopItems(client, businessId, branchId, from, to);
        const comparison = compareFlows(flow, previousFlow);
        const result: FinancialSummaryReport = {
          businessId,
          branchId,
          currencyCode: scope.currencyCode,
          period: { from: from.toISOString(), to: to.toISOString(), timezone: scope.timezone },
          previousPeriod: { from: previousFrom.toISOString(), to: previousTo.toISOString(), timezone: scope.timezone },
          flow,
          previousFlow,
          comparison,
          position,
          previousPosition: {
            cashBalanceMinor: previousPoint.cashBalanceMinor,
            receivablesMinor: previousPoint.receivablesMinor,
            customerCreditBalanceMinor: previousPoint.customerCreditBalanceMinor,
            payablesMinor: previousPoint.payablesMinor,
            supplierCreditBalanceMinor: previousPoint.supplierCreditBalanceMinor,
          },
          daily,
          branches,
          topItems,
        };
        return result;
      });
      return report;
    } catch (error) {
      if (error instanceof ReportError || error instanceof AuthError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      throw error;
    }
  });
}

async function loadScope(client: DatabaseClient, businessId: string, branchId: string | null) {
  const result = await client.query<{ currency_code: string; timezone: string }>(
    branchId
      ? `SELECT b.currency_code,br.timezone FROM businesses b JOIN branches br ON br.business_id=b.id WHERE b.id=$1 AND b.status='ACTIVE' AND br.id=$2 AND br.is_active=true`
      : `SELECT currency_code,timezone FROM businesses WHERE id=$1 AND status='ACTIVE'`,
    branchId ? [businessId, branchId] : [businessId],
  );
  const row = result.rows[0];
  if (!row) throw new ReportError(branchId ? "Branch not found" : "Business not found", branchId ? "BRANCH_NOT_FOUND" : "BUSINESS_NOT_FOUND", 404);
  return { currencyCode: row.currency_code, timezone: row.timezone };
}

async function loadFlow(client: DatabaseClient, businessId: string, branchId: string | null, from: Date, to: Date): Promise<FinancialFlowSummary> {
  const result = await client.query(`
    WITH sale_scope AS (
      SELECT s.id,s.subtotal_net_minor,s.tax_minor,s.total_minor,
             COALESCE((SELECT SUM(sl.line_cost_minor) FROM sale_lines sl WHERE sl.sale_id=s.id),0) AS cogs_minor
      FROM sales s
      WHERE s.business_id=$1 AND ($2::uuid IS NULL OR s.branch_id=$2)
        AND s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
        AND s.completed_at >= $3 AND s.completed_at < $4
    ), return_scope AS (
      SELECT r.net_revenue_reversal_minor,r.tax_reversal_minor,r.refund_total_minor,r.cogs_reversal_minor,r.discarded_cost_minor
      FROM return_cases r
      WHERE r.business_id=$1 AND ($2::uuid IS NULL OR r.branch_id=$2)
        AND r.status IN ('PROCESSING','COMPLETED') AND COALESCE(r.completed_at,r.created_at) >= $3 AND COALESCE(r.completed_at,r.created_at) < $4
    ), purchase_return_scope AS (
      SELECT p.purchase_price_variance_minor FROM purchase_return_cases p
      WHERE p.business_id=$1 AND ($2::uuid IS NULL OR p.branch_id=$2)
        AND p.occurred_at >= $3 AND p.occurred_at < $4
    ), expense_scope AS (
      SELECT e.amount_minor FROM expenses e
      WHERE e.business_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2)
        AND e.status='POSTED' AND e.occurred_at >= $3 AND e.occurred_at < $4
    ), cash_scope AS (
      SELECT c.amount_delta_minor,c.entry_type FROM cashbook_entries c
      WHERE c.business_id=$1 AND ($2::uuid IS NULL OR c.branch_id=$2)
        AND c.occurred_at >= $3 AND c.occurred_at < $4
    )
    SELECT
      COALESCE((SELECT SUM(subtotal_net_minor) FROM sale_scope),0) AS gross_revenue,
      COALESCE((SELECT SUM(net_revenue_reversal_minor) FROM return_scope),0) AS returns_revenue,
      COALESCE((SELECT SUM(tax_minor) FROM sale_scope),0) AS gross_tax,
      COALESCE((SELECT SUM(tax_reversal_minor) FROM return_scope),0) AS returns_tax,
      COALESCE((SELECT SUM(cogs_minor) FROM sale_scope),0) AS gross_cogs,
      COALESCE((SELECT SUM(cogs_reversal_minor) FROM return_scope),0) AS cogs_reversal,
      COALESCE((SELECT SUM(discarded_cost_minor) FROM return_scope),0) AS discarded_return_cost,
      COALESCE((SELECT SUM(purchase_price_variance_minor) FROM purchase_return_scope),0) AS purchase_return_variance,
      COALESCE((SELECT SUM(amount_minor) FROM expense_scope),0) AS expense,
      COALESCE((SELECT SUM(total_minor) FROM sale_scope),0) AS gross_sales_total,
      COALESCE((SELECT SUM(refund_total_minor) FROM return_scope),0) AS refund_total,
      (SELECT COUNT(*) FROM sale_scope) AS sales_count,
      (SELECT COUNT(*) FROM return_scope) AS return_count,
      COALESCE((SELECT SUM(amount_delta_minor) FILTER (WHERE amount_delta_minor>0) FROM cash_scope),0) AS cash_inflow,
      COALESCE(-(SELECT SUM(amount_delta_minor) FILTER (WHERE amount_delta_minor<0) FROM cash_scope),0) AS cash_outflow,
      COALESCE((SELECT SUM(amount_delta_minor) FROM cash_scope),0) AS cash_net,
      COALESCE((SELECT SUM(amount_delta_minor) FROM cash_scope WHERE entry_type IN ('SALE_RECEIPT','CUSTOMER_PAYMENT','PURCHASE_PAYMENT','SUPPLIER_PAYMENT','SALE_REFUND','PURCHASE_RETURN_RECOVERY','EXPENSE')),0) AS operating_cash_net
  `, [businessId, branchId, from.toISOString(), to.toISOString()]);
  const row = result.rows[0]!;
  const grossRevenue = minor(row.gross_revenue), returnsRevenue = minor(row.returns_revenue);
  const grossTax = minor(row.gross_tax), returnsTax = minor(row.returns_tax);
  const grossCogs = minor(row.gross_cogs), cogsReversal = minor(row.cogs_reversal);
  const netRevenue = addSignedMinor(grossRevenue, -returnsRevenue);
  const netCogs = addSignedMinor(grossCogs, -cogsReversal);
  const grossProfit = addSignedMinor(netRevenue, -netCogs);
  const expense = minor(row.expense);
  const purchaseReturnVariance = minor(row.purchase_return_variance);
  const operatingProfit = addSignedMinor(addSignedMinor(grossProfit, -expense), purchaseReturnVariance);
  const salesCount = count(row.sales_count);
  return {
    grossRevenueMinor: grossRevenue,
    returnsRevenueMinor: returnsRevenue,
    netRevenueMinor: netRevenue,
    grossTaxMinor: grossTax,
    returnsTaxMinor: returnsTax,
    netTaxMinor: addSignedMinor(grossTax, -returnsTax),
    grossCogsMinor: grossCogs,
    cogsReversalMinor: cogsReversal,
    netCogsMinor: netCogs,
    discardedReturnCostMinor: minor(row.discarded_return_cost),
    grossProfitMinor: grossProfit,
    expenseMinor: expense,
    purchaseReturnVarianceMinor: purchaseReturnVariance,
    operatingProfitMinor: operatingProfit,
    grossSalesTotalMinor: minor(row.gross_sales_total),
    refundTotalMinor: minor(row.refund_total),
    salesCount,
    returnCount: count(row.return_count),
    averageNetSaleMinor: salesCount ? signedMinor(Math.round(netRevenue / salesCount)) : 0,
    cashInflowMinor: minor(row.cash_inflow),
    cashOutflowMinor: minor(row.cash_outflow),
    netCashMovementMinor: minor(row.cash_net),
    operatingCashNetMinor: minor(row.operating_cash_net),
  };
}

async function loadPosition(client: DatabaseClient, businessId: string, branchId: string | null, asOf: Date, includeInventory: boolean): Promise<FinancialPositionSummary> {
  const result = await client.query(`
    WITH customer_balances AS (
      SELECT customer_id,SUM(balance_delta_minor) AS balance
      FROM customer_account_entries
      WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND occurred_at < $3
      GROUP BY customer_id
    ), supplier_balances AS (
      SELECT supplier_id,SUM(balance_delta_minor) AS balance
      FROM supplier_payable_ledger
      WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND occurred_at < $3
      GROUP BY supplier_id
    )
    SELECT
      COALESCE((SELECT SUM(amount_delta_minor) FROM cashbook_entries WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND occurred_at < $3),0) AS cash_balance,
      COALESCE((SELECT SUM(GREATEST(balance,0)) FROM customer_balances),0) AS receivables,
      COALESCE((SELECT SUM(GREATEST(-balance,0)) FROM customer_balances),0) AS customer_credit,
      COALESCE((SELECT SUM(GREATEST(balance,0)) FROM supplier_balances),0) AS payables,
      COALESCE((SELECT SUM(GREATEST(-balance,0)) FROM supplier_balances),0) AS supplier_credit,
      COALESCE((SELECT SUM(value_minor) FROM inventory_valuations WHERE $4::boolean AND business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2)),0) AS inventory_value,
      COALESCE((SELECT SUM(value_minor) FROM inventory_valuations WHERE $4::boolean AND business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND location_type='AVAILABLE'),0) AS inventory_available,
      COALESCE((SELECT SUM(value_minor) FROM inventory_valuations WHERE $4::boolean AND business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND location_type='QUARANTINE'),0) AS inventory_quarantine,
      COALESCE((SELECT SUM(value_minor) FROM inventory_valuations WHERE $4::boolean AND business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND location_type NOT IN ('AVAILABLE','QUARANTINE')),0) AS inventory_other
  `, [businessId, branchId, asOf.toISOString(), includeInventory]);
  const row = result.rows[0]!;
  return {
    cashBalanceMinor: minor(row.cash_balance),
    receivablesMinor: minor(row.receivables),
    customerCreditBalanceMinor: minor(row.customer_credit),
    payablesMinor: minor(row.payables),
    supplierCreditBalanceMinor: minor(row.supplier_credit),
    inventoryValueMinor: minor(row.inventory_value),
    inventoryAvailableValueMinor: minor(row.inventory_available),
    inventoryQuarantineValueMinor: minor(row.inventory_quarantine),
    inventoryOtherValueMinor: minor(row.inventory_other),
    inventorySnapshotAt: new Date().toISOString(),
    inventoryIsCurrentSnapshot: true,
  };
}

async function loadDaily(client: DatabaseClient, businessId: string, branchId: string | null, from: Date, to: Date, timezone: string): Promise<DailyFinancialPoint[]> {
  const result = await client.query(`
    WITH days AS (
      SELECT generate_series(($3::timestamptz AT TIME ZONE $5)::date, (($4::timestamptz - interval '1 microsecond') AT TIME ZONE $5)::date, interval '1 day')::date AS day
    ), sale_cost AS (
      SELECT sale_id,SUM(line_cost_minor) AS cogs FROM sale_lines GROUP BY sale_id
    ), events AS (
      SELECT (s.completed_at AT TIME ZONE $5)::date AS day,s.subtotal_net_minor AS revenue,COALESCE(sc.cogs,0) AS cogs,0::bigint AS expense,0::bigint AS purchase_variance,0::bigint AS cash_net,1::bigint AS sales_count,0::bigint AS return_count
      FROM sales s LEFT JOIN sale_cost sc ON sc.sale_id=s.id
      WHERE s.business_id=$1 AND ($2::uuid IS NULL OR s.branch_id=$2) AND s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') AND s.completed_at >= $3 AND s.completed_at < $4
      UNION ALL
      SELECT (COALESCE(r.completed_at,r.created_at) AT TIME ZONE $5)::date,-r.net_revenue_reversal_minor,-r.cogs_reversal_minor,0,0,0,0,1
      FROM return_cases r WHERE r.business_id=$1 AND ($2::uuid IS NULL OR r.branch_id=$2) AND r.status IN ('PROCESSING','COMPLETED') AND COALESCE(r.completed_at,r.created_at) >= $3 AND COALESCE(r.completed_at,r.created_at) < $4
      UNION ALL
      SELECT (e.occurred_at AT TIME ZONE $5)::date,0,0,e.amount_minor,0,0,0,0 FROM expenses e
      WHERE e.business_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2) AND e.status='POSTED' AND e.occurred_at >= $3 AND e.occurred_at < $4
      UNION ALL
      SELECT (p.occurred_at AT TIME ZONE $5)::date,0,0,0,p.purchase_price_variance_minor,0,0,0 FROM purchase_return_cases p
      WHERE p.business_id=$1 AND ($2::uuid IS NULL OR p.branch_id=$2) AND p.occurred_at >= $3 AND p.occurred_at < $4
      UNION ALL
      SELECT (c.occurred_at AT TIME ZONE $5)::date,0,0,0,0,c.amount_delta_minor,0,0 FROM cashbook_entries c
      WHERE c.business_id=$1 AND ($2::uuid IS NULL OR c.branch_id=$2) AND c.occurred_at >= $3 AND c.occurred_at < $4
    ), totals AS (
      SELECT day,SUM(revenue) AS revenue,SUM(cogs) AS cogs,SUM(expense) AS expense,SUM(purchase_variance) AS purchase_variance,SUM(cash_net) AS cash_net,SUM(sales_count) AS sales_count,SUM(return_count) AS return_count
      FROM events GROUP BY day
    )
    SELECT d.day,COALESCE(t.revenue,0) AS revenue,COALESCE(t.cogs,0) AS cogs,COALESCE(t.expense,0) AS expense,COALESCE(t.purchase_variance,0) AS purchase_variance,COALESCE(t.cash_net,0) AS cash_net,COALESCE(t.sales_count,0) AS sales_count,COALESCE(t.return_count,0) AS return_count
    FROM days d LEFT JOIN totals t USING(day) ORDER BY d.day
  `, [businessId, branchId, from.toISOString(), to.toISOString(), timezone]);
  return result.rows.map(row => {
    const revenue = minor(row.revenue), cogs = minor(row.cogs), expense = minor(row.expense);
    const grossProfit = addSignedMinor(revenue, -cogs);
    const purchaseReturnVariance = minor(row.purchase_variance);
    return {
      date: isoDate(row.day),
      netRevenueMinor: revenue,
      netCogsMinor: cogs,
      grossProfitMinor: grossProfit,
      expenseMinor: expense,
      purchaseReturnVarianceMinor: purchaseReturnVariance,
      operatingProfitMinor: addSignedMinor(addSignedMinor(grossProfit, -expense), purchaseReturnVariance),
      cashNetMinor: minor(row.cash_net),
      salesCount: count(row.sales_count),
      returnCount: count(row.return_count),
    };
  });
}

async function loadBranches(client: DatabaseClient, businessId: string, branchId: string | null, from: Date, to: Date): Promise<BranchFinancialRow[]> {
  const result = await client.query(`
    WITH sale_cost AS (SELECT sale_id,SUM(line_cost_minor) AS cogs FROM sale_lines GROUP BY sale_id),
    sales_by_branch AS (
      SELECT s.branch_id,SUM(s.subtotal_net_minor) AS revenue,SUM(COALESCE(sc.cogs,0)) AS cogs,COUNT(*) AS sales_count
      FROM sales s LEFT JOIN sale_cost sc ON sc.sale_id=s.id
      WHERE s.business_id=$1 AND ($2::uuid IS NULL OR s.branch_id=$2) AND s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') AND s.completed_at >= $3 AND s.completed_at < $4 GROUP BY s.branch_id
    ), returns_by_branch AS (
      SELECT r.branch_id,SUM(r.net_revenue_reversal_minor) AS revenue_reversal,SUM(r.cogs_reversal_minor) AS cogs_reversal,COUNT(*) AS return_count
      FROM return_cases r WHERE r.business_id=$1 AND ($2::uuid IS NULL OR r.branch_id=$2) AND r.status IN ('PROCESSING','COMPLETED') AND COALESCE(r.completed_at,r.created_at) >= $3 AND COALESCE(r.completed_at,r.created_at) < $4 GROUP BY r.branch_id
    ), purchase_returns_by_branch AS (
      SELECT branch_id,SUM(purchase_price_variance_minor) AS purchase_variance FROM purchase_return_cases
      WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND occurred_at >= $3 AND occurred_at < $4 GROUP BY branch_id
    ), expenses_by_branch AS (
      SELECT branch_id,SUM(amount_minor) AS expense FROM expenses WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND status='POSTED' AND occurred_at >= $3 AND occurred_at < $4 GROUP BY branch_id
    ), cash_by_branch AS (
      SELECT branch_id,SUM(amount_delta_minor) AS cash_net FROM cashbook_entries WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND occurred_at >= $3 AND occurred_at < $4 GROUP BY branch_id
    ), customer_group AS (
      SELECT branch_id,customer_id,SUM(balance_delta_minor) AS balance FROM customer_account_entries WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND occurred_at < $4 GROUP BY branch_id,customer_id
    ), customer_by_branch AS (
      SELECT branch_id,SUM(GREATEST(balance,0)) AS receivables,SUM(GREATEST(-balance,0)) AS customer_credit FROM customer_group GROUP BY branch_id
    ), supplier_group AS (
      SELECT branch_id,supplier_id,SUM(balance_delta_minor) AS balance FROM supplier_payable_ledger WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND occurred_at < $4 GROUP BY branch_id,supplier_id
    ), supplier_by_branch AS (
      SELECT branch_id,SUM(GREATEST(balance,0)) AS payables,SUM(GREATEST(-balance,0)) AS supplier_credit FROM supplier_group GROUP BY branch_id
    ), inventory_by_branch AS (
      SELECT branch_id,SUM(value_minor) AS inventory_value FROM inventory_valuations WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) GROUP BY branch_id
    )
    SELECT br.id,br.name,
      COALESCE(s.revenue,0)-COALESCE(r.revenue_reversal,0) AS net_revenue,
      COALESCE(s.cogs,0)-COALESCE(r.cogs_reversal,0) AS net_cogs,
      COALESCE(e.expense,0) AS expense,COALESCE(pr.purchase_variance,0) AS purchase_variance,COALESCE(c.cash_net,0) AS cash_net,
      COALESCE(cu.receivables,0) AS receivables,COALESCE(cu.customer_credit,0) AS customer_credit,
      COALESCE(sp.payables,0) AS payables,COALESCE(sp.supplier_credit,0) AS supplier_credit,
      COALESCE(i.inventory_value,0) AS inventory_value,COALESCE(s.sales_count,0) AS sales_count,COALESCE(r.return_count,0) AS return_count
    FROM branches br
    LEFT JOIN sales_by_branch s ON s.branch_id=br.id LEFT JOIN returns_by_branch r ON r.branch_id=br.id
    LEFT JOIN purchase_returns_by_branch pr ON pr.branch_id=br.id LEFT JOIN expenses_by_branch e ON e.branch_id=br.id LEFT JOIN cash_by_branch c ON c.branch_id=br.id
    LEFT JOIN customer_by_branch cu ON cu.branch_id=br.id LEFT JOIN supplier_by_branch sp ON sp.branch_id=br.id
    LEFT JOIN inventory_by_branch i ON i.branch_id=br.id
    WHERE br.business_id=$1 AND br.is_active=true AND ($2::uuid IS NULL OR br.id=$2)
    ORDER BY net_revenue DESC,br.name,br.id
  `, [businessId, branchId, from.toISOString(), to.toISOString()]);
  return result.rows.map(row => {
    const revenue = minor(row.net_revenue), cogs = minor(row.net_cogs), expense = minor(row.expense);
    const grossProfit = addSignedMinor(revenue, -cogs);
    const purchaseReturnVariance = minor(row.purchase_variance);
    return {
      branchId: row.id,
      branchName: row.name,
      netRevenueMinor: revenue,
      netCogsMinor: cogs,
      grossProfitMinor: grossProfit,
      expenseMinor: expense,
      purchaseReturnVarianceMinor: purchaseReturnVariance,
      operatingProfitMinor: addSignedMinor(addSignedMinor(grossProfit, -expense), purchaseReturnVariance),
      cashNetMinor: minor(row.cash_net),
      receivablesMinor: minor(row.receivables),
      customerCreditBalanceMinor: minor(row.customer_credit),
      payablesMinor: minor(row.payables),
      supplierCreditBalanceMinor: minor(row.supplier_credit),
      inventoryValueMinor: minor(row.inventory_value),
      salesCount: count(row.sales_count),
      returnCount: count(row.return_count),
    };
  });
}

async function loadTopItems(client: DatabaseClient, businessId: string, branchId: string | null, from: Date, to: Date): Promise<ItemPerformanceRow[]> {
  const result = await client.query(`
    WITH sale_events AS (
      SELECT sl.item_id,sl.item_name_snapshot AS item_name,sl.item_kind,
             COALESCE(sl.stock_unit_code,sl.sale_unit_code) AS unit_code,
             SUM(COALESCE(sl.stock_quantity,sl.quantity))::numeric AS sold,0::numeric AS returned,
             SUM(sl.line_net_minor)::bigint AS revenue,SUM(sl.line_cost_minor)::bigint AS cogs
      FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id AND s.business_id=sl.business_id
      WHERE s.business_id=$1 AND ($2::uuid IS NULL OR s.branch_id=$2)
        AND s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') AND s.completed_at >= $3 AND s.completed_at < $4
      GROUP BY sl.item_id,sl.item_name_snapshot,sl.item_kind,COALESCE(sl.stock_unit_code,sl.sale_unit_code)
    ), return_events AS (
      SELECT sl.item_id,sl.item_name_snapshot AS item_name,sl.item_kind,
             COALESCE(sl.stock_unit_code,sl.sale_unit_code) AS unit_code,0::numeric AS sold,
             SUM(CASE WHEN sl.stock_quantity IS NOT NULL THEN rl.quantity * sl.stock_quantity / sl.quantity ELSE rl.quantity END)::numeric AS returned,
             -SUM(rl.net_revenue_reversal_minor)::bigint AS revenue,-SUM(rl.cogs_reversal_minor)::bigint AS cogs
      FROM return_lines rl JOIN return_cases r ON r.id=rl.return_case_id JOIN sale_lines sl ON sl.id=rl.original_sale_line_id
      WHERE r.business_id=$1 AND ($2::uuid IS NULL OR r.branch_id=$2)
        AND r.status IN ('PROCESSING','COMPLETED') AND COALESCE(r.completed_at,r.created_at) >= $3 AND COALESCE(r.completed_at,r.created_at) < $4
      GROUP BY sl.item_id,sl.item_name_snapshot,sl.item_kind,COALESCE(sl.stock_unit_code,sl.sale_unit_code)
    ), events AS (SELECT * FROM sale_events UNION ALL SELECT * FROM return_events)
    SELECT item_id,MAX(item_name) AS item_name,MAX(item_kind) AS item_kind,unit_code,SUM(sold) AS sold,SUM(returned) AS returned,SUM(revenue) AS revenue,SUM(cogs) AS cogs
    FROM events GROUP BY item_id,unit_code ORDER BY SUM(revenue) DESC,SUM(revenue-cogs) DESC,item_id,unit_code LIMIT 10
  `, [businessId, branchId, from.toISOString(), to.toISOString()]);
  return result.rows.map(row => {
    const revenue = minor(row.revenue), cogs = minor(row.cogs);
    return { itemId: row.item_id, itemName: row.item_name, itemKind: row.item_kind, unitCode: row.unit_code, quantitySold: Number(row.sold), quantityReturned: Number(row.returned), netRevenueMinor: revenue, netCogsMinor: cogs, grossProfitMinor: addSignedMinor(revenue, -cogs) };
  });
}

function compareFlows(current: FinancialFlowSummary, previous: FinancialFlowSummary): FinancialComparison {
  return {
    netRevenueDeltaMinor: addSignedMinor(current.netRevenueMinor, -previous.netRevenueMinor),
    grossProfitDeltaMinor: addSignedMinor(current.grossProfitMinor, -previous.grossProfitMinor),
    expenseDeltaMinor: addSignedMinor(current.expenseMinor, -previous.expenseMinor),
    operatingProfitDeltaMinor: addSignedMinor(current.operatingProfitMinor, -previous.operatingProfitMinor),
    salesCountDelta: current.salesCount - previous.salesCount,
    netCashMovementDeltaMinor: addSignedMinor(current.netCashMovementMinor, -previous.netCashMovementMinor),
    netRevenueChangePercent: percentChange(current.netRevenueMinor, previous.netRevenueMinor),
    grossProfitChangePercent: percentChange(current.grossProfitMinor, previous.grossProfitMinor),
    operatingProfitChangePercent: percentChange(current.operatingProfitMinor, previous.operatingProfitMinor),
  };
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10000) / 100;
}
function minor(value: unknown): number { return signedMinor(Number(value ?? 0)); }
function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ReportError("Report count exceeds supported range", "REPORT_OVERFLOW", 500);
  return parsed;
}
function uuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ReportError(`${name} must be a UUID`);
  return value;
}
function instant(value: unknown, name: string): Date {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) throw new ReportError(`${name} must be an ISO date-time`);
  return new Date(value);
}
function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0,10);
  const text = String(value);
  return text.slice(0,10);
}
