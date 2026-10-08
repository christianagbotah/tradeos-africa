import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireBusinessRole, type BusinessAccess, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { CashbookError, cashMethods, isCashMethod, resolveMoneyAccount, type CashMethod } from "./commerce/cashbook.js";
import { addSignedMinor, signedMinor } from "./commerce/valuation.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "./db.js";

const READ_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "VIEWER"];
const WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const ACCOUNT_KINDS = ["CASH_DRAWER", "MOMO_WALLET", "BANK_ACCOUNT", "CARD_CLEARING", "OTHER"] as const;
type AccountKind = (typeof ACCOUNT_KINDS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown, name = "id"): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new CashbookError(`${name} must be a UUID`);
  return value;
}
function text(value: unknown, name: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new CashbookError(`${name} is required`);
    return null;
  }
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) throw new CashbookError(`${name} is invalid`);
  return value.trim();
}
function revision(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new CashbookError("expectedUpdatedAt is required and must be an ISO date-time", "REVISION_REQUIRED", 400);
  }
  return new Date(value).toISOString();
}
function accountKind(value: unknown): AccountKind {
  if (typeof value !== "string" || !(ACCOUNT_KINDS as readonly string[]).includes(value)) throw new CashbookError("Invalid account kind");
  return value as AccountKind;
}
function validateKindMethod(kind: AccountKind, method: CashMethod): void {
  const expected: Partial<Record<AccountKind, CashMethod>> = {
    CASH_DRAWER: "CASH", MOMO_WALLET: "MOMO", BANK_ACCOUNT: "BANK", CARD_CLEARING: "CARD",
  };
  if (expected[kind] && expected[kind] !== method) throw new CashbookError(`${kind.replaceAll("_", " ")} must use ${expected[kind]}`);
}
function accountView(row: Record<string, unknown>) {
  return {
    id: row.id, businessId: row.business_id, branchId: row.branch_id, name: row.name, method: row.method, kind: row.kind,
    currencyCode: row.currency_code, provider: row.provider, referenceLabel: row.reference_label,
    allowNegative: row.allow_negative, active: row.active,
    balanceMinor: signedMinor(Number(row.balance_minor ?? 0)),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export function registerTreasuryRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: { businessId?: string; branchId?: string } }>("/v1/money-accounts", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.query.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const branchId = request.query.branchId ? id(request.query.branchId, "branchId") : null;
      if (access.role === "CASHIER" && !branchId) throw new CashbookError("branchId is required for cashier treasury access");
      if (branchId) await assertBranch(pool, businessId, branchId);

      const rows = await pool.query(
        `SELECT a.*,COALESCE((SELECT SUM(e.amount_delta_minor) FROM cashbook_entries e
                               WHERE e.business_id=a.business_id AND e.money_account_id=a.id),0) AS balance_minor
         FROM money_accounts a
         WHERE a.business_id=$1
           AND ($2::uuid IS NULL OR a.branch_id=$2 OR (a.branch_id IS NULL AND $3=false))
         ORDER BY a.active DESC,a.name,a.id`,
        [businessId, branchId, access.role === "CASHIER"],
      );
      const accounts = rows.rows.map(accountView);
      const totalsByMethod = Object.fromEntries(cashMethods.map((method) => [method, 0])) as Record<CashMethod, number>;
      let totalBalanceMinor = 0;
      for (const account of accounts) {
        const method = account.method as CashMethod;
        totalsByMethod[method] = addSignedMinor(totalsByMethod[method], account.balanceMinor);
        totalBalanceMinor = addSignedMinor(totalBalanceMinor, account.balanceMinor);
      }
      return { accounts, totalsByMethod, totalBalanceMinor };
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: { businessId?: string; branchId?: string | null; name?: string; method?: string; kind?: string; currencyCode?: string; provider?: string | null; referenceLabel?: string | null; allowNegative?: boolean } }>("/v1/money-accounts", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, WRITE_ROLES);
      const branchId = request.body.branchId ? id(request.body.branchId, "branchId") : null;
      const name = text(request.body.name, "name", 160, true)!;
      if (!isCashMethod(request.body.method ?? "")) throw new CashbookError("Invalid account method");
      const method = request.body.method as CashMethod;
      const kind = accountKind(request.body.kind);
      validateKindMethod(kind, method);
      if (request.body.allowNegative !== undefined && typeof request.body.allowNegative !== "boolean") throw new CashbookError("allowNegative must be boolean");
      const provider = text(request.body.provider, "provider", 300);
      const referenceLabel = text(request.body.referenceLabel, "referenceLabel", 300);

      const account = await withTransaction(pool, async (client) => {
        const currencyCode = await businessCurrency(client, businessId);
        if (request.body.currencyCode && request.body.currencyCode.toUpperCase() !== currencyCode) throw new CashbookError("Currency must match business");
        if (branchId) await assertBranch(client, businessId, branchId);
        const row = (await client.query(
          `INSERT INTO money_accounts(business_id,branch_id,name,method,kind,currency_code,provider,reference_label,allow_negative)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *,0::bigint AS balance_minor`,
          [businessId, branchId, name, method, kind, currencyCode, provider, referenceLabel, request.body.allowNegative ?? false],
        )).rows[0]!;
        await writeAdminEvent(client, businessId, branchId, access, "MONEY_ACCOUNT_CREATED", row.id, { name, method, kind });
        return accountView(row);
      });
      return reply.code(201).send({ account });
    } catch (error) { return sendError(reply, error); }
  });

  type PatchRequest = { Params: { accountId?: string }; Body: { accountId?:string; id?:string; moneyAccountId?:string; businessId?: string; expectedUpdatedAt?: string; name?: string; active?: boolean; provider?: string | null; referenceLabel?: string | null; allowNegative?: boolean } };
  const patchAccount = async (request:FastifyRequest<PatchRequest>, reply:FastifyReply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.body.businessId, "businessId");
      const accountId = id(request.params.accountId ?? request.body.accountId ?? request.body.id ?? request.body.moneyAccountId, "accountId");
      const access = await requireBusinessRole(pool, auth, businessId, WRITE_ROLES);
      const expectedUpdatedAt = revision(request.body.expectedUpdatedAt);
      if (request.body.active !== undefined && typeof request.body.active !== "boolean") throw new CashbookError("active must be boolean");
      if (request.body.allowNegative !== undefined && typeof request.body.allowNegative !== "boolean") throw new CashbookError("allowNegative must be boolean");
      const nextName = request.body.name === undefined ? null : text(request.body.name, "name", 160, true);
      const provider = request.body.provider === undefined ? undefined : text(request.body.provider, "provider", 300);
      const referenceLabel = request.body.referenceLabel === undefined ? undefined : text(request.body.referenceLabel, "referenceLabel", 300);

      const account = await withTransaction(pool, async (client) => {
        const current = (await client.query(`SELECT * FROM money_accounts WHERE business_id=$1 AND id=$2 FOR UPDATE`, [businessId, accountId])).rows[0];
        if (!current) throw new CashbookError("Account not found", "ACCOUNT_NOT_FOUND", 404);
        if (Date.parse(current.updated_at.toISOString()) !== Date.parse(expectedUpdatedAt)) {
          throw new CashbookError("Money account changed on another device. Reload before saving again.", "STALE_VERSION", 409);
        }
        if (request.body.active === false && (await client.query(`SELECT 1 FROM money_account_defaults WHERE business_id=$1 AND money_account_id=$2`, [businessId, accountId])).rowCount) {
          throw new CashbookError("Choose replacement defaults before deactivating this account", "ACCOUNT_IS_DEFAULT", 409);
        }
        if (request.body.allowNegative === false) {
          const balance = signedMinor(Number((await client.query(`SELECT COALESCE(SUM(amount_delta_minor),0) AS balance FROM cashbook_entries WHERE business_id=$1 AND money_account_id=$2`, [businessId, accountId])).rows[0].balance));
          if (balance < 0) throw new CashbookError("A negative-balance account cannot disable overdraft until its balance is non-negative");
        }
        const row = (await client.query(
          `UPDATE money_accounts SET name=COALESCE($3,name),active=COALESCE($4,active),provider=CASE WHEN $5 THEN $6 ELSE provider END,
             reference_label=CASE WHEN $7 THEN $8 ELSE reference_label END,allow_negative=COALESCE($9,allow_negative),updated_at=clock_timestamp()
           WHERE business_id=$1 AND id=$2 RETURNING *,
             (SELECT COALESCE(SUM(amount_delta_minor),0) FROM cashbook_entries e WHERE e.business_id=$1 AND e.money_account_id=$2) AS balance_minor`,
          [businessId, accountId, nextName, request.body.active ?? null, request.body.provider !== undefined, provider ?? null,
           request.body.referenceLabel !== undefined, referenceLabel ?? null, request.body.allowNegative ?? null],
        )).rows[0]!;
        const before = accountView({ ...current, balance_minor: row.balance_minor });
        const after = accountView(row);
        const changes = moneyAccountChanges(before, after);
        const eventType = before.active !== after.active
          ? (after.active ? "MONEY_ACCOUNT_REACTIVATED" : "MONEY_ACCOUNT_DEACTIVATED")
          : "MONEY_ACCOUNT_UPDATED";
        await writeAdminEvent(client, businessId, current.branch_id, access, eventType, accountId, { changes });
        return after;
      });
      return { account };
    } catch (error) { return sendError(reply, error); }
  };
  app.patch<PatchRequest>("/v1/money-accounts/:accountId",patchAccount);
  app.patch<PatchRequest>("/v1/money-accounts",patchAccount);

  app.get<{ Querystring: { businessId?: string; branchId?: string } }>("/v1/money-account-defaults", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.query.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const branchId = request.query.branchId ? id(request.query.branchId, "branchId") : null;
      if (access.role === "CASHIER" && !branchId) throw new CashbookError("branchId is required for cashier treasury access");
      if (branchId) await assertBranch(pool, businessId, branchId);
      const rows = await pool.query(
        `SELECT d.branch_id,d.method,d.money_account_id,d.updated_at,a.name AS account_name
         FROM money_account_defaults d JOIN money_accounts a ON a.business_id=d.business_id AND a.id=d.money_account_id
         WHERE d.business_id=$1 AND ($2::uuid IS NULL OR d.branch_id=$2) ORDER BY d.branch_id,d.method`,
        [businessId, branchId],
      );
      return { defaults: rows.rows.map((row) => ({ branchId: row.branch_id, method: row.method, moneyAccountId: row.money_account_id, accountName: row.account_name, updatedAt: row.updated_at.toISOString() })) };
    } catch (error) { return sendError(reply, error); }
  });

  app.put<{ Body: { businessId?: string; branchId?: string; method?: string; moneyAccountId?: string; expectedUpdatedAt?: string } }>("/v1/money-account-defaults", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.body.businessId, "businessId");
      const branchId = id(request.body.branchId, "branchId");
      const moneyAccountId = id(request.body.moneyAccountId, "moneyAccountId");
      if (!isCashMethod(request.body.method ?? "")) throw new CashbookError("Invalid money method");
      const method = request.body.method as CashMethod;
      const access = await requireBusinessRole(pool, auth, businessId, WRITE_ROLES);
      const expectedUpdatedAt = revision(request.body.expectedUpdatedAt);
      const updatedAt = await withTransaction(pool, async (client) => {
        const current = (await client.query<{ money_account_id: string; updated_at: Date }>(
          `SELECT money_account_id,updated_at FROM money_account_defaults WHERE business_id=$1 AND branch_id=$2 AND method=$3 FOR UPDATE`,
          [businessId, branchId, method],
        )).rows[0];
        if (!current) throw new CashbookError("Default account mapping was not found", "DEFAULT_NOT_FOUND", 404);
        if (Date.parse(current.updated_at.toISOString()) !== Date.parse(expectedUpdatedAt)) {
          throw new CashbookError("Default account changed on another device. Reload before saving again.", "STALE_VERSION", 409);
        }
        const currencyCode = await branchCurrency(client, businessId, branchId);
        await resolveMoneyAccount(client, { businessId, branchId, currencyCode, method, moneyAccountId });
        const changed = await client.query<{ updated_at: Date }>(
          `UPDATE money_account_defaults SET money_account_id=$4,updated_at=clock_timestamp()
           WHERE business_id=$1 AND branch_id=$2 AND method=$3 RETURNING updated_at`,
          [businessId, branchId, method, moneyAccountId],
        );
        await writeAdminEvent(client, businessId, branchId, access, "MONEY_ACCOUNT_DEFAULT_CHANGED", moneyAccountId, {
          changes: { moneyAccountId: { before: current.money_account_id, after: moneyAccountId } }, branchId, method,
        });
        return changed.rows[0]!.updated_at.toISOString();
      });
      return { branchId, method, moneyAccountId, updatedAt };
    } catch (error) { return sendError(reply, error); }
  });

  app.get<{ Querystring: { businessId?: string; branchId?: string; limit?: string } }>("/v1/money-transfers", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.query.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const branchId = request.query.branchId ? id(request.query.branchId, "branchId") : null;
      if (access.role === "CASHIER" && !branchId) throw new CashbookError("branchId is required for cashier treasury access");
      if (branchId) await assertBranch(pool, businessId, branchId);
      const limit = parseLimit(request.query.limit);
      const rows = await pool.query(
        `SELECT t.*,s.name AS source_name,d.name AS destination_name FROM money_transfers t
         JOIN money_accounts s ON s.business_id=t.business_id AND s.id=t.source_account_id
         JOIN money_accounts d ON d.business_id=t.business_id AND d.id=t.destination_account_id
         WHERE t.business_id=$1 AND ($2::uuid IS NULL OR t.branch_id=$2)
           AND ($4=false OR (s.branch_id=$2 AND d.branch_id=$2))
         ORDER BY t.occurred_at DESC,t.id DESC LIMIT $3`, [businessId, branchId, limit, access.role === "CASHIER"],
      );
      return { transfers: rows.rows.map((row) => ({ id: row.id, branchId: row.branch_id, sourceAccountId: row.source_account_id, sourceName: row.source_name,
        destinationAccountId: row.destination_account_id, destinationName: row.destination_name, amountMinor: Number(row.amount_minor), currencyCode: row.currency_code,
        actorStaffId: row.actor_staff_id, note: row.note, occurredAt: row.occurred_at.toISOString() })) };
    } catch (error) { return sendError(reply, error); }
  });

  app.get<{ Querystring: { businessId?: string; branchId?: string; limit?: string } }>("/v1/money-reconciliations", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.query.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const branchId = request.query.branchId ? id(request.query.branchId, "branchId") : null;
      if (access.role === "CASHIER" && !branchId) throw new CashbookError("branchId is required for cashier treasury access");
      if (branchId) await assertBranch(pool, businessId, branchId);
      const limit = parseLimit(request.query.limit);
      const rows = await pool.query(
        `SELECT r.*,a.name AS account_name,a.method,a.kind FROM money_reconciliations r
         JOIN money_accounts a ON a.business_id=r.business_id AND a.id=r.money_account_id
         WHERE r.business_id=$1 AND ($2::uuid IS NULL OR r.branch_id=$2)
           AND ($3=false OR a.branch_id=$2)
         ORDER BY r.occurred_at DESC,r.id DESC LIMIT $4`,
        [businessId, branchId, access.role === "CASHIER", limit],
      );
      return { reconciliations: rows.rows.map((row) => ({ id: row.id, branchId: row.branch_id, moneyAccountId: row.money_account_id, accountName: row.account_name,
        type: row.type, periodStart: row.period_start.toISOString(), periodEnd: row.period_end.toISOString(), expectedBalanceMinor: Number(row.expected_balance_minor),
        observedBalanceMinor: Number(row.observed_balance_minor), differenceMinor: Number(row.difference_minor), status: row.status, actorStaffId: row.actor_staff_id,
        note: row.note, occurredAt: row.occurred_at.toISOString(), resolutionAdjustmentId: row.resolution_adjustment_id, resolutionNote: row.resolution_note })) };
    } catch (error) { return sendError(reply, error); }
  });
}

