import type { BusinessAutomationEffectivenessPolicyRow } from "@tradeos/contracts";

export type AutomationEffectivenessPolicyState = "No triggered work yet" | "Learning" | "Needs review" | "Healthy";

export function automationEffectivenessPolicyState(row: BusinessAutomationEffectivenessPolicyRow): AutomationEffectivenessPolicyState {
  if (row.tasksCreated === 0) return "No triggered work yet";
  if (row.tasksCompleted < 2) return "Learning";
  if (row.negativeOutcomes >= 2 && row.negativeOutcomes >= row.relevantOutcomes) return "Needs review";
  return "Healthy";
}
