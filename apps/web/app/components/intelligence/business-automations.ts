import type { BusinessAutomationPolicy, BusinessAutomationRun } from "@tradeos/contracts";
import { readApiErrorMessage } from "../../../lib/auth-fetch";

const AUTOMATION_MANAGEMENT_ROLES = new Set(["OWNER", "ADMIN", "MANAGER"]);
const MANAGER_AUTOMATION_ACTIONS = new Set(["CREATE_FOLLOW_UP", "CREATE_REORDER_REVIEW", "CREATE_PERFORMANCE_REVIEW", "CREATE_INVENTORY_REVIEW", "SNOOZE_ATTENTION"]);

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

export type GuidedAutomationTemplateId =
  | "reorder-review"
  | "receivables-follow-up"
  | "cash-review"
  | "sales-performance-review"
  | "margin-performance-review"
  | "slow-stock-review"
  | "wastage-review"
  | "supplier-payables-review"
  | "data-readiness-review";

export type GuidedAutomationSeverityThreshold = "ANY" | "MEDIUM_PLUS" | "HIGH_PLUS" | "CRITICAL_ONLY";
export type GuidedAutomationScope = "CURRENT_BRANCH" | "BUSINESS_WIDE";

export interface GuidedAutomationRuleOption {
  value: string;
  label: string;
}

export interface GuidedAutomationTemplate {
  id: GuidedAutomationTemplateId;
  label: string;
  actionType: "CREATE_REORDER_REVIEW" | "CREATE_RECEIVABLE_FOLLOW_UP" | "CREATE_CASH_REVIEW" | "CREATE_PERFORMANCE_REVIEW" | "CREATE_INVENTORY_REVIEW" | "CREATE_PAYABLES_REVIEW" | "CREATE_DATA_READINESS_REVIEW" | "CREATE_FOLLOW_UP";
  triggerType: "ATTENTION" | "MANUAL";
  description: string;
  preview: string;
  defaultRuleCode: string | null;
  ruleOptions: readonly GuidedAutomationRuleOption[];
}

export interface GuidedAutomationDraft {
  businessId: string;
  currentBranchId: string;
  templateId: GuidedAutomationTemplateId;
  name: string;
  scope: GuidedAutomationScope;
  signalRuleCode: string | null;
  severityThreshold: GuidedAutomationSeverityThreshold;
  assignToActor: boolean;
  dueInHours: number;
  enabled: boolean;
  code: string;
}

