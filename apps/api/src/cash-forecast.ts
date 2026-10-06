import type { FastifyInstance } from "fastify";
import { buildCashForecast, CashForecastOverflowError, type CashForecastObligationDay } from "@tradeos/domain";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "./db.js";

const READ_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "VIEWER"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const OPERATING_ENTRY_TYPES = "'SALE_RECEIPT','CUSTOMER_PAYMENT','PURCHASE_PAYMENT','SUPPLIER_PAYMENT','SALE_REFUND','PURCHASE_RETURN_RECOVERY','EXPENSE'";

type Query = { businessId?: string; branchId?: string; days?: string };
type Scope = {
  currencyCode: string;
  timezone: string;
  startDate: string;
  startAt: string;
  endAt: string;
  openingCashMinor: number;
};
type ObligationRow = { day: string | null; amount: string | null; overdue_amount: string | null; day_count: string | null; total_count: string };
type ObligationSide = { rows: Array<{ date: string; amountMinor: number; overdueMinor: number; count: number }>; totalCount: number };

class CashForecastReportError extends Error {
  constructor(message: string, readonly code = "REPORT_INVALID", readonly statusCode = 400) {
    super(message);
  }
}

export function registerCashForecastRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: Query }>("/v1/reports/cash-forecast", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const branchId = request.query.branchId ? uuid(request.query.branchId, "branchId") : null;
      const horizonDays = days(request.query.days);
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const generatedAt = new Date();

      return await withTransaction(pool, async client => {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const scope = await loadScope(client, businessId, branchId, generatedAt, horizonDays);
        const customer = await loadObligations(client, "customer_credit_obligations", businessId, branchId, scope);
        const supplier = await loadObligations(client, "supplier_credit_obligations", businessId, branchId, scope);
        const history = await loadOperatingHistory(client, businessId, branchId, scope);
        const obligations = mergeObligations(customer, supplier);

        return buildCashForecast({
          generatedAt: generatedAt.toISOString(),
          businessId,
          branchId,
          timezone: scope.timezone,
          currencyCode: scope.currencyCode,
          forecastStartDate: scope.startDate,
          horizonDays,
          openingCashMinor: scope.openingCashMinor,
          history,
          obligations,
          openCustomerObligationCount: customer.totalCount,
          openSupplierObligationCount: supplier.totalCount,
        });
      });
    } catch (error) {
      if (error instanceof CashForecastReportError || error instanceof AuthError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      if (error instanceof CashForecastOverflowError) {
        return reply.code(500).send({ error: "REPORT_OVERFLOW", message: error.message });
      }
      throw error;
    }
  });
}

async function loadScope(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  generatedAt: Date,
  horizonDays: number,
): Promise<Scope> {
  const result = await client.query<{
    currency_code: string;
    timezone: string;
    start_date: string | Date;
    start_at: Date;
    end_at: Date;
    opening_cash: string;
  }>(`
    WITH meta AS (
      SELECT b.currency_code::text AS currency_code,
             CASE WHEN $2::uuid IS NULL THEN b.timezone ELSE br.timezone END AS timezone
      FROM businesses b
      LEFT JOIN branches br
        ON br.id=$2::uuid AND br.business_id=b.id AND br.is_active=true
      WHERE b.id=$1::uuid AND b.status='ACTIVE'
    ), local_bounds AS (
      SELECT currency_code,timezone,($3::timestamptz AT TIME ZONE timezone)::date AS start_date
      FROM meta WHERE timezone IS NOT NULL
    ), bounds AS (
      SELECT currency_code,timezone,start_date,
             start_date::timestamp AT TIME ZONE timezone AS start_at,
             (start_date + $4::int)::timestamp AT TIME ZONE timezone AS end_at
      FROM local_bounds
    )
    SELECT currency_code,timezone,start_date,start_at,end_at,
           COALESCE((
             SELECT SUM(c.amount_delta_minor)
             FROM cashbook_entries c
             WHERE c.business_id=$1::uuid
               AND ($2::uuid IS NULL OR c.branch_id=$2::uuid)
               AND c.occurred_at < bounds.start_at
           ),0)::text AS opening_cash
    FROM bounds
  `, [businessId, branchId, generatedAt.toISOString(), horizonDays]);
  const row = result.rows[0];
  if (!row) {
    throw new CashForecastReportError(
      branchId ? "Branch not found" : "Business not found",
      branchId ? "BRANCH_NOT_FOUND" : "BUSINESS_NOT_FOUND",
      404,
    );
  }
  return {
    currencyCode: row.currency_code.trim(),
    timezone: row.timezone,
    startDate: dateText(row.start_date),
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    openingCashMinor: safeMinor(row.opening_cash, "opening cash"),
  };
}

