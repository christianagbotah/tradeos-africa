import { describe, expect, it } from "vitest";
import type { BusinessAutomationPolicy } from "@tradeos/contracts";
import {
  canControlBusinessAutomationPolicy,
  canManageBusinessAutomations,
  guidedAutomationTemplates,
  mutateBusinessAutomationPolicy,
  relevantBusinessAutomationPolicies,
  runBusinessAutomationNow,
} from "./business-automations";

function policy(overrides: Partial<BusinessAutomationPolicy> = {}): BusinessAutomationPolicy {
  return {
    id: "policy-1",
    businessId: "business-1",
    branchId: null,
    code: "stock.review",
    name: "Review low stock",
    description: "Create an internal task when stock needs review.",
    enabled: true,
    triggerType: "ATTENTION",
    conditions: {},
    actionType: "REVIEW_STOCK",
    actionConfiguration: {},
    policyVersion: 3,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-10-22T10:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("business automation controls", () => {
  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["MANAGER", true],
    ["ACCOUNTANT", false],
    ["CASHIER", false],
    ["STAFF", false],
  ])("allows only configuration roles to manage automations: %s", (role, expected) => {
    expect(canManageBusinessAutomations(role)).toBe(expected);
  });

  it("keeps manager controls limited to operational automation actions", () => {
    expect(canControlBusinessAutomationPolicy("OWNER", policy({ actionType: "CREATE_CASH_REVIEW" }))).toBe(true);
    expect(canControlBusinessAutomationPolicy("ADMIN", policy({ actionType: "CREATE_RECEIVABLE_FOLLOW_UP" }))).toBe(true);
    expect(canControlBusinessAutomationPolicy("MANAGER", policy({ actionType: "CREATE_FOLLOW_UP" }))).toBe(true);
    expect(canControlBusinessAutomationPolicy("MANAGER", policy({ actionType: "CREATE_REORDER_REVIEW" }))).toBe(true);
    expect(canControlBusinessAutomationPolicy("MANAGER", policy({ actionType: "SNOOZE_ATTENTION" }))).toBe(true);
    expect(canControlBusinessAutomationPolicy("MANAGER", policy({ actionType: "CREATE_CASH_REVIEW" }))).toBe(false);
    expect(canControlBusinessAutomationPolicy("MANAGER", policy({ actionType: "CREATE_RECEIVABLE_FOLLOW_UP" }))).toBe(false);
  });

  it("describes attention templates as automatic while keeping cash review non-economic", () => {
    const templates = guidedAutomationTemplates("OWNER");
    const attentionTemplates = templates.filter((template) => template.triggerType === "ATTENTION");
    expect(attentionTemplates.length).toBeGreaterThan(0);
    for (const template of attentionTemplates) {
      expect(`${template.description} ${template.preview}`).toMatch(/automatic/i);
    }
    const cashReview = templates.find((template) => template.id === "cash-review");
    expect(cashReview?.triggerType).toBe("ATTENTION");
    expect(cashReview?.defaultRuleCode).toBe("CASH_PRESSURE_FORECAST");
    expect(cashReview?.ruleOptions).toEqual([{ value: "CASH_PRESSURE_FORECAST", label: "Projected negative cash" }]);
    expect(`${cashReview?.description} ${cashReview?.preview}`).toMatch(/no cash is moved|does not transfer/i);
  });

  it("shows business-wide and current-branch policies while hiding other branches", () => {
    const policies = [
      policy({ id: "global", branchId: null }),
      policy({ id: "current", branchId: "branch-1" }),
      policy({ id: "other", branchId: "branch-2" }),
    ];

    expect(relevantBusinessAutomationPolicies(policies, "branch-1").map((item) => item.id)).toEqual(["global", "current"]);
  });

  it("toggles a policy using business scope and optimistic policy version", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ policy: policy({ enabled: false, policyVersion: 4 }) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const updated = await mutateBusinessAutomationPolicy(fetcher, {
      policy: policy(),
      businessId: "business-1",
      enabled: false,
    });

    expect(String(calls[0]?.input)).toBe("/v1/intelligence/automations/policy-1");
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      businessId: "business-1",
      expectedPolicyVersion: 3,
      enabled: false,
    });
    expect(updated.policyVersion).toBe(4);
    expect(updated.enabled).toBe(false);
  });

  it("runs an enabled policy now with an explicit branch and unique correlation id", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({
        run: {
          id: "run-1",
          policyId: "policy-1",
          policyVersion: 3,
          businessId: "business-1",
          branchId: "branch-1",
          triggerSource: "MANUAL",
          triggerCorrelationId: "manual-test-1",
          state: "SUCCEEDED",
          structuredInput: {},
          outputSummary: { actionItemId: "action-1" },
          evidence: [],
          errorMessage: null,
          startedAt: "2026-10-22T10:00:00.000Z",
          completedAt: "2026-10-22T10:00:01.000Z",
          createdAt: "2026-10-22T10:00:00.000Z",
          updatedAt: "2026-10-22T10:00:01.000Z",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const run = await runBusinessAutomationNow(fetcher, {
      policy: policy(),
      businessId: "business-1",
      branchId: "branch-1",
      correlationId: "manual-test-1",
    });

    expect(String(calls[0]?.input)).toBe("/v1/intelligence/automations/evaluate");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      businessId: "business-1",
      branchId: "branch-1",
      policyId: "policy-1",
      triggerSource: "MANUAL",
      triggerCorrelationId: "manual-test-1",
    });
    expect(run.state).toBe("SUCCEEDED");
  });

  it("surfaces API errors for policy changes and manual runs", async () => {
    const fetcher = async () => new Response(JSON.stringify({ message: "Automation policy changed; refresh and try again" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });

    await expect(mutateBusinessAutomationPolicy(fetcher, {
      policy: policy(),
      businessId: "business-1",
      enabled: false,
    })).rejects.toThrow("Automation policy changed; refresh and try again");

    await expect(runBusinessAutomationNow(fetcher, {
      policy: policy(),
      businessId: "business-1",
      branchId: "branch-1",
      correlationId: "manual-test-2",
    })).rejects.toThrow("Automation policy changed; refresh and try again");
  });
});
