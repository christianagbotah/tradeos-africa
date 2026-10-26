import type {
  BusinessAutomationEffectivenessPolicyRow,
  BusinessAutomationTuningRecommendation,
} from "@tradeos/contracts";

const PRIORITY_RANK = { HIGH: 3, MEDIUM: 2, INFO: 1 } as const;

export function businessAutomationTuningRecommendation(
  row: BusinessAutomationEffectivenessPolicyRow,
): BusinessAutomationTuningRecommendation | null {
  if (!row.enabled) return null;

  if (row.tasksCompleted >= 2 && row.negativeOutcomes >= 2 && row.negativeOutcomes >= row.relevantOutcomes) {
    return {
      policyId: row.policyId,
      kind: "HIGH_NEGATIVE_OUTCOMES",
      priority: "HIGH",
      focus: "TRIGGER",
      title: `Review ${row.name} trigger quality`,
      summary: "Several completed review tasks were judged low-value. Review the trigger conditions or severity threshold before generating more work.",
      rationale: `${row.negativeOutcomes} low-value outcome${row.negativeOutcomes === 1 ? "" : "s"} versus ${row.relevantOutcomes} relevant outcome${row.relevantOutcomes === 1 ? "" : "s"} in the last 30 days.`,
    };
  }

  if (row.tasksCreated >= 3 && row.completionRate < 0.5) {
    return {
      policyId: row.policyId,
      kind: "LOW_COMPLETION",
      priority: "MEDIUM",
      focus: "WORKFLOW",
      title: `Review ${row.name} workflow fit`,
      summary: "Generated review tasks are not being completed reliably. Review assignment, due time, and whether this workflow fits the team that receives it.",
      rationale: `${row.tasksCompleted} of ${row.tasksCreated} generated tasks were completed in the last 30 days.`,
    };
  }

  if (row.tasksCreated === 0) {
    return {
      policyId: row.policyId,
      kind: "NO_TRIGGERED_WORK",
      priority: "INFO",
      focus: "TRIGGER",
      title: `Check ${row.name} conditions`,
      summary: "This enabled automation has not created review work in the last 30 days. There is not enough triggered work to judge usefulness yet.",
      rationale: "Check whether its trigger conditions still match current operations and available TradeOS data.",
    };
  }

  return null;
}

export function businessAutomationTuningRecommendations(
  rows: BusinessAutomationEffectivenessPolicyRow[],
): BusinessAutomationTuningRecommendation[] {
  const nameByPolicy = new Map(rows.map((row) => [row.policyId, row.name]));
  return rows
    .map(businessAutomationTuningRecommendation)
    .filter((item): item is BusinessAutomationTuningRecommendation => item !== null)
    .sort((left, right) =>
      PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority]
      || (nameByPolicy.get(left.policyId) ?? "").localeCompare(nameByPolicy.get(right.policyId) ?? "")
      || left.policyId.localeCompare(right.policyId),
    )
    .slice(0, 10);
}