const GUIDED_AUTOMATION_TEMPLATES: readonly GuidedAutomationTemplate[] = [
  {
    id: "reorder-review",
    label: "Stock reorder review",
    actionType: "CREATE_REORDER_REVIEW",
    triggerType: "ATTENTION",
    description: "Automatically creates an internal reorder review when stockout risk needs attention.",
    preview: "When enabled, TradeOS checks stockout risk automatically and creates an internal reorder review task when it appears. No purchase or stock adjustment is made automatically.",
    defaultRuleCode: "STOCKOUT_RISK",
    ruleOptions: [{ value: "STOCKOUT_RISK", label: "Stockout risk" }],
  },
  {
    id: "receivables-follow-up",
    label: "Receivables follow-up",
    actionType: "CREATE_RECEIVABLE_FOLLOW_UP",
    triggerType: "ATTENTION",
    description: "Automatically creates an internal customer receivables follow-up when overdue balances need attention.",
    preview: "When enabled, TradeOS checks overdue receivables automatically and creates an internal follow-up task when they appear. No payment is posted automatically.",
    defaultRuleCode: "RECEIVABLES_OVERDUE",
    ruleOptions: [{ value: "RECEIVABLES_OVERDUE", label: "Overdue customer balances" }],
  },
  {
    id: "cash-review",
    label: "Cash position review",
    actionType: "CREATE_CASH_REVIEW",
    triggerType: "ATTENTION",
    description: "Automatically creates an internal cash-position review when the 30-day forecast projects negative cash. No cash is moved automatically.",
    preview: "When the 30-day forecast projects negative cash, TradeOS automatically creates an internal cash-position review for a person to act on. It does not transfer, reconcile, or post money.",
    defaultRuleCode: "CASH_PRESSURE_FORECAST",
    ruleOptions: [{ value: "CASH_PRESSURE_FORECAST", label: "Projected negative cash" }],
  },
  {
    id: "sales-performance-review",
    label: "Sales performance review",
    actionType: "CREATE_PERFORMANCE_REVIEW",
    triggerType: "ATTENTION",
    description: "Automatically creates an internal performance review when sales decline needs attention. No price, discount, sale, expense, or cash change is made automatically.",
    preview: "When sales decline needs attention, TradeOS automatically creates an internal performance review for a person to investigate. It does not change prices, discounts, sales, expenses, or money.",
    defaultRuleCode: "SALES_DROP",
    ruleOptions: [{ value: "SALES_DROP", label: "Sales drop" }],
  },
  {
    id: "margin-performance-review",
    label: "Margin performance review",
    actionType: "CREATE_PERFORMANCE_REVIEW",
    triggerType: "ATTENTION",
    description: "Automatically creates an internal performance review when margin pressure needs attention. No price, discount, sale, expense, or cash change is made automatically.",
    preview: "When margin pressure needs attention, TradeOS automatically creates an internal performance review for a person to investigate. It does not change prices, discounts, sales, expenses, or money.",
    defaultRuleCode: "MARGIN_PRESSURE",
    ruleOptions: [{ value: "MARGIN_PRESSURE", label: "Margin pressure" }],
  },
  {
    id: "slow-stock-review",
    label: "Slow stock review",
    actionType: "CREATE_INVENTORY_REVIEW",
    triggerType: "ATTENTION",
    description: "Automatically creates an internal inventory review when slow-moving stock needs attention. No stock movement, adjustment, or write-off is made automatically.",
    preview: "When slow-moving stock needs attention, TradeOS automatically creates an internal inventory review for a person to investigate. It does not adjust, transfer, or write off stock.",
    defaultRuleCode: "SLOW_STOCK",
    ruleOptions: [{ value: "SLOW_STOCK", label: "Slow-moving stock" }],
  },
  {
    id: "wastage-review",
    label: "Wastage review",
    actionType: "CREATE_INVENTORY_REVIEW",
    triggerType: "ATTENTION",
    description: "Automatically creates an internal inventory review when wastage increases materially. No stock movement, adjustment, or write-off is made automatically.",
    preview: "When wastage spikes, TradeOS automatically creates an internal inventory review for a person to investigate. It does not adjust, transfer, or write off stock.",
    defaultRuleCode: "WASTAGE_SPIKE",
    ruleOptions: [{ value: "WASTAGE_SPIKE", label: "Wastage spike" }],
  },
  {
    id: "supplier-payables-review",
    label: "Supplier payables review",
    actionType: "CREATE_PAYABLES_REVIEW",
    triggerType: "ATTENTION",
    description: "Automatically creates an internal supplier-payables review when overdue supplier balances need attention. No supplier payment is posted automatically.",
    preview: "When overdue supplier balances need attention, TradeOS automatically creates an internal supplier-payables review for a person to act on. It does not pay suppliers or post money automatically.",
    defaultRuleCode: "PAYABLES_OVERDUE",
    ruleOptions: [{ value: "PAYABLES_OVERDUE", label: "Overdue supplier balances" }],
  },
  {
    id: "data-readiness-review",
    label: "Data readiness review",
    actionType: "CREATE_DATA_READINESS_REVIEW",
    triggerType: "ATTENTION",
    description: "Automatically creates an internal data-readiness review when TradeOS needs more real operating history. It does not create transactions automatically.",
    preview: "When confidence is low, TradeOS creates an internal review to check business setup and consistent recording from normal real-world activity. It does not create transactions or artificial activity.",
    defaultRuleCode: "LOW_DATA_CONFIDENCE",
    ruleOptions: [
      { value: "LOW_DATA_CONFIDENCE", label: "Low data confidence" },
    ],
  },
];

