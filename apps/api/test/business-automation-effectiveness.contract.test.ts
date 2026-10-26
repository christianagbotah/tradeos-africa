import { describe, expect, it } from "vitest";
import type { BusinessAutomationEffectiveness } from "@tradeos/contracts";

describe("business automation effectiveness contract", () => {
  it("pins the fixed 30-day aggregate and policy row shape", () => {
    const value = {
      businessId: "00000000-0000-4000-8000-000000000001",
      branchId: "00000000-0000-4000-8000-000000000002",
      generatedAt: "2026-10-25T16:00:00.000Z",
      windowDays: 30,
      summary: {
        automatedTasksCreated: 8,
        automatedTasksCompleted: 6,
        automatedTasksOpen: 1,
        automatedTasksSnoozed: 1,
        completionRate: 0.75,
        relevantOutcomeRate: 2 / 3,
        negativeOutcomeCount: 2,
        medianCompletionHours: 5.5,
        manualEntityReviewsCreated: 3,
      },
      outcomes: {
        resolved: 3,
        alreadyHandled: 1,
        notRelevant: 1,
        noActionNeeded: 1,
      },
      tuningRecommendations: [{
        policyId: "00000000-0000-4000-8000-000000000003",
        kind: "HIGH_NEGATIVE_OUTCOMES",
        priority: "HIGH",
        focus: "TRIGGER",
        title: "Review Inventory health review trigger quality",
        summary: "Review the trigger conditions.",
        rationale: "2 low-value outcomes versus 1 relevant outcome in the last 30 days.",
      }],
      policies: [{
        policyId: "00000000-0000-4000-8000-000000000003",
        name: "Inventory health review",
        enabled: true,
        actionType: "CREATE_INVENTORY_REVIEW",
        tasksCreated: 4,
        tasksCompleted: 3,
        tasksOpen: 1,
        tasksSnoozed: 0,
        relevantOutcomes: 2,
        negativeOutcomes: 1,
        completionRate: 0.75,
        relevantOutcomeRate: 2 / 3,
        medianCompletionHours: 4.25,
        lastTaskAt: "2026-10-25T12:00:00.000Z",
      }],
    } satisfies BusinessAutomationEffectiveness;

    expect(value.windowDays).toBe(30);
    expect(value.policies[0]?.policyId).toBeTruthy();
    expect(value.tuningRecommendations[0]?.kind).toBe("HIGH_NEGATIVE_OUTCOMES");
  });
});
