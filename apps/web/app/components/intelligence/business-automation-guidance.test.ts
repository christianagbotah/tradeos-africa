import { describe, expect, it } from "vitest";
import * as automations from "./business-automations";

const guidance = automations as unknown as Record<string, unknown>;

describe("guided business automation setup", () => {
  it("exposes a role-safe template catalog without economic-write actions", () => {
    const templatesForRole = guidance.guidedAutomationTemplates;
    expect(typeof templatesForRole).toBe("function");
    if (typeof templatesForRole !== "function") return;

    const ownerTemplates = templatesForRole("OWNER") as Array<{ id: string; actionType: string; triggerType: string }>;
    const managerTemplates = templatesForRole("MANAGER") as Array<{ id: string; actionType: string; triggerType: string }>;

    expect(ownerTemplates.map((item) => item.id)).toEqual([
      "reorder-review",
      "receivables-follow-up",
      "cash-review",
      "sales-performance-review",
      "margin-performance-review",
      "general-follow-up",
    ]);
    expect(managerTemplates.map((item) => item.id)).toEqual([
      "reorder-review",
      "sales-performance-review",
      "margin-performance-review",
      "general-follow-up",
    ]);
    expect(ownerTemplates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "reorder-review", actionType: "CREATE_REORDER_REVIEW", triggerType: "ATTENTION" }),
      expect.objectContaining({ id: "receivables-follow-up", actionType: "CREATE_RECEIVABLE_FOLLOW_UP", triggerType: "ATTENTION" }),
      expect.objectContaining({ id: "cash-review", actionType: "CREATE_CASH_REVIEW", triggerType: "ATTENTION" }),
      expect.objectContaining({ id: "sales-performance-review", actionType: "CREATE_PERFORMANCE_REVIEW", triggerType: "ATTENTION" }),
      expect.objectContaining({ id: "margin-performance-review", actionType: "CREATE_PERFORMANCE_REVIEW", triggerType: "ATTENTION" }),
      expect.objectContaining({ id: "general-follow-up", actionType: "CREATE_FOLLOW_UP", triggerType: "ATTENTION" }),
    ]));
    expect(ownerTemplates.some((item) => ["POST_PAYMENT", "REFUND", "STOCK_WRITE_OFF", "CHANGE_ROLE", "CREATE_PURCHASE", "CREATE_SALE"].includes(item.actionType))).toBe(false);
  });
});

it("builds safe create payloads from guided form choices", () => {
  const buildPayload = guidance.buildGuidedAutomationPayload;
  expect(typeof buildPayload).toBe("function");
  if (typeof buildPayload !== "function") return;

  expect(buildPayload({
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "reorder-review",
    name: "Urgent stock review",
    scope: "CURRENT_BRANCH",
    signalRuleCode: "STOCKOUT_RISK",
    severityThreshold: "HIGH_PLUS",
    assignToActor: true,
    dueInHours: 24,
    enabled: true,
    code: "guided-reorder-review-abc",
  })).toEqual({
    businessId: "business-1",
    branchId: "branch-1",
    code: "guided-reorder-review-abc",
    name: "Urgent stock review",
    description: "Automatically creates an internal reorder review when stockout risk needs attention.",
    enabled: true,
    triggerType: "ATTENTION",
    conditions: { ruleCodes: ["STOCKOUT_RISK"], severities: ["HIGH", "CRITICAL"] },
    actionType: "CREATE_REORDER_REVIEW",
    actionConfiguration: { dueInHours: 24, assignToActor: true },
  });

  expect(buildPayload({
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "cash-review",
    name: "Projected cash review",
    scope: "BUSINESS_WIDE",
    signalRuleCode: "CASH_PRESSURE_FORECAST",
    severityThreshold: "HIGH_PLUS",
    assignToActor: false,
    dueInHours: 48,
    enabled: false,
    code: "guided-cash-review-abc",
  })).toEqual({
    businessId: "business-1",
    branchId: null,
    code: "guided-cash-review-abc",
    name: "Projected cash review",
    description: "Automatically creates an internal cash-position review when the 30-day forecast projects negative cash. No cash is moved automatically.",
    enabled: false,
    triggerType: "ATTENTION",
    conditions: { ruleCodes: ["CASH_PRESSURE_FORECAST"], severities: ["HIGH", "CRITICAL"] },
    actionType: "CREATE_CASH_REVIEW",
    actionConfiguration: { dueInHours: 48, assignToActor: false },
  });
});