const SEVERITIES_BY_THRESHOLD: Record<GuidedAutomationSeverityThreshold, string[]> = {
  ANY: [],
  MEDIUM_PLUS: ["MEDIUM", "HIGH", "CRITICAL"],
  HIGH_PLUS: ["HIGH", "CRITICAL"],
  CRITICAL_ONLY: ["CRITICAL"],
};

export function guidedAutomationTemplates(role: string | null | undefined): GuidedAutomationTemplate[] {
  if (role === "OWNER" || role === "ADMIN") return [...GUIDED_AUTOMATION_TEMPLATES];
  if (role === "MANAGER") {
    return GUIDED_AUTOMATION_TEMPLATES.filter((template) => MANAGER_AUTOMATION_ACTIONS.has(template.actionType));
  }
  return [];
}

export function buildGuidedAutomationPayload(input: GuidedAutomationDraft): Record<string, unknown> {
  const template = GUIDED_AUTOMATION_TEMPLATES.find((candidate) => candidate.id === input.templateId);
  if (!template) throw new Error("Unsupported guided automation template.");
  const name = input.name.trim();
  if (!name) throw new Error("Automation name is required.");
  if (name.length > 160) throw new Error("Automation name must be at most 160 characters.");
  if (!Number.isFinite(input.dueInHours) || input.dueInHours < 1 || input.dueInHours > 8760) {
    throw new Error("Due time must be between 1 and 8760 hours.");
  }
  const branchId = input.scope === "BUSINESS_WIDE" ? null : input.currentBranchId;
  const selectedRuleCode = input.signalRuleCode ?? template.defaultRuleCode;
  if (template.triggerType === "ATTENTION" && !template.ruleOptions.some((option) => option.value === selectedRuleCode)) {
    throw new Error("Signal is not available for this guided automation template.");
  }
  const conditions = template.triggerType === "ATTENTION"
    ? {
        ruleCodes: selectedRuleCode ? [selectedRuleCode] : [],
        severities: SEVERITIES_BY_THRESHOLD[input.severityThreshold],
      }
    : {};

  return {
    businessId: input.businessId,
    branchId,
    code: input.code,
    name,
    description: template.description,
    enabled: input.enabled,
    triggerType: template.triggerType,
    conditions,
    actionType: template.actionType,
    actionConfiguration: { dueInHours: input.dueInHours, assignToActor: input.assignToActor },
  };
}

export function guidedAutomationDraftFromPolicy(
  policy: BusinessAutomationPolicy,
  currentBranchId: string,
): GuidedAutomationDraft | null {
  const ruleCodes = Array.isArray(policy.conditions?.ruleCodes)
    ? policy.conditions.ruleCodes.filter((value): value is string => typeof value === "string")
    : [];
  const severities = Array.isArray(policy.conditions?.severities)
    ? policy.conditions.severities.filter((value): value is string => typeof value === "string")
    : [];
  const persistedRuleCode = ruleCodes[0] ?? null;
  const legacyDataReadiness = policy.actionType === "CREATE_FOLLOW_UP"
    && policy.triggerType === "ATTENTION"
    && persistedRuleCode === "LOW_DATA_CONFIDENCE";
  const candidates = legacyDataReadiness
    ? GUIDED_AUTOMATION_TEMPLATES.filter((candidate) => candidate.id === "data-readiness-review")
    : GUIDED_AUTOMATION_TEMPLATES.filter(
        (candidate) => candidate.actionType === policy.actionType && candidate.triggerType === policy.triggerType,
      );
  const template = persistedRuleCode
    ? candidates.find((candidate) => candidate.ruleOptions.some((option) => option.value === persistedRuleCode))
    : candidates.length === 1 ? candidates[0] : undefined;
  if (!template) return null;
  if (template.triggerType === "ATTENTION") {
    const ruleCode = persistedRuleCode ?? template.defaultRuleCode;
    if (!ruleCode || !template.ruleOptions.some((option) => option.value === ruleCode)) return null;
  }
  const dueInHours = typeof policy.actionConfiguration?.dueInHours === "number"
    && Number.isFinite(policy.actionConfiguration.dueInHours)
    && policy.actionConfiguration.dueInHours > 0
    ? policy.actionConfiguration.dueInHours
    : 24;

  return {
    businessId: policy.businessId,
    currentBranchId,
    templateId: template.id,
    name: policy.name,
    scope: policy.branchId === null ? "BUSINESS_WIDE" : "CURRENT_BRANCH",
    signalRuleCode: template.triggerType === "ATTENTION" ? (ruleCodes[0] ?? template.defaultRuleCode) : null,
    severityThreshold: thresholdFromSeverities(severities),
    assignToActor: policy.actionConfiguration?.assignToActor === true,
    dueInHours,
    enabled: policy.enabled,
    code: policy.code,
  };
}

