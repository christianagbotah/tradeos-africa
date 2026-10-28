import { describe, expect, it } from "vitest";
import type { BusinessAutomationEffectivenessPolicyRow } from "@tradeos/contracts";
import { automationEffectivenessPolicyState } from "./business-automation-effectiveness";

function policy(overrides: Partial<BusinessAutomationEffectivenessPolicyRow> = {}): BusinessAutomationEffectivenessPolicyRow {
  return {
    policyId: "00000000-0000-4000-8000-000000000001",
    name: "Policy",
    enabled: true,
    triggerType: "ATTENTION",
    actionType: "CREATE_FOLLOW_UP",
    tasksCreated: 4,
    tasksCompleted: 4,
    tasksOpen: 0,
    tasksSnoozed: 0,
    relevantOutcomes: 3,
    negativeOutcomes: 1,
    completionRate: 1,
    relevantOutcomeRate: 0.75,
    medianCompletionHours: 2,
    lastTaskAt: "2026-10-25T12:00:00.000Z",
    ...overrides,
  };
}

describe("automation effectiveness policy state", () => {
  it("labels policies transparently from raw counts", () => {
    expect(automationEffectivenessPolicyState(policy({ tasksCreated: 0, tasksCompleted: 0 }))).toBe("No triggered work yet");
    expect(automationEffectivenessPolicyState(policy({ tasksCompleted: 1 }))).toBe("Learning");
    expect(automationEffectivenessPolicyState(policy({ tasksCompleted: 4, relevantOutcomes: 2, negativeOutcomes: 2 }))).toBe("Needs review");
    expect(automationEffectivenessPolicyState(policy({ tasksCompleted: 4, relevantOutcomes: 3, negativeOutcomes: 1 }))).toBe("Healthy");
  });
});
