# Contextual Intelligence Workflows Design

## Intent

Move TradeOS Intelligence from a dashboard-only destination into the tenant workflows where decisions are made. Inventory, Customers, Purchases, Reports, and Settings should each show the evidence-backed signals relevant to that workflow and let the user continue into Ask TradeOS or an existing human-controlled workflow without granting AI new economic authority.

## Goals

- Reuse the existing `/v1/intelligence/briefing` contract and its deterministic attention/evidence instead of inventing page-local heuristics.
- Give each supported workspace a compact contextual intelligence panel near the top of the page.
- Filter the briefing to the sections that matter for the current workflow.
- Surface attention items, recommendations, confidence/data-quality context, and a workflow-specific Ask TradeOS prompt.
- Keep all economic actions as navigation into existing human-controlled workflows.
- Preserve tenant/business/branch scoping and explicit offline behavior.
- Keep the implementation reusable so future surfaces can opt in by adding a surface definition rather than duplicating AI code.

## Non-goals

- No new model/provider integration.
- No new direct payment, refund, sale, purchase, stock-write-off, cashbook, or access mutation authority.
- No automatic execution from the contextual panel.
- No new backend domain endpoints in this slice; deeper domain-specific intelligence can be added later if the shared briefing proves insufficient.
- No attempt to make the Reports 90-day selector redefine the business-intelligence briefing contract, which currently supports today/week/month.

## Approaches considered

1. **Reusable contextual intelligence rail backed by the existing briefing — selected.** One component owns loading, filtering, safety copy, Ask TradeOS handoff, and responsive presentation. Each page supplies only a surface id. This keeps evidence and permissions consistent and makes future expansion cheap.
2. **Separate AI card per page — rejected.** It is quick initially but would duplicate fetch/error/offline/safety logic and inevitably drift across five workflows.
3. **Five new backend intelligence endpoints — deferred.** This could eventually produce deeper domain-specific analysis, but the current briefing already carries the relevant deterministic sections and evidence. New endpoints would add risk and API surface without improving this first contextual slice enough to justify it.

## Surface mapping

- `inventory` → `INVENTORY`; prompt: "What stock needs attention and what should I review for reorder?"
- `customers` → `CUSTOMERS_CREDIT`; prompt: "Which customers need a credit follow-up and why?"
- `purchases` → `SUPPLIERS_PAYABLES` + `INVENTORY`; prompt: "What should I reorder or review with suppliers next?"
- `reports` → `SALES` + `CASH` + `CUSTOMERS_CREDIT` + `SUPPLIERS_PAYABLES` + `INVENTORY`; uses the latest monthly briefing so the context remains within the supported intelligence range.
- `settings` → `OPPORTUNITIES`; also foreground briefing confidence and data-quality readiness; prompt: "How can I improve TradeOS intelligence quality and automation readiness?"

## Interaction design

The panel shows a compact header with the current workflow label, live/offline status, briefing confidence, and generated time. It then shows the relevant section summaries plus a small number of highest-priority attention items/recommendations. A contextual **Ask TradeOS** button opens the existing global drawer with a prefilled workflow-specific question. Recommendation actions remain links to existing workflows; nothing is auto-submitted.

If the user is offline, the panel explains that fresh contextual intelligence and Ask TradeOS are paused. Core offline workflows remain available. This first slice does not create a second cache format that could collide with the existing dashboard cache; offline contextual intelligence therefore fails safely rather than writing incompatible cached data.

## Safety and permissions

- Every request continues to use the current `session.businessId` and `session.branchId`.
- The panel performs GET/read operations only.
- Contextual Ask TradeOS uses the existing query route and existing drawer safety boundaries.
- Recommendation links do not mutate data.
- No arbitrary action types or economic-write endpoints are introduced.
- Settings intelligence is advisory/read-only regardless of role.

## UX and responsiveness

The panel belongs immediately after the page header (and after the Settings hero) so intelligence appears before dense tables/forms. Desktop uses a two-column summary layout when space allows; mobile collapses to one column with full-width actions. Existing TradeOS intelligence visual language and `app/intelligence.css` remain the style source.

## Success criteria

- All five target workspaces render the same contextual intelligence component with their correct surface id.
- The selector returns only relevant sections, deduplicates recommendations/attention, and orders higher severity first.
- Contextual Ask TradeOS opens the global drawer with the correct prefilled question.
- Offline state is explicit and cannot trigger Ask TradeOS or economic mutations.
- Existing dashboard briefing/automation behavior remains unchanged.
- Full web tests and strict TypeScript pass.