async function loadObligations(
  client: DatabaseClient,
  table: "customer_credit_obligations" | "supplier_credit_obligations",
  businessId: string,
  branchId: string | null,
  scope: Scope,
): Promise<ObligationSide> {
  const result = await client.query<ObligationRow>(`
    WITH scoped AS (
      SELECT due_at,open_minor
      FROM ${table}
      WHERE business_id=$1::uuid
        AND ($2::uuid IS NULL OR branch_id=$2::uuid)
        AND open_minor > 0
    ), totals AS (
      SELECT COUNT(*)::text AS total_count FROM scoped
    ), daily AS (
      SELECT CASE
               WHEN due_at < $3::timestamptz THEN $5::date
               ELSE (due_at AT TIME ZONE $6)::date
             END AS day,
             SUM(open_minor)::text AS amount,
             COALESCE(SUM(open_minor) FILTER (WHERE due_at < $3::timestamptz),0)::text AS overdue_amount,
             COUNT(*)::text AS day_count
      FROM scoped
      WHERE due_at < $4::timestamptz
      GROUP BY 1
    )
    SELECT daily.day::text AS day,daily.amount,daily.overdue_amount,daily.day_count,totals.total_count
    FROM totals LEFT JOIN daily ON true
    ORDER BY daily.day NULLS LAST
  `, [businessId, branchId, scope.startAt, scope.endAt, scope.startDate, scope.timezone]);

  const totalCount = safeCount(result.rows[0]?.total_count ?? "0", `${table} count`);
  const rows = result.rows
    .filter((row): row is ObligationRow & { day: string } => row.day !== null)
    .map(row => ({
      date: row.day,
      amountMinor: safeNonNegativeMinor(row.amount ?? "0", `${table} amount`),
      overdueMinor: safeNonNegativeMinor(row.overdue_amount ?? "0", `${table} overdue amount`),
      count: safeCount(row.day_count ?? "0", `${table} day count`),
    }));
  return { rows, totalCount };
}

