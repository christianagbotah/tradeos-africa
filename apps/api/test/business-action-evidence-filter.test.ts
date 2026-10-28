import { describe, expect, it } from "vitest";
import type { BusinessEvidenceReference } from "@tradeos/contracts";
import { filterBusinessActionEvidenceForRole } from "../src/business-intelligence/automation-service.js";

const EVIDENCE: BusinessEvidenceReference[] = [
  { source: "supplier_credit_obligations", entityType: "PERIOD", label: "openPayableMinor", value: "12500", metadata: { kind: "money_minor", currencyCode: "GHS" } },
  { source: "supplier_credit_obligations", entityType: "PERIOD", label: "overdueCount", value: 2 },
];

describe("business action evidence role filtering", () => {
  it("removes evidence from financial action types after a user loses a financial role", () => {
    expect(filterBusinessActionEvidenceForRole("INVENTORY", {
      actionType: "CREATE_PAYABLES_REVIEW",
      sourceEntityType: null,
      sourceAttentionRuleCode: "PAYABLES_OVERDUE",
      evidence: EVIDENCE,
    })).toEqual([]);
  });

  it("also removes evidence from legacy generic follow-ups backed by a financial attention signal", () => {
    expect(filterBusinessActionEvidenceForRole("STAFF", {
      actionType: "CREATE_FOLLOW_UP",
      sourceEntityType: null,
      sourceAttentionRuleCode: "RECEIVABLES_OVERDUE",
      evidence: EVIDENCE,
    })).toEqual([]);
  });

  it("preserves evidence for financial roles and non-financial operational tasks", () => {
    expect(filterBusinessActionEvidenceForRole("ACCOUNTANT", {
      actionType: "CREATE_PAYABLES_REVIEW",
      sourceEntityType: null,
      sourceAttentionRuleCode: "PAYABLES_OVERDUE",
      evidence: EVIDENCE,
    })).toEqual(EVIDENCE);
    expect(filterBusinessActionEvidenceForRole("INVENTORY", {
      actionType: "CREATE_INVENTORY_REVIEW",
      sourceEntityType: null,
      sourceAttentionRuleCode: "STOCKOUT_RISK",
      evidence: EVIDENCE,
    })).toEqual(EVIDENCE);
  });
});
