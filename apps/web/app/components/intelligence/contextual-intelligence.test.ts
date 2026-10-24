import { describe, expect, it } from "vitest";
import type { BusinessBriefing } from "@tradeos/contracts";
import {
  contextualIntelligenceDefinition,
  contextualWorkflowHref,
  selectContextualIntelligence,
} from "./contextual-intelligence";

const briefing: BusinessBriefing = {
  businessId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  range: "today",
  generatedAt: "2026-10-23T08:00:00.000Z",
  headline: "Three items need attention.",
  summary: "Evidence-backed operating summary.",
  confidence: { level: "MEDIUM", reason: "Recent operating data is available." },
  dataQuality: { completedSales30d: 18, sufficientForTrends: true, currencyCode: "GHS" },
  evidence: [],
  sections: [
    {
      code: "INVENTORY",
      title: "Inventory",
      summary: "Two inventory signals need review.",
      attentionItems: [
        {
          id: "inv-low",
          businessId: "11111111-1111-4111-8111-111111111111",
          branchId: "22222222-2222-4222-8222-222222222222",
          sourceKey: "inventory:low",
          ruleCode: "SLOW_STOCK",
          severity: "MEDIUM",
          state: "OPEN",
          title: "Slow stock",
          summary: "Review slow-moving stock.",
          evidence: [],
          firstSeenAt: "2026-10-23T07:00:00.000Z",
          lastSeenAt: "2026-10-23T08:00:00.000Z",
          resolvedAt: null,
        },
        {
          id: "inv-critical",
          businessId: "11111111-1111-4111-8111-111111111111",
          branchId: "22222222-2222-4222-8222-222222222222",
          sourceKey: "inventory:out",
          ruleCode: "STOCKOUT_RISK",
          severity: "CRITICAL",
          state: "OPEN",
          title: "Stockout risk",
          summary: "A fast-moving item is out of stock.",
          evidence: [],
          firstSeenAt: "2026-10-23T07:00:00.000Z",
          lastSeenAt: "2026-10-23T08:00:00.000Z",
          resolvedAt: null,
        },
      ],
      recommendations: [
        {
          businessId: "11111111-1111-4111-8111-111111111111",
          branchId: "22222222-2222-4222-8222-222222222222",
          code: "REORDER",
          title: "Review reorder",
          summary: "Review stock before creating a purchase.",
          rationale: "Stockout evidence exists.",
          priority: "HIGH",
          evidence: [],
          suggestedActionType: "CREATE_REORDER_REVIEW",
          suggestedActionLabel: "Open purchases",
        },
      ],
    },
    {
      code: "CUSTOMERS_CREDIT",
      title: "Customer credit",
      summary: "One overdue balance.",
      attentionItems: [],
      recommendations: [
        {
          businessId: "11111111-1111-4111-8111-111111111111",
          branchId: "22222222-2222-4222-8222-222222222222",
          code: "COLLECT",
          title: "Follow up overdue balance",
          summary: "Contact the customer.",
          rationale: "An overdue receivable exists.",
          priority: "HIGH",
          evidence: [],
          suggestedActionType: "CREATE_RECEIVABLE_FOLLOW_UP",
          suggestedActionLabel: "Open customers",
        },
      ],
    },
    {
      code: "SUPPLIERS_PAYABLES",
      title: "Supplier payables",
      summary: "One supplier bill is due.",
      attentionItems: [],
      recommendations: [],
    },
    {
      code: "SALES",
      title: "Sales",
      summary: "Sales are stable.",
      attentionItems: [],
      recommendations: [],
    },
    {
      code: "CASH",
      title: "Cash position",
      summary: "Cash is positive.",
      attentionItems: [],
      recommendations: [],
    },
    {
      code: "OPPORTUNITIES",
      title: "Opportunities",
      summary: "Data quality is sufficient for stronger insights.",
      attentionItems: [],
      recommendations: [],
    },
  ],
};

describe("contextual tenant intelligence selector", () => {
  it("maps every supported workflow to the intended briefing sections and prompt", () => {
    expect(contextualIntelligenceDefinition("inventory").sectionCodes).toEqual(["INVENTORY"]);
    expect(contextualIntelligenceDefinition("customers").sectionCodes).toEqual(["CUSTOMERS_CREDIT"]);
    expect(contextualIntelligenceDefinition("purchases").sectionCodes).toEqual(["SUPPLIERS_PAYABLES", "INVENTORY"]);
    expect(contextualIntelligenceDefinition("reports").sectionCodes).toEqual(["SALES", "CASH", "CUSTOMERS_CREDIT", "SUPPLIERS_PAYABLES", "INVENTORY"]);
    expect(contextualIntelligenceDefinition("settings").sectionCodes).toEqual(["OPPORTUNITIES"]);
    expect(contextualIntelligenceDefinition("inventory").askPrompt).toMatch(/stock/i);
    expect(contextualIntelligenceDefinition("settings").askPrompt).toMatch(/intelligence quality|automation readiness/i);
  });

  it("selects only relevant sections and orders attention by severity", () => {
    const view = selectContextualIntelligence(briefing, "inventory");
    expect(view.sections.map((section) => section.code)).toEqual(["INVENTORY"]);
    expect(view.attentionItems.map((item) => item.id)).toEqual(["inv-critical", "inv-low"]);
    expect(view.recommendations.map((item) => item.code)).toEqual(["REORDER"]);
  });

  it("combines purchases signals without duplicating attention or recommendations", () => {
    const duplicated: BusinessBriefing = {
      ...briefing,
      sections: briefing.sections.map((section) => section.code === "SUPPLIERS_PAYABLES"
        ? {
            ...section,
            attentionItems: briefing.sections.find((candidate) => candidate.code === "INVENTORY")!.attentionItems.slice(0, 1),
            recommendations: briefing.sections.find((candidate) => candidate.code === "INVENTORY")!.recommendations,
          }
        : section),
    };
    const view = selectContextualIntelligence(duplicated, "purchases");
    expect(view.sections.map((section) => section.code)).toEqual(["SUPPLIERS_PAYABLES", "INVENTORY"]);
    expect(view.attentionItems.filter((item) => item.id === "inv-low")).toHaveLength(1);
    expect(view.recommendations.filter((item) => item.code === "REORDER")).toHaveLength(1);
  });

  it("exposes settings readiness from briefing confidence and data quality", () => {
    const view = selectContextualIntelligence(briefing, "settings");
    expect(view.confidence).toEqual(briefing.confidence);
    expect(view.dataQuality).toEqual(briefing.dataQuality);
    expect(view.summary).toContain("Data quality is sufficient");
  });

  it("maps recommendation action types only to existing human-controlled workflows", () => {
    expect(contextualWorkflowHref("CREATE_REORDER_REVIEW")).toBe("/purchases");
    expect(contextualWorkflowHref("CREATE_RECEIVABLE_FOLLOW_UP")).toBe("/customers");
    expect(contextualWorkflowHref("CREATE_CASH_REVIEW")).toBe("/cashbook");
    expect(contextualWorkflowHref("CREATE_PERFORMANCE_REVIEW")).toBe("/reports");
    expect(contextualWorkflowHref("CREATE_INVENTORY_REVIEW")).toBe("/inventory");
    expect(contextualWorkflowHref("CREATE_FOLLOW_UP")).toBe("/reports");
  });
});
