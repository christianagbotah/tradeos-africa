import { describe, expect, it } from "vitest";
import {
  refundEvidenceCsvCell,
  evidenceAttentionState,
  renderRefundEvidenceInvestigationCsv,
  MAX_EVIDENCE_EXPORT_ROWS,
} from "../src/refund-evidence-export.js";

const sample = {
  refund_id: "33333333-3333-4333-8333-333333333333",
  sale_id: "22222222-2222-4222-8222-222222222222",
  created_at: new Date("2026-11-21T00:00:00Z"),
  status: "PENDING" as const,
  method: "MOMO",
  amount_minor: "1500",
  currency_code: "GHS",
  customer_name: "=HYPERLINK(\"https://example.test\",\"click\")",
  reason: "item return",
  claim_count: "2",
  awaiting_review_count: "1",
  discrepancy_count: "1",
  is_electronic: true,
  latest_provider_code: "HUBTEL",
  latest_provider_ref: "HB-REF-001",
  latest_claim_status: "CLAIMED_SUCCESS",
  latest_review_decision: null,
};

describe("refund investigation finance CSV output", () => {
  it("quotes CSV and neutralizes spreadsheet formulas, control characters and CSV escapes", () => {
    expect(refundEvidenceCsvCell("=1+2")).toBe("\"'=1+2\"");
    expect(refundEvidenceCsvCell(" -SUM(A1)")).toBe("\"'-SUM(A1)\"");
    expect(refundEvidenceCsvCell("@cmd")).toBe("\"'@cmd\"");
    expect(refundEvidenceCsvCell("+cmd")).toBe("\"'+cmd\"");
    expect(refundEvidenceCsvCell("hello,\"world\"")).toBe("\"hello,\"\"world\"\"\"");
    expect(refundEvidenceCsvCell("\t=1\r\nmore")).toBe("\"'=1  more\"");
    expect(refundEvidenceCsvCell(null)).toBe("\"\"");
    expect(refundEvidenceCsvCell("₵25.50")).toBe("\"₵25.50\"");
  });
  it("preserves exact refund amounts, masked verification status and UTF-8", () => {
    const csv = renderRefundEvidenceInvestigationCsv([sample]).toString("utf8");
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"Expected amount (minor units)"');
    expect(csv).toContain('"1500"');
    expect(csv).toContain("\"'=");
    expect(csv).toContain('"MERCHANT_SUPPLIED_UNVERIFIED","NOT_ESTABLISHED","FALSE"');
    const none=renderRefundEvidenceInvestigationCsv([{
      ...sample,claim_count:"0",awaiting_review_count:"0",
      discrepancy_count:"0",latest_provider_code:null,latest_provider_ref:null,
      latest_claim_status:null,
    }]).toString("utf8");
    expect(none).toContain('"NO_EVIDENCE","NOT_ESTABLISHED","FALSE"');
    expect(csv).toContain('"DISCREPANCY"');
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).not.toContain("recipient_last4");
    expect(csv).not.toContain("apiKey");
  });
  it("classifies priority without pretending a human review proves payout", () => {
    expect(evidenceAttentionState({claimCount:0,awaitingReviewCount:0,
      discrepancyCount:0,isElectronic:true})).toBe("NO_EVIDENCE_SUBMITTED");
    expect(evidenceAttentionState({claimCount:0,awaitingReviewCount:0,
      discrepancyCount:0,isElectronic:false})).toBe("NOT_ELECTRONIC");
    expect(evidenceAttentionState({claimCount:1,awaitingReviewCount:1,
      discrepancyCount:0,isElectronic:true})).toBe("AWAITING_REVIEW");
    expect(evidenceAttentionState({claimCount:1,awaitingReviewCount:0,
      discrepancyCount:0,isElectronic:true})).toBe("PROVIDER_PROOF_REQUIRED");
    expect(evidenceAttentionState({claimCount:1,awaitingReviewCount:1,
      discrepancyCount:1,isElectronic:true})).toBe("DISCREPANCY");
  });
  it("fails closed for unsafe monetary precision and malformed statuses", () => {
    expect(() => renderRefundEvidenceInvestigationCsv([
      {...sample,amount_minor:"9007199254740993"},
    ])).toThrow(/safe minor-unit precision/);
    expect(() => renderRefundEvidenceInvestigationCsv([
      {...sample,claim_count:"1",awaiting_review_count:"2"},
    ])).toThrow(/could not be validated/);
    expect(() => renderRefundEvidenceInvestigationCsv([
      {...sample,currency_code:"AAA!" },
    ])).toThrow(/could not be validated/);
  });
  it("refuses silent truncation when export exceeds 5,000 rows", () => {
    expect(MAX_EVIDENCE_EXPORT_ROWS).toBe(5000);
    expect(() => renderRefundEvidenceInvestigationCsv(
      Array.from({length:MAX_EVIDENCE_EXPORT_ROWS+1}, () => sample)
    )).toThrow(/Too many unresolved refunds/);
  });
});