it("reconstructs an editable guided draft from an existing safe policy", () => {
  const fromPolicy = guidance.guidedAutomationDraftFromPolicy;
  expect(typeof fromPolicy).toBe("function");
  if (typeof fromPolicy !== "function") return;

  const existing = {
    id: "policy-9",
    businessId: "business-1",
    branchId: null,
    code: "guided-receivables-9",
    name: "Chase overdue credit",
    description: "Existing description",
    enabled: true,
    triggerType: "ATTENTION",
    conditions: { ruleCodes: ["RECEIVABLES_OVERDUE"], severities: ["HIGH", "CRITICAL"] },
    actionType: "CREATE_RECEIVABLE_FOLLOW_UP",
    actionConfiguration: { dueInHours: 72, assignToActor: false },
    policyVersion: 4,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-10-22T10:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
  };

  expect(fromPolicy(existing, "branch-1")).toEqual({
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "receivables-follow-up",
    name: "Chase overdue credit",
    scope: "BUSINESS_WIDE",
    signalRuleCode: "RECEIVABLES_OVERDUE",
    severityThreshold: "HIGH_PLUS",
    assignToActor: false,
    dueInHours: 72,
    enabled: true,
    code: "guided-receivables-9",
  });

  expect(fromPolicy({
    ...existing,
    id: "policy-margin-1",
    code: "guided-margin-performance-1",
    name: "Margin performance review",
    branchId: "branch-1",
    conditions: { ruleCodes: ["MARGIN_PRESSURE"], severities: ["MEDIUM", "HIGH", "CRITICAL"] },
    actionType: "CREATE_PERFORMANCE_REVIEW",
    actionConfiguration: { dueInHours: 24, assignToActor: true },
  }, "branch-1")).toEqual(expect.objectContaining({
    templateId: "margin-performance-review",
    signalRuleCode: "MARGIN_PRESSURE",
    severityThreshold: "MEDIUM_PLUS",
    dueInHours: 24,
  }));
});

it("creates and edits guided policies through the safe automation endpoints", async () => {
  const savePolicy = guidance.saveGuidedBusinessAutomationPolicy;
  expect(typeof savePolicy).toBe("function");
  if (typeof savePolicy !== "function") return;

  const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({
      policy: {
        id: "policy-created",
        businessId: "business-1",
        branchId: "branch-1",
        code: "guided-reorder-review-abc",
        name: "Urgent stock review",
        description: "Automatically creates an internal reorder review when stockout risk needs attention.",
        enabled: true,
        triggerType: "ATTENTION",
        conditions: { ruleCodes: ["STOCKOUT_RISK"], severities: ["HIGH", "CRITICAL"] },
        actionType: "CREATE_REORDER_REVIEW",
        actionConfiguration: { dueInHours: 24, assignToActor: true },
        policyVersion: 1,
        createdByUserId: "user-1",
        updatedByUserId: "user-1",
        createdAt: "2026-10-22T10:00:00.000Z",
        updatedAt: "2026-10-22T10:00:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const draft = {
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "reorder-review",
    name: "Urgent stock review",
    scope: "CURRENT_BRANCH",
    signalRuleCode: "STOCKOUT_RISK",
    severityThreshold: "HIGH_PLUS",
    assignToActor: true,
    dueInHours: 24,
    enabled: true,
    code: "guided-reorder-review-abc",
  };

  await savePolicy(fetcher, { draft });
  expect(String(calls[0]?.input)).toBe("/v1/intelligence/automations");
  expect(calls[0]?.init?.method).toBe("POST");
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(expect.objectContaining({
    businessId: "business-1",
    branchId: "branch-1",
    code: "guided-reorder-review-abc",
    actionType: "CREATE_REORDER_REVIEW",
  }));

  calls.length = 0;
  await savePolicy(fetcher, {
    draft,
    existingPolicy: { policyVersion: 7, id: "policy-existing" },
  });
  expect(String(calls[0]?.input)).toBe("/v1/intelligence/automations/policy-existing");
  expect(calls[0]?.init?.method).toBe("PATCH");
  const updateBody = JSON.parse(String(calls[0]?.init?.body));
  expect(updateBody.expectedPolicyVersion).toBe(7);
  expect(updateBody.code).toBeUndefined();
});

it("publishes guided labels, previews and only approved signal choices", () => {
  const templatesForRole = guidance.guidedAutomationTemplates as ((role: string) => Array<Record<string, unknown>>) | undefined;
  expect(typeof templatesForRole).toBe("function");
  if (!templatesForRole) return;

  const templates = templatesForRole("OWNER");
  expect(templates).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "reorder-review",
      label: "Stock reorder review",
      preview: expect.stringMatching(/checks .* automatically.*internal reorder review/i),
      ruleOptions: [{ value: "STOCKOUT_RISK", label: "Stockout risk" }],
    }),
    expect.objectContaining({
      id: "cash-review",
      label: "Cash position review",
      ruleOptions: [{ value: "CASH_PRESSURE_FORECAST", label: "Projected negative cash" }],
      preview: expect.stringMatching(/projects negative cash.*internal cash-position review/i),
    }),
    expect.objectContaining({
      id: "sales-performance-review",
      label: "Sales performance review",
      actionType: "CREATE_PERFORMANCE_REVIEW",
      defaultRuleCode: "SALES_DROP",
      ruleOptions: [{ value: "SALES_DROP", label: "Sales drop" }],
      preview: expect.stringMatching(/sales decline.*internal performance review/i),
    }),
    expect.objectContaining({
      id: "margin-performance-review",
      label: "Margin performance review",
      actionType: "CREATE_PERFORMANCE_REVIEW",
      defaultRuleCode: "MARGIN_PRESSURE",
      ruleOptions: [{ value: "MARGIN_PRESSURE", label: "Margin pressure" }],
      preview: expect.stringMatching(/margin pressure.*internal performance review/i),
    }),
  ]));

  const general = templates.find((item) => item.id === "general-follow-up");
  expect(general?.ruleOptions).toEqual([
    { value: "SLOW_STOCK", label: "Slow-moving stock" },
    { value: "WASTAGE_SPIKE", label: "Wastage spike" },
    { value: "PAYABLES_OVERDUE", label: "Overdue supplier balances" },
    { value: "LOW_DATA_CONFIDENCE", label: "Low data confidence" },
  ]);
});

