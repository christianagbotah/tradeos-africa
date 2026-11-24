import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import type { DatabasePool } from "./db.js";
import { loadRefundEvidenceBranchRollup } from "./refund-evidence-branch-rollup.js";
import { normalizeRefundInvestigationSearch, refundInvestigationSearchPattern } from "./refund-investigation-search.js";
import {
  parseReceiptPaper, receiptPdfFilename, renderVerifiedSaleReceiptPdf,
  type VerifiedReceiptSnapshot,
} from "./sale-receipt-pdf.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];
// A POS attendant may print only receipts from their own completed sales.
const RECEIPT_ROLES: readonly BusinessRole[] = [...READ_ROLES, "POS_ATTENDANT"];
const REFUND_REVIEW_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "ACCOUNTANT",
];


export function registerSalesReadRoutes(app: FastifyInstance, pool: DatabasePool): void {
  // Authoritative branch-wide payment status totals, independent of the
  // receipt list limit and paging. Currency groups are never mixed.
  app.get<{ Querystring: { businessId?: string; branchId?: string } }>(
    "/v1/refunds/branch-summary",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const businessId = required(request.query.businessId, "businessId");
        const branchId = required(request.query.branchId, "branchId");
        await requireBusinessRole(pool, auth, businessId,
          ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER"]);
        await requireBranch(pool, businessId, branchId);
        const result = await pool.query<{
          currency_code: string;
          pending_count: string | number; pending_minor: string | number;
          settled_count: string | number; settled_minor: string | number;
          failed_count: string | number; failed_minor: string | number;
        }>(
          `SELECT rt.currency_code,
                  COUNT(*) FILTER (WHERE rt.status='PENDING') AS pending_count,
                  COALESCE(SUM(rt.amount_minor) FILTER (WHERE rt.status='PENDING'),0) AS pending_minor,
                  COUNT(*) FILTER (WHERE rt.status='SUCCEEDED') AS settled_count,
                  COALESCE(SUM(rt.amount_minor) FILTER (WHERE rt.status='SUCCEEDED'),0) AS settled_minor,
                  COUNT(*) FILTER (WHERE rt.status='FAILED') AS failed_count,
                  COALESCE(SUM(rt.amount_minor) FILTER (WHERE rt.status='FAILED'),0) AS failed_minor
             FROM refund_transactions rt
             JOIN return_cases rc ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
            WHERE rt.business_id=$1 AND rc.branch_id=$2
            GROUP BY rt.currency_code
            ORDER BY rt.currency_code`,
          [businessId, branchId],
        );
        // PostgreSQL BIGINT is often serialized as text. Reject amounts that
        // cannot be represented exactly in JavaScript minor units.
        const asSafeCount = (raw: string | number): number => {
          const value = Number(raw);
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new SalesReadError("Refund amount exceeds supported precision.",
              500, "REFUND_AMOUNT_UNREPRESENTABLE");
          }
          return value;
        };
        return reply.header("Cache-Control", "private, no-store, max-age=0").send({
          scope: "BRANCH_ALL_TIME",
          balances: result.rows.map((row) => ({
            currencyCode: row.currency_code,
            pendingCount: asSafeCount(row.pending_count),
            pendingMinor: asSafeCount(row.pending_minor),
            settledCount: asSafeCount(row.settled_count),
            settledMinor: asSafeCount(row.settled_minor),
            failedCount: asSafeCount(row.failed_count),
            failedMinor: asSafeCount(row.failed_minor),
          })),
        });
      } catch (error) {
        return sendReadError(request, reply, error);
      }
    },
  );

  // An independent, paginated settlement worklist prevents older outstanding
  // refunds from vanishing when the most-recent-50 sales list is full.
  // Read-only by design: merchant/operator claims are not proof of payout.
  app.get<{ Querystring: {
    businessId?: string; branchId?: string; status?: string; limit?: string; offset?: string; search?: string;
  } }>("/v1/refunds/settlement-queue", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.query.businessId, "businessId");
      const branchId = required(request.query.branchId, "branchId");
      await requireBusinessRole(pool, auth, businessId, REFUND_REVIEW_ROLES);
      await requireBranch(pool, businessId, branchId);
      const status = request.query.status ?? "ALL";
      if (!["ALL", "PENDING", "FAILED", "PENDING_24H", "PENDING_7D",
        "EVIDENCE_MISMATCH", "EVIDENCE_AWAITING_REVIEW", "EVIDENCE_NEEDS_PROVIDER",
        "EVIDENCE_MISSING"].includes(status)) {
        throw new SalesReadError(
          "Invalid refund status or provider evidence review filter.",
          400, "REFUND_STATUS_INVALID");
      }
      const limit = clampLimit(request.query.limit);
      const parsedOffset = Number(request.query.offset ?? 0);
      if (!Number.isSafeInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 100000) {
        throw new SalesReadError("Refund offset must be a nonnegative integer up to 100000.",
          400, "REFUND_OFFSET_INVALID");
      }
      const search = normalizeRefundInvestigationSearch(request.query.search);
      if (search === null) {
        throw new SalesReadError("Search must be at most 100 characters without control characters.",
          400, "REFUND_SEARCH_INVALID");
      }
      // Never combine refund liabilities denominated in different currencies.
      // The worklist is independent of the current 10-item page and status filter.
      const summaryByCurrency = await pool.query<{
        currency_code: string;
        pending_count: string | number; pending_minor: string | number;
        failed_count: string | number; failed_minor: string | number;
        pending_24h_count: string | number; pending_24h_minor: string | number;
        pending_7d_count: string | number; pending_7d_minor: string | number;
      }>(
        `SELECT rt.currency_code,
           COUNT(*) FILTER (WHERE rt.status='PENDING') AS pending_count,
           COALESCE(SUM(rt.amount_minor) FILTER (WHERE rt.status='PENDING'),0) AS pending_minor,
           COUNT(*) FILTER (WHERE rt.status='FAILED') AS failed_count,
           COALESCE(SUM(rt.amount_minor) FILTER (WHERE rt.status='FAILED'),0) AS failed_minor,
           COUNT(*) FILTER (WHERE rt.status='PENDING' AND rt.created_at < NOW() - INTERVAL '24 hours') AS pending_24h_count,
           COALESCE(SUM(rt.amount_minor) FILTER (WHERE rt.status='PENDING' AND rt.created_at < NOW() - INTERVAL '24 hours'),0) AS pending_24h_minor,
           COUNT(*) FILTER (WHERE rt.status='PENDING' AND rt.created_at < NOW() - INTERVAL '7 days') AS pending_7d_count,
           COALESCE(SUM(rt.amount_minor) FILTER (WHERE rt.status='PENDING' AND rt.created_at < NOW() - INTERVAL '7 days'),0) AS pending_7d_minor
         FROM refund_transactions rt
         JOIN return_cases rc ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
         WHERE rt.business_id=$1 AND rc.branch_id=$2 AND rt.status IN ('PENDING','FAILED')
         GROUP BY rt.currency_code ORDER BY rt.currency_code`,
        [businessId, branchId],
      );
      const result = await pool.query<{
        id: string; return_case_id: string; sale_id: string; status: "PENDING" | "FAILED";
        method: string; amount_minor: string | number; currency_code: string;
        provider_reference: string | null; reason: string;
        customer_name: string | null; created_at: Date;
        followup_count: string | number; evidence_claim_count: string | number;
        evidence_awaiting_review_count: string | number;
        evidence_discrepancy_count: string | number;
        last_escalation_kind: "ESCALATED" | "ESCALATION_REVIEWED" | null;
      }>(
        `SELECT rt.id,rt.return_case_id,rc.original_sale_id AS sale_id,rt.status,
                rt.method,rt.amount_minor,rt.currency_code,rt.provider_reference,
                rc.reason,c.name AS customer_name,rt.created_at,
                evidence.claim_count AS evidence_claim_count,
                evidence.awaiting_review_count AS evidence_awaiting_review_count,
                evidence.discrepancy_count AS evidence_discrepancy_count,
                (SELECT COUNT(*) FROM refund_followup_events f
                 WHERE f.business_id=rt.business_id AND f.refund_transaction_id=rt.id)
                  AS followup_count,
                (SELECT f.event_kind FROM refund_followup_events f
                 WHERE f.business_id=rt.business_id AND f.refund_transaction_id=rt.id
                   AND f.event_kind IN ('ESCALATED','ESCALATION_REVIEWED')
                 ORDER BY f.created_at DESC,f.id DESC LIMIT 1) AS last_escalation_kind
         FROM refund_transactions rt
         JOIN return_cases rc ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
         LEFT JOIN customers c ON c.id=rc.customer_id AND c.business_id=rt.business_id
         LEFT JOIN payments original_payment ON original_payment.id=rt.original_payment_id
           AND original_payment.business_id=rt.business_id
           AND original_payment.branch_id=rc.branch_id
           AND original_payment.sale_id=rc.original_sale_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS claim_count,
                  COUNT(*) FILTER (WHERE review.id IS NULL) AS awaiting_review_count,
                  COUNT(*) FILTER (
                    WHERE claim.reported_amount_minor<>rt.amount_minor
                       OR claim.reported_currency<>rt.currency_code
                       OR review.decision='DISCREPANCY_RECORDED'
                  ) AS discrepancy_count
           FROM refund_provider_evidence_claims claim
           LEFT JOIN refund_provider_evidence_reviews review
             ON review.evidence_claim_id=claim.id AND review.business_id=rt.business_id
             AND review.branch_id=rc.branch_id
           WHERE claim.business_id=rt.business_id AND claim.branch_id=rc.branch_id
             AND claim.refund_transaction_id=rt.id
         ) evidence ON true
         WHERE rt.business_id=$1 AND rc.branch_id=$2
           AND rt.status IN ('PENDING','FAILED')
           AND (
             $3='ALL'
             OR ($3='PENDING' AND rt.status='PENDING')
             OR ($3='FAILED' AND rt.status='FAILED')
             OR ($3='PENDING_24H' AND rt.status='PENDING'
                 AND rt.created_at < NOW() - INTERVAL '24 hours')
             OR ($3='PENDING_7D' AND rt.status='PENDING'
                 AND rt.created_at < NOW() - INTERVAL '7 days')
             OR ($3='EVIDENCE_MISMATCH' AND evidence.discrepancy_count>0)
             OR ($3='EVIDENCE_AWAITING_REVIEW' AND evidence.awaiting_review_count>0)
             OR ($3='EVIDENCE_NEEDS_PROVIDER' AND evidence.claim_count>0
                 AND evidence.awaiting_review_count=0 AND evidence.discrepancy_count=0)
             OR ($3='EVIDENCE_MISSING' AND evidence.claim_count=0
                 AND (rt.method IN ('MOMO','CARD','BANK')
                   OR (rt.method='ORIGINAL_METHOD'
                     AND original_payment.method IN ('MOMO','CARD','BANK'))))
           )
           AND ($6='' OR rt.id::text ILIKE $7 ESCAPE '!'
             OR rc.original_sale_id::text ILIKE $7 ESCAPE '!'
             OR COALESCE(c.name,'') ILIKE $7 ESCAPE '!'
             OR COALESCE(rt.provider_reference,'') ILIKE $7 ESCAPE '!'
             OR EXISTS (
               SELECT 1 FROM refund_provider_evidence_claims searched_claim
               WHERE searched_claim.business_id=rt.business_id
                 AND searched_claim.branch_id=rc.branch_id
                 AND searched_claim.refund_transaction_id=rt.id
                 AND searched_claim.provider_ref ILIKE $7 ESCAPE '!'
             ))
         ORDER BY rt.created_at ASC,rt.id ASC LIMIT $4 OFFSET $5`,
        [businessId, branchId, status, limit + 1, parsedOffset,
         search, refundInvestigationSearchPattern(search)],
      );
      const safeMinor = (raw: string | number): number => {
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value < 0) {
          throw new SalesReadError("Refund amount exceeds supported precision.",
            500, "REFUND_AMOUNT_UNREPRESENTABLE");
        }
        return value;
      };
      const evidenceSummaryByCurrency = await loadRefundEvidenceBranchRollup(
        pool, businessId, branchId);
      return reply.header("Cache-Control", "private, no-store, max-age=0").send({
        evidenceSummaryByCurrency,
        summaryByCurrency: summaryByCurrency.rows.map((row) => ({
          currencyCode: row.currency_code,
          pendingCount: safeMinor(row.pending_count),
          pendingMinor: safeMinor(row.pending_minor),
          failedCount: safeMinor(row.failed_count),
          failedMinor: safeMinor(row.failed_minor),
          pending24hCount: safeMinor(row.pending_24h_count),
          pending24hMinor: safeMinor(row.pending_24h_minor),
          pending7dCount: safeMinor(row.pending_7d_count),
          pending7dMinor: safeMinor(row.pending_7d_minor),
        })),
        items: result.rows.slice(0, limit).map((row) => ({
          id: row.id,
          returnCaseId: row.return_case_id,
          saleId: row.sale_id,
          status: row.status,
          method: row.method,
          amountMinor: safeMinor(row.amount_minor),
          currencyCode: row.currency_code,
          providerReference: row.provider_reference,
          reason: row.reason,
          customerName: row.customer_name,
          createdAt: row.created_at.toISOString(),
          followupCount: safeMinor(row.followup_count),
          evidenceClaimCount: safeMinor(row.evidence_claim_count),
          evidenceAwaitingReviewCount: safeMinor(row.evidence_awaiting_review_count),
          evidenceDiscrepancyCount: safeMinor(row.evidence_discrepancy_count),
          providerFinality: "NOT_ESTABLISHED" as const,
          escalated: row.last_escalation_kind === "ESCALATED",
        })),
        offset: parsedOffset,
        hasMore: result.rows.length > limit,
      });
    } catch (error) {
      return sendReadError(request, reply, error);
    }
  });

  app.get<{ Querystring: { businessId?: string; branchId?: string; query?: string; limit?: string } }>(
    "/v1/sales",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const businessId = required(request.query.businessId, "businessId");
        const branchId = required(request.query.branchId, "branchId");
        await requireBusinessRole(pool, auth, businessId, READ_ROLES);
        await requireBranch(pool, businessId, branchId);

        const limit = clampLimit(request.query.limit);
        const query = request.query.query?.trim() ?? "";
        const search = `%${query}%`;
        const sales = await pool.query<{
          id: string;
          status: string;
          currency_code: string;
          total_minor: string | number;
          completed_at: Date | null;
          created_at: Date;
          customer_name: string | null;
          customer_phone: string | null;
          cashier_name: string | null;
          refund_total_minor: string | number;
          refund_settled_minor: string | number;
          refund_pending_minor: string | number;
          refund_failed_minor: string | number;
          payment_summary: unknown;
        }>(
          `SELECT s.id,s.status,s.currency_code,s.total_minor,s.completed_at,s.created_at,
                  c.name AS customer_name,c.phone AS customer_phone,
                  st.display_name AS cashier_name,
                  COALESCE((SELECT SUM(rc.refund_total_minor) FROM return_cases rc
                    WHERE rc.original_sale_id=s.id
                      AND rc.business_id=s.business_id
                      AND rc.status IN ('APPROVED','PROCESSING','COMPLETED')),0) AS refund_total_minor,
                  COALESCE((SELECT SUM(rt.amount_minor)
                    FROM refund_transactions rt
                    JOIN return_cases rc ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
                    WHERE rc.original_sale_id=s.id AND rt.business_id=s.business_id
                      AND rt.status='SUCCEEDED'),0) AS refund_settled_minor,
                  COALESCE((SELECT SUM(rt.amount_minor)
                    FROM refund_transactions rt
                    JOIN return_cases rc ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
                    WHERE rc.original_sale_id=s.id AND rt.business_id=s.business_id
                      AND rt.status='PENDING'),0) AS refund_pending_minor,
                  COALESCE((SELECT SUM(rt.amount_minor)
                    FROM refund_transactions rt
                    JOIN return_cases rc ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
                    WHERE rc.original_sale_id=s.id AND rt.business_id=s.business_id
                      AND rt.status='FAILED'),0) AS refund_failed_minor,
                  COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'method',p.method,'amountMinor',p.amount_minor,'status',p.status
                  ) ORDER BY p.created_at) FROM payments p WHERE p.sale_id=s.id),'[]'::jsonb) AS payment_summary
           FROM sales s
           LEFT JOIN customers c ON c.id=s.customer_id
           LEFT JOIN staff st ON st.id=s.cashier_staff_id
           WHERE s.business_id=$1 AND s.branch_id=$2
             AND (s.status <> 'OPEN' OR EXISTS(
               SELECT 1 FROM payments pending
               WHERE pending.sale_id=s.id AND pending.business_id=s.business_id
                 AND pending.method='MOMO' AND pending.status='PENDING'))
             AND ($3='' OR s.id::text ILIKE $4 OR COALESCE(c.name,'') ILIKE $4 OR COALESCE(c.phone,'') ILIKE $4)
           ORDER BY COALESCE(s.completed_at,s.created_at) DESC
           LIMIT $5`,
          [businessId, branchId, query, search, limit],
        );

        return {
          sales: sales.rows.map((sale) => ({
            id: sale.id,
            status: sale.status,
            currencyCode: sale.currency_code,
            totalMinor: Number(sale.total_minor),
            refundTotalMinor: Number(sale.refund_total_minor),
            refundSettledMinor: Number(sale.refund_settled_minor),
            refundPendingMinor: Number(sale.refund_pending_minor),
            refundFailedMinor: Number(sale.refund_failed_minor),
            completedAt: sale.completed_at?.toISOString() ?? null,
            createdAt: sale.created_at.toISOString(),
            customer: sale.customer_name || sale.customer_phone ? { name: sale.customer_name, phone: sale.customer_phone } : null,
            cashierName: sale.cashier_name,
            payments: Array.isArray(sale.payment_summary) ? sale.payment_summary : [],
          })),
        };
      } catch (error) {
        return sendReadError(request, reply, error);
      }
    },
  );

  app.get<{ Params: { saleId: string }; Querystring: { businessId?: string } }>(
    "/v1/sales/:saleId",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const businessId = required(request.query.businessId, "businessId");
        await requireBusinessRole(pool, auth, businessId, READ_ROLES);

        const saleResult = await pool.query<{
          id: string;
          branch_id: string;
          status: string;
          currency_code: string;
          total_minor: string | number;
          completed_at: Date | null;
          created_at: Date;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          cashier_name: string | null;
        }>(
          `SELECT s.id,s.branch_id,s.status,s.currency_code,s.total_minor,s.completed_at,s.created_at,s.customer_id,
                  c.name AS customer_name,c.phone AS customer_phone,st.display_name AS cashier_name
           FROM sales s
           LEFT JOIN customers c ON c.id=s.customer_id
           LEFT JOIN staff st ON st.id=s.cashier_staff_id
           WHERE s.id=$1 AND s.business_id=$2`,
          [request.params.saleId, businessId],
        );
        const sale = saleResult.rows[0];
        if (!sale) throw new SalesReadError("Sale was not found", 404, "SALE_NOT_FOUND");

        const lines = await pool.query<{
          id: string;
          item_id: string;
          item_name_snapshot: string;
          item_kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
          quantity: string | number;
          sale_unit_code: string;
          unit_net_minor: string | number;
          unit_tax_minor: string | number;
          line_tax_minor: string | number;
          unit_cost_minor: string | number;
          line_cost_minor: string | number;
          line_total_minor: string | number;
          quantity_returned: string | number;
        }>(
          `SELECT sl.id,sl.item_id,sl.item_name_snapshot,sl.item_kind,sl.quantity,sl.sale_unit_code,
                  sl.unit_net_minor,sl.unit_tax_minor,sl.line_tax_minor,sl.unit_cost_minor,sl.line_cost_minor,sl.line_total_minor,
                  COALESCE((SELECT SUM(rl.quantity)
                    FROM return_lines rl JOIN return_cases rc ON rc.id=rl.return_case_id
                    WHERE rl.original_sale_line_id=sl.id
                      AND rc.status IN ('PENDING_APPROVAL','APPROVED','PROCESSING','COMPLETED')),0) AS quantity_returned
           FROM sale_lines sl
           WHERE sl.sale_id=$1 AND sl.business_id=$2
           ORDER BY sl.created_at,sl.id`,
          [sale.id, businessId],
        );

        const payments = await pool.query<{
          id: string;
          method: string;
          amount_minor: string | number;
          status: string;
          provider_reference: string | null;
          refunded_minor: string | number;
        }>(
          `SELECT p.id,p.method,p.amount_minor,p.status,p.provider_reference,
                  COALESCE((SELECT SUM(rt.amount_minor) FROM refund_transactions rt
                    WHERE rt.original_payment_id=p.id AND rt.status IN ('PENDING','SUCCEEDED')),0) AS refunded_minor
           FROM payments p WHERE p.sale_id=$1 ORDER BY p.created_at,p.id`,
          [sale.id],
        );

        return {
          sale: {
            id: sale.id,
            businessId,
            branchId: sale.branch_id,
            status: sale.status,
            currencyCode: sale.currency_code,
            totalMinor: Number(sale.total_minor),
            completedAt: sale.completed_at?.toISOString() ?? null,
            createdAt: sale.created_at.toISOString(),
            customer: sale.customer_id ? { id: sale.customer_id, name: sale.customer_name, phone: sale.customer_phone } : null,
            cashierName: sale.cashier_name,
            lines: lines.rows.map((line) => {
              const quantity = Number(line.quantity);
              const quantityReturned = Number(line.quantity_returned);
              return {
                id: line.id,
                itemId: line.item_id,
                itemName: line.item_name_snapshot,
                itemKind: line.item_kind,
                quantity,
                quantityReturned,
                quantityReturnable: Math.max(0, quantity - quantityReturned),
                saleUnitCode: line.sale_unit_code,
                unitNetMinor: Number(line.unit_net_minor),
                unitTaxMinor: Number(line.unit_tax_minor),
                lineTaxMinor: Number(line.line_tax_minor),
                unitCostMinor: Number(line.unit_cost_minor),
                lineCostMinor: Number(line.line_cost_minor),
                lineTotalMinor: Number(line.line_total_minor),
              };
            }),
            payments: payments.rows.map((payment) => ({
              id: payment.id,
              method: payment.method,
              amountMinor: Number(payment.amount_minor),
              refundedMinor: Number(payment.refunded_minor),
              status: payment.status,
              providerReference: payment.provider_reference,
            })),
          },
        };
      } catch (error) {
        return sendReadError(request, reply, error);
      }
    },
  );

  // The PDF is generated from current authenticated, tenant-scoped server
  // records. A redirect, local queue or pending Hubtel transaction is NOT
  // sufficient to release a receipt.
  app.get<{Params:{saleId:string};Querystring:{businessId?:string;paper?:string}}>(
    "/v1/sales/:saleId/receipt.pdf",async(request,reply)=>{
      try {
        const auth=await authenticateAccessToken(pool,request.headers.authorization);
        const businessId=required(request.query.businessId,"businessId");
        const access=await requireBusinessRole(pool,auth,businessId,RECEIPT_ROLES);
        if (access.role === "POS_ATTENDANT" && !access.staffId) {
          throw new AuthError("An active staff identity is required",403,"STAFF_ACTOR_REQUIRED");
        }
        const ownedStaffId=access.role === "POS_ATTENDANT" ? access.staffId : null;
        const saleId=request.params.saleId;
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleId)){
          throw new SalesReadError("Invalid receipt ID",400,"RECEIPT_ID_INVALID");
        }
        let paper:ReturnType<typeof parseReceiptPaper>;
        try { paper=parseReceiptPaper(request.query.paper); }
        catch {throw new SalesReadError("Select A5, 80mm or 58mm receipt paper",400,"RECEIPT_PAPER_INVALID");}
        const found=await pool.query<{
          id:string;status:string;completed_at:Date|null;
          total_minor:string|number;currency_code:string;
          business_name:string;branch_name:string|null;timezone:string|null;
          address:string|null;phone:string|null;customer_name:string|null;
          customer_phone:string|null;cashier_name:string|null;
        }>(
          `SELECT s.id,s.status,s.completed_at,s.total_minor,s.currency_code,
                  b.name AS business_name,br.name AS branch_name,
                  COALESCE(br.timezone,b.timezone) AS timezone,
                  CONCAT_WS(', ',NULLIF(COALESCE(br.address_line1,b.address_line1), ''),
                             NULLIF(COALESCE(br.city,b.city), '')) AS address,
                  COALESCE(br.phone,b.phone) AS phone,
                  c.name AS customer_name,c.phone AS customer_phone,
                  st.display_name AS cashier_name
           FROM sales s JOIN businesses b ON b.id=s.business_id
           LEFT JOIN branches br ON br.id=s.branch_id AND br.business_id=s.business_id
           LEFT JOIN customers c ON c.id=s.customer_id AND c.business_id=s.business_id
           LEFT JOIN staff st ON st.id=s.cashier_staff_id AND st.business_id=s.business_id
           WHERE s.id=$1 AND s.business_id=$2
             AND ($3::uuid IS NULL OR s.cashier_staff_id=$3::uuid)`,
          [saleId,businessId,ownedStaffId],
        );
        const sale=found.rows[0];
        if(!sale)throw new SalesReadError("Sale was not found",404,"SALE_NOT_FOUND");
        if(!["COMPLETED","PARTIALLY_REFUNDED","REFUNDED"].includes(sale.status)||
            !sale.completed_at)throw new SalesReadError(
          "A final receipt is available only for a completed, verified sale.",
          409,"SALE_NOT_COMPLETED");
        const lines=await pool.query<{
          item_name_snapshot:string;quantity:string|number;sale_unit_code:string;
          unit_net_minor:string|number;line_tax_minor:string|number;
          line_total_minor:string|number;
        }>(`SELECT item_name_snapshot,quantity,sale_unit_code,
                   unit_net_minor,line_tax_minor,line_total_minor
            FROM sale_lines WHERE sale_id=$1 AND business_id=$2
            ORDER BY created_at,id`,[saleId,businessId]);
        const payments=await pool.query<{
          method:string;amount_minor:string|number;status:string;
          refunded_minor:string|number;
        }>(`SELECT p.method,p.amount_minor,p.status,
                   COALESCE((SELECT SUM(rt.amount_minor) FROM refund_transactions rt
                     WHERE rt.original_payment_id=p.id AND rt.status IN ('PENDING','SUCCEEDED')),0) AS refunded_minor
            FROM payments p WHERE p.sale_id=$1 AND p.business_id=$2
            ORDER BY p.created_at,p.id`,[saleId,businessId]);
        if(lines.rows.length===0 || payments.rows.some(p=>p.status==="PENDING")){
          throw new SalesReadError("This sale has pending payment or missing items.",
            409,"RECEIPT_NOT_VERIFIED");
        }
        const snapshot:VerifiedReceiptSnapshot={
          saleId:sale.id,
          status:sale.status as VerifiedReceiptSnapshot["status"],
          completedAt:sale.completed_at.toISOString(),
          businessName:sale.business_name,branchName:sale.branch_name??"",
          address:sale.address??"",phone:sale.phone??"",timezone:sale.timezone??"Africa/Accra",
          customerName:sale.customer_name??sale.customer_phone??"Walk-in customer",
          cashierName:sale.cashier_name??"",currencyCode:sale.currency_code,
          totalMinor:Number(sale.total_minor),
          lines:lines.rows.map(line=>({
            name:line.item_name_snapshot,quantity:Number(line.quantity),
            unitCode:line.sale_unit_code,unitNetMinor:Number(line.unit_net_minor),
            lineTaxMinor:Number(line.line_tax_minor),
            lineTotalMinor:Number(line.line_total_minor),
          })),
          payments:payments.rows.map(payment=>({
            method:payment.method,amountMinor:Number(payment.amount_minor),
            refundedMinor:Number(payment.refunded_minor),status:payment.status,
          })),
        };
        const pdf=await renderVerifiedSaleReceiptPdf(snapshot,paper);
        const filename=receiptPdfFilename(saleId,paper);
        return reply.header("Content-Type","application/pdf")
          .header("Content-Disposition",'attachment; filename="'+filename+'"')
          .header("Cache-Control","private, no-store")
          .header("X-Content-Type-Options","nosniff")
          .header("Content-Length",String(pdf.length))
          .send(pdf);
      }catch(error){return sendReadError(request,reply,error);}
    },
  );
}

class SalesReadError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "SALES_READ_INVALID") {
    super(message);
  }
}

async function requireBranch(pool: DatabasePool, businessId: string, branchId: string): Promise<void> {
  const branch = await pool.query(`SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true`, [branchId, businessId]);
  if (branch.rowCount !== 1) throw new SalesReadError("Branch was not found for this business", 404, "BRANCH_NOT_FOUND");
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new SalesReadError(`${name} is required`);
  return normalized;
}

function clampLimit(value: string | undefined): number {
  const parsed = Number(value ?? 25);
  if (!Number.isInteger(parsed) || parsed < 1) return 25;
  return Math.min(parsed, 100);
}

function sendReadError(request: { log: { error: (error: unknown) => void } }, reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof SalesReadError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "SALES_READ_FAILED", message: "Sales could not be loaded." });
}