async function loadOperatingHistory(client: DatabaseClient, businessId: string, branchId: string | null, scope: Scope) {
  const result = await client.query<{ day: string; inflow: string; outflow: string }>(`
    WITH params AS (
      SELECT $3::date AS start_date,$4::text AS timezone,$5::timestamptz AS start_at,
             (($3::date - 56)::timestamp AT TIME ZONE $4::text) AS window_start_at
    ), first_activity AS (
      SELECT MIN((c.occurred_at AT TIME ZONE p.timezone)::date) AS first_day
      FROM cashbook_entries c CROSS JOIN params p
      WHERE c.business_id=$1::uuid
        AND ($2::uuid IS NULL OR c.branch_id=$2::uuid)
        AND c.entry_type IN (${OPERATING_ENTRY_TYPES})
        AND c.occurred_at < p.start_at
    ), history_start AS (
      SELECT GREATEST(p.start_date - 56,f.first_day) AS first_day,p.start_date
      FROM params p CROSS JOIN first_activity f
      WHERE f.first_day IS NOT NULL
    ), days AS (
      SELECT generate_series(h.first_day,h.start_date - 1,interval '1 day')::date AS day
      FROM history_start h
    ), events AS (
      SELECT (c.occurred_at AT TIME ZONE p.timezone)::date AS day,
             COALESCE(SUM(c.amount_delta_minor) FILTER (WHERE c.amount_delta_minor > 0),0)::text AS inflow,
             COALESCE(-SUM(c.amount_delta_minor) FILTER (WHERE c.amount_delta_minor < 0),0)::text AS outflow
      FROM cashbook_entries c CROSS JOIN params p
      WHERE c.business_id=$1::uuid
        AND ($2::uuid IS NULL OR c.branch_id=$2::uuid)
        AND c.entry_type IN (${OPERATING_ENTRY_TYPES})
        AND c.occurred_at >= p.window_start_at
        AND c.occurred_at < p.start_at
      GROUP BY 1
    )
    SELECT d.day::text AS day,COALESCE(e.inflow,'0') AS inflow,COALESCE(e.outflow,'0') AS outflow
    FROM days d LEFT JOIN events e USING(day)
    ORDER BY d.day
  `, [businessId, branchId, scope.startDate, scope.timezone, scope.startAt]);

  return result.rows.map(row => ({
    date: row.day,
    inflowMinor: safeNonNegativeMinor(row.inflow, "historical operating inflow"),
    outflowMinor: safeNonNegativeMinor(row.outflow, "historical operating outflow"),
  }));
}

function mergeObligations(customer: ObligationSide, supplier: ObligationSide): CashForecastObligationDay[] {
  const byDate = new Map<string, CashForecastObligationDay>();
  const row = (date: string) => {
    const existing = byDate.get(date);
    if (existing) return existing;
    const created: CashForecastObligationDay = {
      date,
      customerInflowsMinor: 0,
      overdueCustomerInflowsMinor: 0,
      customerObligationCount: 0,
      supplierOutflowsMinor: 0,
      overdueSupplierOutflowsMinor: 0,
      supplierObligationCount: 0,
    };
    byDate.set(date, created);
    return created;
  };
  for (const item of customer.rows) {
    const target = row(item.date);
    target.customerInflowsMinor = item.amountMinor;
    target.overdueCustomerInflowsMinor = item.overdueMinor;
    target.customerObligationCount = item.count;
  }
  for (const item of supplier.rows) {
    const target = row(item.date);
    target.supplierOutflowsMinor = item.amountMinor;
    target.overdueSupplierOutflowsMinor = item.overdueMinor;
    target.supplierObligationCount = item.count;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function safeMinor(value: unknown, label: string): number {
  let parsed: bigint;
  try {
    parsed = BigInt(String(value ?? "0"));
  } catch {
    throw new CashForecastReportError(`${label} is not an integer`, "REPORT_INVALID", 500);
  }
  if (parsed > MAX_SAFE_BIGINT || parsed < MIN_SAFE_BIGINT) throw new CashForecastOverflowError(`${label} exceeds safe integer range`);
  return Number(parsed);
}

function safeNonNegativeMinor(value: unknown, label: string): number {
  const parsed = safeMinor(value, label);
  if (parsed < 0) throw new CashForecastReportError(`${label} cannot be negative`, "REPORT_INVALID", 500);
  return parsed;
}

function safeCount(value: unknown, label: string): number {
  const parsed = safeNonNegativeMinor(value, label);
  if (!Number.isSafeInteger(parsed)) throw new CashForecastOverflowError(`${label} exceeds safe integer range`);
  return parsed;
}

function uuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new CashForecastReportError(`${name} must be a UUID`);
  return value;
}

function days(value: unknown): number {
  if (value === undefined) return 30;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new CashForecastReportError("days must be an integer from 1 to 30");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) throw new CashForecastReportError("days must be an integer from 1 to 30");
  return parsed;
}

function dateText(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
