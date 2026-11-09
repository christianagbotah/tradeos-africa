# AI Automation Tuning Advisor Design

## Intent

Turn TradeOS's new 30-day automation-effectiveness data into clear, deterministic guidance about which automation policies deserve human review. The advisor helps an Owner/Admin/Manager understand *where* to tune a policy, but never changes, disables, or fabricates policy settings on its own.

## Goals

- Derive policy-tuning recommendations from the same branch-scoped effectiveness aggregates already used by AI Effectiveness.
- Keep recommendations deterministic, explainable, aggregate-only, and provider-free.
- Distinguish three useful situations: enabled policy with no triggered work, persistently low completion, and repeatedly low-value outcomes.
- Let an authorized user open the existing guided policy editor directly from a recommendation when that policy is currently editable in the selected business/branch.
- Preserve historical effectiveness without pretending a moved/historical policy can be edited from the current branch view.
- Degrade independently when effectiveness analytics fail or the app is offline.

## Non-goals / anti-goals

- No automatic policy mutation, disable/enable, threshold change, assignment change, due-time change, or policy creation.
- No POST/PATCH/DELETE endpoint for tuning advice.
- No LLM/provider call.
- No historical "dry-run replay" or counterfactual task simulation until TradeOS stores a complete historical attention-event stream.
- No exact replacement threshold or rule filter inferred from incomplete aggregate data.
- No raw evidence, source keys, contacts, entity labels, customer/supplier names, or monetary values in the tuning payload.

## Approaches considered

### 1. Extend the existing effectiveness response with server-owned tuning recommendations — chosen

`getBusinessAutomationEffectiveness` already owns the trusted 30-day denominators and per-policy aggregates. It will derive a bounded recommendation list from those rows and return it in the same authenticated GET response. The Web panel renders the advice and delegates "Review policy" to the existing editor in `BusinessAutomationsPanel`.

This keeps one source of truth, one network request, no N+1 reads, and no duplicate client-side analytics logic.

### 2. Add a sibling `/automation-tuning` endpoint

This would separate concerns, but it would repeat scope/access queries or require a second fetch for the same data. Rejected because the advice is a deterministic interpretation of the effectiveness response, not a separate domain resource.

### 3. Client-side recommendation rules

This is cheapest to implement but lets UI logic become the policy-advice authority and risks drifting across web/desktop/mobile clients. Rejected; tuning advice must be server-owned and contract-tested.

## Contract

Add:

- `BusinessAutomationTuningRecommendationKind = "NO_TRIGGERED_WORK" | "LOW_COMPLETION" | "HIGH_NEGATIVE_OUTCOMES"`
- `BusinessAutomationTuningFocus = "TRIGGER" | "WORKFLOW"`
- `BusinessAutomationTuningRecommendation` with:
  - `policyId`
  - `kind`
  - `priority: "INFO" | "MEDIUM" | "HIGH"`
  - `focus`
  - `title`
  - `summary`
  - `rationale`

Extend `BusinessAutomationEffectiveness` with:

- `tuningRecommendations: BusinessAutomationTuningRecommendation[]`

The response remains aggregate-only. There is no proposed patch object and no field that can be submitted directly as a policy mutation.

## Deterministic recommendation rules

Evaluate each effectiveness policy row independently and emit at most one recommendation per policy, in this precedence order:

1. **HIGH_NEGATIVE_OUTCOMES** — policy is enabled, has at least 2 completed tasks, has at least 2 negative outcomes, and `negativeOutcomes >= relevantOutcomes`.
   - priority `HIGH`
   - focus `TRIGGER`
   - advise reviewing trigger conditions/severity because too much generated work is being judged low-value.
2. **LOW_COMPLETION** — policy is enabled, created at least 3 tasks, and `completionRate < 0.5`.
   - priority `MEDIUM`
   - focus `WORKFLOW`
   - advise reviewing assignment/due-time/workflow fit because generated tasks are not being completed reliably.
3. **NO_TRIGGERED_WORK** — policy is enabled and `tasksCreated === 0` in the 30-day window.
   - priority `INFO`
   - focus `TRIGGER`
   - state neutrally that there is not enough triggered work to judge usefulness and suggest checking whether conditions still match current operations/data.

Do not emit advice for disabled policies. Do not emit advice for healthy/learning states that do not meet a rule. Do not infer an exact new severity threshold.

Sort recommendations by priority `HIGH > MEDIUM > INFO`, then policy name/id for deterministic output. Cap the returned list at 10.

## API and security

No new route. The existing management-only endpoint remains:

`GET /v1/intelligence/automation-effectiveness?businessId=<uuid>&branchId=<uuid>`

Existing role/business/branch checks remain authoritative. The advisor cannot broaden access because it is derived after the same scoped effectiveness query.

## Web UX

Enhance `BusinessAutomationEffectivenessPanel` with a compact "Tuning suggestions" section after the outcome summary and before the per-policy effectiveness list.

Each suggestion shows:

- priority/status label
- title
- short summary/rationale
- optional `Review policy` button

The panel accepts `onReviewPolicy?: (policyId: string) => void` and `reviewablePolicyIds?: ReadonlySet<string>` (or equivalent minimal interface). It does not fetch policy details itself and does not mutate anything.

`BusinessAutomationsPanel` passes only IDs from its already-loaded, currently relevant policies that `canControlBusinessAutomationPolicy(...)` and `guidedAutomationDraftFromPolicy(...)` deem editable. Clicking `Review policy` invokes the existing `openEdit(policy)` path. A historical/moved policy may still appear in effectiveness/advice, but receives no edit button if it is not in the current editable policy list.

Offline/error behavior remains independent: effectiveness/tuning may be unavailable while the policy controls continue their existing behavior.

## Safety and performance

- one existing effectiveness GET; zero additional fetches
- zero new mutations
- zero provider calls
- zero list-row/entity fan-out
- server owns thresholds and messages
- no sensitive evidence in advice
- historical policies are not silently rebound to a current-branch editor

## Testing

- contract tests for recommendation union/fields and absence of mutation-shaped payloads
- service tests for all three rules, precedence, disabled-policy exclusion, healthy/learning exclusion, deterministic ordering, cap, tenant/branch isolation, and historical moved-policy behavior
- route regression proving the existing management-only GET returns tuning advice without new mutation routes
- Web contract tests proving no extra fetch, no mutation method, callback-only `Review policy`, hidden review control for non-editable/historical policy IDs, offline/error independence, and responsive styles
- parent-panel tests proving callback resolves only an already-loaded editable policy and uses existing `openEdit`
- full API/Web/typecheck/build/deployment/security and remote CI/Visual QA gates before the slice is considered complete
