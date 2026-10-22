import type { BusinessAutomationPolicy, BusinessAutomationRun } from "@tradeos/contracts";
import { readApiErrorMessage } from "../../../lib/auth-fetch";

const AUTOMATION_MANAGEMENT_ROLES = new Set(["OWNER", "ADMIN", "MANAGER"]);
const MANAGER_AUTOMATION_ACTIONS = new Set(["CREATE_FOLLOW_UP", "CREATE_REORDER_REVIEW", "SNOOZE_ATTENTION"]);

type AuthenticatedFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function canManageBusinessAutomations(role: string | null | undefined): boolean {
  return typeof role === "string" && AUTOMATION_MANAGEMENT_ROLES.has(role);
}

export function canControlBusinessAutomationPolicy(
  role: string | null | undefined,
  policy: BusinessAutomationPolicy,
): boolean {
  if (role === "OWNER" || role === "ADMIN") return true;
  if (role === "MANAGER") return MANAGER_AUTOMATION_ACTIONS.has(policy.actionType);
  return false;
}

export function relevantBusinessAutomationPolicies(
  policies: readonly BusinessAutomationPolicy[],
  branchId: string,
): BusinessAutomationPolicy[] {
  return policies.filter((policy) => policy.branchId === null || policy.branchId === branchId);
}

export async function mutateBusinessAutomationPolicy(
  fetcher: AuthenticatedFetcher,
  input: {
    policy: BusinessAutomationPolicy;
    businessId: string;
    enabled: boolean;
  },
): Promise<BusinessAutomationPolicy> {
  const response = await fetcher(`/v1/intelligence/automations/${encodeURIComponent(input.policy.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      businessId: input.businessId,
      expectedPolicyVersion: input.policy.policyVersion,
      enabled: input.enabled,
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Automation policy could not be updated"));
  }
  const payload = await response.json() as { policy?: BusinessAutomationPolicy };
  if (!payload.policy) throw new Error("Server returned an incomplete automation policy response.");
  return payload.policy;
}

export async function runBusinessAutomationNow(
  fetcher: AuthenticatedFetcher,
  input: {
    policy: BusinessAutomationPolicy;
    businessId: string;
    branchId: string;
    correlationId: string;
  },
): Promise<BusinessAutomationRun> {
  const response = await fetcher("/v1/intelligence/automations/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      businessId: input.businessId,
      branchId: input.policy.branchId ?? input.branchId,
      policyId: input.policy.id,
      triggerSource: "MANUAL",
      triggerCorrelationId: input.correlationId,
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Automation could not be run"));
  }
  const payload = await response.json() as { run?: BusinessAutomationRun };
  if (!payload.run) throw new Error("Server returned an incomplete automation run response.");
  return payload.run;
}
