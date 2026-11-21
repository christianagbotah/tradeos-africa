import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { requireBusinessRole } from "./auth/authorization.js";
import type { DatabasePool } from "./db.js";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"] as const;
const EXPORT_STATUSES = [
  "ALL", "PENDING", "FAILED", "PENDING_24H", "PENDING_7D",
  "EVIDENCE_MISMATCH", "EVIDENCE_AWAITING_REVIEW",
  "EVIDENCE_NEEDS_PROVIDER", "EVIDENCE_MISSING",
] as const;
export type RefundEvidenceExportFilter = typeof EXPORT_STATUSES[number];

// Explicit cap: never silently truncate a financial investigation report.
// Narrow by status/currency before retrying when a branch has >5,000 matches.
export const MAX_EVIDENCE_EXPORT_ROWS = 5000;

type CsvSourceRow = {
  refund_id: string;
  sale_id: string;
  created_at: Date;
  status: "PENDING" | "FAILED";
  method: string;
  amount_minor: string;
  currency_code: string;
  customer_name: string | null;
  reason: string;
  claim_count: string;
  awaiting_review_count: string;
  discrepancy_count: string;
  is_electronic: boolean;
  latest_provider_code: string | null;
  latest_provider_ref: string | null;
  latest_claim_status: string | null;
  latest_review_decision: string | null;
};

class ExportError extends Error {
  constructor(message: string, readonly statusCode = 400,
    readonly code = "REFUND_EXPORT_INVALID") { super(message); }
}
function requiredId(raw: unknown, name: string) {
  if (typeof raw !== "string" || !ID.test(raw)) {
    throw new ExportError("A valid " + name + " is required.", 400,
      "REFUND_EXPORT_ID_INVALID");
  }
  return raw;
}
function parseStatus(raw: unknown): RefundEvidenceExportFilter {
  const status = raw ?? "ALL";
  if (typeof status !== "string" ||
      !EXPORT_STATUSES.includes(status as RefundEvidenceExportFilter)) {
    throw new ExportError("Choose a supported refund investigation filter.", 400,
      "REFUND_EXPORT_FILTER_INVALID");
  }
  return status as RefundEvidenceExportFilter;
}
function parseCurrency(raw: unknown): string | null {
  if (raw === undefined || raw === "" || raw === "ALL") return null;
  if (typeof raw !== "string" || !/^[A-Z]{3}$/.test(raw)) {
    throw new ExportError("Use a three-letter ISO currency code.", 400,
      "REFUND_EXPORT_CURRENCY_INVALID");
  }
  return raw;
}
function safeInt(raw: string, name: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(raw) ||
      !Number.isSafeInteger(Number(raw))) {
    throw new ExportError(name + " exceeds safe minor-unit precision.", 409,
      "REFUND_EXPORT_PRECISION_INVALID");
  }
  return Number(raw);
}

/**
 * Quote each spreadsheet cell and prevent formula execution in Excel/Sheets.
 * Quoting alone does not prevent CSV injection: a leading +, -, = or @ is
 * a formula even inside a quoted CSV field. Remove control/newline characters
 * and prefix suspicious cells with a literal apostrophe.
 */
