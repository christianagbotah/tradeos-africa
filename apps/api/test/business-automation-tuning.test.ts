import { describe, expect, it } from "vitest";
import type { BusinessAutomationEffectivenessPolicyRow } from "@tradeos/contracts";
import {
  businessAutomationTuningRecommendation,
  businessAutomationTuningRecommendations,
} from "../src/business-intelligence/automation-tuning.js";

function row(overrides: Partial<BusinessAutomationEffectivenessPolicyRow> = {}): BusinessAutomationEffectivenessPolicyRow {
  return {
    policyId: "91000000-0000-4000-8000-000000000001",
    name: "Inventory review",
    enabled: true,
    actionType: "CREATE_FOLLOW_UP",
    tasksCreated: 4,
    tasksCompleted: 4,
    tasksOpen: 0,
    tasksSnoozed: 0,
    relevantOutcomes: 4,
    negativeOutcomes: 0,
    completionRate: 1,
    relevantOutcomeRate: 1,
    medianCompletionHours: 2,
    lastTaskAt: "2026-10-25T10:00:00.000Z",
    ...overrides,
  };
}

describe("business automation tuning recommendations", () => {
  it("prioritizes repeated low-value outcomes over low completion for the same enabled policy", () => {
    const result = businessAutomationTuningRecommendation(row({
      tasksCreated: 6,
      tasksCompleted: 3,
      completionRate: 0.49,
      relevantOutcomes: 2,
      negativeOutcomes: 2,
      relevantOutcomeRate: 0.5,
    }));
    expect(result).toMatchObject({
      kind: "HIGH_NEGATIVE_OUTCOMES",
      priority: "HIGH",
      focus: "TRIGGER",
    });
  });

  it("recommends workflow review when enough generated tasks are completing below fifty percent", () => {
    expect(businessAutomationTuningRecommendation(row({
      tasksCreated: 5,
      tasksCompleted: 2,
      completionRate: 0.4,
      relevantOutcomes: 1,
      negativeOutcomes: 0,
    }))).toMatchObject({
      kind: "LOW_COMPLETION",
      priority: "MEDIUM",
      focus: "WORKFLOW",
    });
  });

  it("reports enabled zero-trigger policies neutrally but does not advise disabled, healthy, or learning policies", () => {
    expect(businessAutomationTuningRecommendation(row({ tasksCreated: 0, tasksCompleted: 0, completionRate: 0, lastTaskAt: null }))).toMatchObject({
      kind: "NO_TRIGGERED_WORK",
      priority: "INFO",
      focus: "TRIGGER",
    });
    expect(businessAutomationTuningRecommendation(row({ enabled: false, tasksCreated: 0, tasksCompleted: 0 }))).toBeNull();
    expect(businessAutomationTuningRecommendation(row())).toBeNull();
    expect(businessAutomationTuningRecommendation(row({ tasksCreated: 2, tasksCompleted: 1, completionRate: 0.5, negativeOutcomes: 1, relevantOutcomes: 0 }))).toBeNull();
  });

  it("sorts recommendations deterministically by priority then policy name/id and caps the response at ten", () => {
    const rows = Array.from({ length: 12 }, (_, index) => row({
      policyId: `91000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: index === 0 ? "Zeta" : `Policy ${String(index).padStart(2, "0")}`,
      tasksCreated: 0,
      tasksCompleted: 0,
      completionRate: 0,
      lastTaskAt: null,
    }));
    rows.push(row({
      policyId: "92000000-0000-4000-8000-000000000001",
      name: "Critical",
      tasksCreated: 3,
      tasksCompleted: 2,
      relevantOutcomes: 0,
      negativeOutcomes: 2,
      completionRate: 2 / 3,
    }));
    rows.push(row({
      policyId: "93000000-0000-4000-8000-000000000001",
      name: "Workflow",
      tasksCreated: 4,
      tasksCompleted: 1,
      relevantOutcomes: 1,
      negativeOutcomes: 0,
      completionRate: 0.25,
    }));

    const recommendations = businessAutomationTuningRecommendations(rows);
    expect(recommendations).toHaveLength(10);
    expect(recommendations[0]?.kind).toBe("HIGH_NEGATIVE_OUTCOMES");
    expect(recommendations[1]?.kind).toBe("LOW_COMPLETION");
    expect(recommendations.slice(2).every((item) => item.kind === "NO_TRIGGERED_WORK")).toBe(true);
    expect(recommendations.map((item) => item.policyId)).not.toContain(rows[0]?.policyId);
  });
});