it("rejects invalid guided combinations before they reach the API", () => {
  const buildPayload = guidance.buildGuidedAutomationPayload as ((input: Record<string, unknown>) => unknown) | undefined;
  expect(typeof buildPayload).toBe("function");
  if (!buildPayload) return;

  const base = {
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "reorder-review",
    name: "Stock review",
    scope: "CURRENT_BRANCH",
    signalRuleCode: "STOCKOUT_RISK",
    severityThreshold: "HIGH_PLUS",
    assignToActor: true,
    dueInHours: 24,
    enabled: true,
    code: "guided-stock-1",
  };

  expect(() => buildPayload({ ...base, signalRuleCode: "SALES_DROP" })).toThrow("Signal is not available for this guided automation template");
  expect(() => buildPayload({ ...base, dueInHours: 0 })).toThrow("Due time must be between 1 and 8760 hours");
  expect(() => buildPayload({ ...base, name: "   " })).toThrow("Automation name is required");
});

it("creates a sensible default guided draft for a selected template", () => {
  const createDraft = guidance.createGuidedAutomationDraft;
  expect(typeof createDraft).toBe("function");
  if (typeof createDraft !== "function") return;

  expect(createDraft({
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "cash-review",
    code: "guided-cash-1",
  })).toEqual({
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "cash-review",
    name: "Cash position review",
    scope: "CURRENT_BRANCH",
    signalRuleCode: "CASH_PRESSURE_FORECAST",
    severityThreshold: "HIGH_PLUS",
    assignToActor: true,
    dueInHours: 24,
    enabled: true,
    code: "guided-cash-1",
  });

  expect(createDraft({
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "sales-performance-review",
    code: "guided-sales-performance-1",
  })).toEqual({
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "sales-performance-review",
    name: "Sales performance review",
    scope: "CURRENT_BRANCH",
    signalRuleCode: "SALES_DROP",
    severityThreshold: "MEDIUM_PLUS",
    assignToActor: true,
    dueInHours: 24,
    enabled: true,
    code: "guided-sales-performance-1",
  });

  expect(createDraft({
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "general-follow-up",
    code: "guided-general-1",
  })).toEqual({
    businessId: "business-1",
    currentBranchId: "branch-1",
    templateId: "general-follow-up",
    name: "General follow-up",
    scope: "CURRENT_BRANCH",
    signalRuleCode: "SLOW_STOCK",
    severityThreshold: "ANY",
    assignToActor: true,
    dueInHours: 24,
    enabled: true,
    code: "guided-general-1",
  });
});

it("keeps custom or mismatched legacy policies out of the guided editor", () => {
  const fromPolicy = guidance.guidedAutomationDraftFromPolicy as ((policy: Record<string, unknown>, branchId: string) => unknown) | undefined;
  expect(typeof fromPolicy).toBe("function");
  if (!fromPolicy) return;

  const legacy = {
    id: "policy-legacy",
    businessId: "business-1",
    branchId: "branch-1",
    code: "legacy-follow-up",
    name: "Legacy follow-up",
    description: null,
    enabled: true,
    triggerType: "ATTENTION",
    conditions: { ruleCodes: ["CASH_PRESSURE_FORECAST"] },
    actionType: "CREATE_FOLLOW_UP",
    actionConfiguration: { dueInHours: 24, assignToActor: true },
    policyVersion: 2,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-10-22T10:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
  };

  expect(fromPolicy(legacy, "branch-1")).toBeNull();
  expect(fromPolicy({ ...legacy, triggerType: "MANUAL", conditions: {} }, "branch-1")).toBeNull();
});
