import type {
  BusinessAttentionItem,
  BusinessBriefing,
  BusinessBriefingSection,
  BusinessBriefingSectionCode,
  BusinessRecommendation,
} from "@tradeos/contracts";

export type ContextualIntelligenceSurface = "inventory" | "customers" | "purchases" | "reports" | "settings";

type SurfaceDefinition = {
  label: string;
  sectionCodes: readonly BusinessBriefingSectionCode[];
  askPrompt: string;
};

export type ContextualIntelligenceView = {
  surface: ContextualIntelligenceSurface;
  label: string;
  askPrompt: string;
  summary: string;
  sections: BusinessBriefingSection[];
  attentionItems: BusinessAttentionItem[];
  recommendations: BusinessRecommendation[];
  confidence: BusinessBriefing["confidence"];
  dataQuality: BusinessBriefing["dataQuality"];
  generatedAt: string;
  range: BusinessBriefing["range"];
};

const DEFINITIONS: Record<ContextualIntelligenceSurface, SurfaceDefinition> = {
  inventory: {
    label: "Inventory intelligence",
    sectionCodes: ["INVENTORY"],
    askPrompt: "What stock needs attention and what should I review for reorder?",
  },
  customers: {
    label: "Customer intelligence",
    sectionCodes: ["CUSTOMERS_CREDIT"],
    askPrompt: "Which customers need a credit follow-up and why?",
  },
  purchases: {
    label: "Purchasing intelligence",
    sectionCodes: ["SUPPLIERS_PAYABLES", "INVENTORY"],
    askPrompt: "What should I reorder or review with suppliers next?",
  },
  reports: {
    label: "Performance intelligence",
    sectionCodes: ["SALES", "CASH", "CUSTOMERS_CREDIT", "SUPPLIERS_PAYABLES", "INVENTORY"],
    askPrompt: "What are the most important business performance signals I should act on?",
  },
  settings: {
    label: "Intelligence readiness",
    sectionCodes: ["OPPORTUNITIES"],
    askPrompt: "How can I improve TradeOS intelligence quality and automation readiness?",
  },
};

const SEVERITY_RANK: Record<BusinessAttentionItem["severity"], number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

export function contextualIntelligenceDefinition(surface: ContextualIntelligenceSurface): SurfaceDefinition {
  return DEFINITIONS[surface];
}

export function selectContextualIntelligence(
  briefing: BusinessBriefing,
  surface: ContextualIntelligenceSurface,
): ContextualIntelligenceView {
  const definition = contextualIntelligenceDefinition(surface);
  const byCode = new Map(briefing.sections.map((section) => [section.code, section]));
  const sections = definition.sectionCodes
    .map((code) => byCode.get(code))
    .filter((section): section is BusinessBriefingSection => Boolean(section));

  const attentionById = new Map<string, BusinessAttentionItem>();
  const recommendationByCode = new Map<string, BusinessRecommendation>();
  for (const section of sections) {
    for (const item of section.attentionItems) attentionById.set(item.id, item);
    for (const recommendation of section.recommendations) {
      if (!recommendationByCode.has(recommendation.code)) recommendationByCode.set(recommendation.code, recommendation);
    }
  }

  const attentionItems = [...attentionById.values()].sort((a, b) => {
    const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severity !== 0) return severity;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });
  const recommendations = [...recommendationByCode.values()].sort(
    (a, b) => SEVERITY_RANK[b.priority] - SEVERITY_RANK[a.priority],
  );

  return {
    surface,
    label: definition.label,
    askPrompt: definition.askPrompt,
    summary: sections.map((section) => section.summary).filter(Boolean).join(" ") || briefing.summary,
    sections,
    attentionItems,
    recommendations,
    confidence: briefing.confidence,
    dataQuality: briefing.dataQuality,
    generatedAt: briefing.generatedAt,
    range: briefing.range,
  };
}

export function contextualWorkflowHref(actionType?: string | null): string {
  const action = (actionType ?? "").toUpperCase();
  if (action === "CREATE_DATA_READINESS_REVIEW") return "/settings?section=business";
  if (action.includes("REORDER") || action.includes("PURCHASE") || action.includes("PAYABLE")) return "/purchases";
  if (action.includes("RECEIVABLE") || action.includes("CUSTOMER") || action.includes("CREDIT")) return "/customers";
  if (action.includes("CASH") || action.includes("EXPENSE")) return "/cashbook";
  if (action.includes("STOCK") || action.includes("INVENTORY")) return "/inventory";
  if (action.includes("SALE")) return "/sales";
  return "/reports";
}
