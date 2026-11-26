import type { BusinessQuestionResponse } from "@tradeos/contracts";

/** Match API's protected role set for merchant financial questions. */
const ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

export function canAskMobileBusinessQuestions(role: string): boolean {
  return ROLES.has(role);
}

/** Never render a response from another branch after context or user changes. */
export function questionResponseMatchesContext(
  response: BusinessQuestionResponse,
  businessId: string,
  branchId: string,
): boolean {
  return response.businessId === businessId && response.branchId === branchId;
}