export function refundEvidenceCsvCell(value: string | number | null | undefined): string {
  const cleaned = String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  const escaped = /^[=+\-@]/.test(cleaned) ? "'" + cleaned : cleaned;
  return '"' + escaped.replace(/"/g, '""') + '"';
}

function nonnegative(raw: string, name: string): number {
  return safeInt(raw, name);
}
export function evidenceAttentionState(input: {
  claimCount: number; awaitingReviewCount: number;
  discrepancyCount: number; isElectronic: boolean;
}): "DISCREPANCY"|"AWAITING_REVIEW"|"PROVIDER_PROOF_REQUIRED"|
  "NO_EVIDENCE_SUBMITTED"|"NOT_ELECTRONIC" {
  if (input.discrepancyCount > 0) return "DISCREPANCY";
  if (input.awaitingReviewCount > 0) return "AWAITING_REVIEW";
  if (input.claimCount > 0) return "PROVIDER_PROOF_REQUIRED";
  return input.isElectronic ? "NO_EVIDENCE_SUBMITTED" : "NOT_ELECTRONIC";
}

const CSV_COLUMNS = [
  "Refund ID", "Original sale ID", "Created at UTC", "Status",
  "Refund method", "Currency (ISO)", "Expected amount (minor units)",
  "Customer name", "Return reason", "Submitted claim count",
  "Unreviewed claim count", "Discrepancy claim count", "Evidence priority",
  "Latest claimed provider", "Latest claimed refund reference",
  "Latest merchant-reported status", "Latest staff review decision",
  "Evidence source", "Provider finality", "Can mark paid",
] as const;

export function renderRefundEvidenceInvestigationCsv(rows: CsvSourceRow[]): Buffer {
  if (rows.length > MAX_EVIDENCE_EXPORT_ROWS) {
    throw new ExportError(
      "Too many unresolved refunds for one export. Narrow by evidence status or currency.",
      413, "REFUND_EXPORT_TOO_LARGE");
  }
  const body = [CSV_COLUMNS.map(refundEvidenceCsvCell).join(",")];
  for (const row of rows) {
    const amount = safeInt(row.amount_minor, "Refund amount");
    const claimCount = nonnegative(row.claim_count, "Claim count");
    const awaitingReviewCount = nonnegative(row.awaiting_review_count, "Review count");
    const discrepancyCount = nonnegative(row.discrepancy_count, "Discrepancy count");
    if (!Number.isFinite(new Date(row.created_at).getTime()) ||
        !/^[A-Z]{3}$/.test(row.currency_code) ||
        !["PENDING","FAILED"].includes(row.status) ||
        awaitingReviewCount > claimCount ||
        discrepancyCount > claimCount) {
      throw new ExportError("A refund investigation record could not be validated.",
        409, "REFUND_EXPORT_RECORD_INVALID");
    }
    const values = [
      row.refund_id, row.sale_id, new Date(row.created_at).toISOString(),
      row.status, row.method, row.currency_code, amount,
      row.customer_name ?? "Walk-in customer", row.reason,
      claimCount, awaitingReviewCount, discrepancyCount,
      evidenceAttentionState({
        claimCount, awaitingReviewCount, discrepancyCount, isElectronic: row.is_electronic,
      }),
      row.latest_provider_code ?? "", row.latest_provider_ref ?? "",
      row.latest_claim_status ?? "", row.latest_review_decision ?? "",
      "MERCHANT_SUPPLIED_UNVERIFIED", "NOT_ESTABLISHED", "FALSE",
    ];
    body.push(values.map(refundEvidenceCsvCell).join(","));
  }
  // UTF-8 BOM lets Excel display Ghana cedi symbols and names correctly.
  return Buffer.from("\ufeff" + body.join("\r\n") + "\r\n", "utf8");
}

export function registerRefundEvidenceExportRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{Querystring:{
    businessId?:string;branchId?:string;status?:string;currencyCode?:string;
  }}>(
    "/v1/refunds/settlement-evidence-export", async(request,reply) => {
      reply.header("Cache-Control", "private, no-store, max-age=0");
      reply.header("X-Content-Type-Options", "nosniff");
      try {
        const auth=await authenticateAccessToken(pool,request.headers.authorization);
        const businessId=requiredId(request.query.businessId,"business ID");
        const branchId=requiredId(request.query.branchId,"branch ID");
        const status=parseStatus(request.query.status);
        const currency=parseCurrency(request.query.currencyCode);
        await requireBusinessRole(pool,auth,businessId,ROLES);
        const branch=await pool.query(
          "SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true",
          [branchId,businessId]);
        if(branch.rowCount!==1)throw new ExportError(
          "Branch is unavailable to this business.",404,"REFUND_EXPORT_BRANCH_NOT_FOUND");

        // Single, repeatable statement: every row's claim counts, latest claim,
        // currency, and refund status come from one PostgreSQL read snapshot.
        const result=await pool.query<CsvSourceRow>(
          `SELECT rt.id AS refund_id,rc.original_sale_id AS sale_id,
              rt.created_at,rt.status,rt.method,rt.amount_minor::text,
              rt.currency_code,customer.name AS customer_name,rc.reason,
              evidence.claim_count::text,evidence.awaiting_review_count::text,
              evidence.discrepancy_count::text,
              (rt.method IN ('MOMO','CARD','BANK')
                OR (rt.method='ORIGINAL_METHOD'
                  AND original_payment.method IN ('MOMO','CARD','BANK'))
              ) AS is_electronic,
              latest.provider_code AS latest_provider_code,
              latest.provider_ref AS latest_provider_ref,
              latest.reported_status AS latest_claim_status,
              latest.review_decision AS latest_review_decision
            FROM refund_transactions rt
            JOIN return_cases rc ON rc.id=rt.return_case_id
              AND rc.business_id=rt.business_id AND rc.branch_id=$2
            LEFT JOIN customers customer ON customer.id=rc.customer_id
              AND customer.business_id=rt.business_id
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
                ON review.evidence_claim_id=claim.id
                AND review.business_id=rt.business_id
                AND review.branch_id=rc.branch_id
              WHERE claim.business_id=rt.business_id AND claim.branch_id=rc.branch_id
                AND claim.refund_transaction_id=rt.id
            ) evidence ON true
            LEFT JOIN LATERAL (
              SELECT claim.provider_code,claim.provider_ref,claim.reported_status,
                     review.decision AS review_decision
              FROM refund_provider_evidence_claims claim
              LEFT JOIN refund_provider_evidence_reviews review
                ON review.evidence_claim_id=claim.id
                AND review.business_id=rt.business_id
                AND review.branch_id=rc.branch_id
              WHERE claim.business_id=rt.business_id AND claim.branch_id=rc.branch_id
                AND claim.refund_transaction_id=rt.id
              ORDER BY claim.created_at DESC,claim.id DESC LIMIT 1
            ) latest ON true
            WHERE rt.business_id=$1 AND rt.status IN ('PENDING','FAILED')
              AND ($4::char(3) IS NULL OR rt.currency_code=$4)
              AND (
                $3='ALL'
                OR ($3='PENDING' AND rt.status='PENDING')
                OR ($3='FAILED' AND rt.status='FAILED')
                OR ($3='PENDING_24H' AND rt.status='PENDING'
                    AND rt.created_at<NOW()-INTERVAL '24 hours')
                OR ($3='PENDING_7D' AND rt.status='PENDING'
                    AND rt.created_at<NOW()-INTERVAL '7 days')
                OR ($3='EVIDENCE_MISMATCH' AND evidence.discrepancy_count>0)
                OR ($3='EVIDENCE_AWAITING_REVIEW' AND evidence.awaiting_review_count>0)
                OR ($3='EVIDENCE_NEEDS_PROVIDER' AND evidence.claim_count>0
                    AND evidence.awaiting_review_count=0
                    AND evidence.discrepancy_count=0)
                OR ($3='EVIDENCE_MISSING' AND evidence.claim_count=0
                    AND (rt.method IN ('MOMO','CARD','BANK')
                      OR (rt.method='ORIGINAL_METHOD'
                        AND original_payment.method IN ('MOMO','CARD','BANK'))))
              )
            ORDER BY rt.created_at ASC,rt.id ASC LIMIT $5`,
          [businessId,branchId,status,currency,MAX_EVIDENCE_EXPORT_ROWS+1],
        );
        if(result.rows.length>MAX_EVIDENCE_EXPORT_ROWS)throw new ExportError(
          "More than 5,000 unresolved refunds match this selection. Narrow by status or currency.",
          413,"REFUND_EXPORT_TOO_LARGE");
        const csv=renderRefundEvidenceInvestigationCsv(result.rows);
        request.log.info({
          event:"REFUND_EVIDENCE_CSV_EXPORTED",businessId,branchId,
          actorUserId:auth.userId,status,currencyCode:currency??"ALL",
          recordCount:result.rows.length,
        },"Finance member exported an unverified refund investigation report");
        const day=new Date().toISOString().slice(0,10);
        return reply.header("Content-Type","text/csv; charset=utf-8")
          .header("Content-Disposition",
            `attachment; filename="tradeos-refund-investigations-${day}.csv"`)
          .header("Content-Length",String(csv.length))
          .send(csv);
      } catch(error) {
        if(error instanceof ExportError || error instanceof AuthError)
          return reply.code(error.statusCode).send({
            error:error.code,message:error.message,
          });
        request.log.error(error);
        return reply.code(500).send({error:"REFUND_EXPORT_FAILED",
          message:"Could not create a safe refund investigation export."});
      }
    },
  );
}