async function assertBranch(pool: DatabasePool | DatabaseClient, businessId: string, branchId: string): Promise<void> {
  if (!(await pool.query(`SELECT 1 FROM branches WHERE business_id=$1 AND id=$2 AND is_active=true`, [businessId, branchId])).rowCount) throw new CashbookError("Branch not found", "BRANCH_NOT_FOUND", 404);
}
async function businessCurrency(client: DatabaseClient, businessId: string): Promise<string> {
  const currency = (await client.query<{currency_code:string}>(`SELECT currency_code FROM businesses WHERE id=$1 AND status='ACTIVE'`, [businessId])).rows[0]?.currency_code;
  if (!currency) throw new CashbookError("Business not found", "BUSINESS_NOT_FOUND", 404);
  return currency;
}
async function branchCurrency(client: DatabaseClient, businessId: string, branchId: string): Promise<string> {
  const currency = (await client.query<{currency_code:string}>(`SELECT b.currency_code FROM branches br JOIN businesses b ON b.id=br.business_id WHERE br.business_id=$1 AND br.id=$2 AND br.is_active=true`, [businessId, branchId])).rows[0]?.currency_code;
  if (!currency) throw new CashbookError("Branch not found", "BRANCH_NOT_FOUND", 404);
  return currency;
}
function parseLimit(value: string | undefined): number {
  const limit = Number(value ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new CashbookError("limit must be between 1 and 500");
  return limit;
}
function moneyAccountChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of ["name", "active", "provider", "referenceLabel", "allowNegative"] as const) {
    if (before[key] !== after[key]) changes[key] = { before: before[key], after: after[key] };
  }
  return changes;
}
async function writeAdminEvent(client: DatabaseClient, businessId: string, branchId: string | null, access: BusinessAccess, eventType: string, entityId: string, payload: unknown): Promise<void> {
  const json = JSON.stringify(payload);
  await client.query(`INSERT INTO audit_events(business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,payload) VALUES($1,$2,$3,$4,'MONEY_ACCOUNT',$5,$6::jsonb)`, [businessId, branchId, access.staffId, eventType, entityId, json]);
  await client.query(`INSERT INTO outbox_events(business_id,branch_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,$2,'MONEY_ACCOUNT',$3,$4,$5::jsonb)`, [businessId, branchId, entityId, eventType, json]);
}
function sendError(reply: { code(status: number): { send(body: unknown): unknown } }, error: unknown) {
  if (error instanceof CashbookError || error instanceof AuthError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  if (["23505", "23514", "23503", "P0001", "22P02"].includes((error as { code?: string })?.code ?? "")) {
    return reply.code(400).send({ error: "TREASURY_INVALID", message: error instanceof Error ? error.message : "Invalid treasury configuration" });
  }
  throw error;
}