export async function saveGuidedBusinessAutomationPolicy(
  fetcher: AuthenticatedFetcher,
  input: {
    draft: GuidedAutomationDraft;
    existingPolicy?: Pick<BusinessAutomationPolicy, "id" | "policyVersion">;
  },
): Promise<BusinessAutomationPolicy> {
  const payload = buildGuidedAutomationPayload(input.draft);
  const existing = input.existingPolicy;
  const requestPayload = existing
    ? { ...payload, code: undefined, expectedPolicyVersion: existing.policyVersion }
    : payload;
  if (existing) delete requestPayload.code;

  const response = await fetcher(
    existing ? `/v1/intelligence/automations/${encodeURIComponent(existing.id)}` : "/v1/intelligence/automations",
    {
      method: existing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestPayload),
    },
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, existing ? "Automation policy could not be updated" : "Automation policy could not be created"));
  }
  const body = await response.json() as { policy?: BusinessAutomationPolicy };
  if (!body.policy) throw new Error("Server returned an incomplete automation policy response.");
  return body.policy;
}

function thresholdFromSeverities(severities: readonly string[]): GuidedAutomationSeverityThreshold {
  const normalized = [...severities].sort().join("|");
  if (normalized === ["HIGH", "CRITICAL"].sort().join("|")) return "HIGH_PLUS";
  if (normalized === ["MEDIUM", "HIGH", "CRITICAL"].sort().join("|")) return "MEDIUM_PLUS";
  if (normalized === "CRITICAL") return "CRITICAL_ONLY";
  return "ANY";
}

export function createGuidedAutomationDraft(input: {
  businessId: string;
  currentBranchId: string;
  templateId: GuidedAutomationTemplateId;
  code: string;
}): GuidedAutomationDraft {
  const template = GUIDED_AUTOMATION_TEMPLATES.find((candidate) => candidate.id === input.templateId);
  if (!template) throw new Error("Unsupported guided automation template.");
  return {
    businessId: input.businessId,
    currentBranchId: input.currentBranchId,
    templateId: template.id,
    name: template.label,
    scope: "CURRENT_BRANCH",
    signalRuleCode: template.defaultRuleCode,
    severityThreshold: template.id === "sales-performance-review" || template.id === "margin-performance-review" || template.id === "wastage-review"
      ? "MEDIUM_PLUS"
      : template.id === "reorder-review" || template.id === "receivables-follow-up" || template.id === "cash-review" || template.id === "supplier-payables-review"
        ? "HIGH_PLUS"
        : "ANY",
    assignToActor: true,
    dueInHours: template.id === "data-readiness-review" ? 72 : template.id === "slow-stock-review" ? 48 : 24,
    enabled: true,
    code: input.code,
  };
}
