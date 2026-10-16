# System Admin V2 AI Operations & Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic platform attention signals, a grounded AI operations copilot, policy-controlled automation, human approvals, daily briefings, and safe proactive evaluation to System Admin V2.

**Architecture:** Deterministic rules create authoritative attention facts first. An `intelligence-service` may summarize/rank/explain only through allow-listed structured tools; it never queries arbitrary production SQL and never writes domain tables. An `automation-service` is the only path from a recommendation to an action, with execution classes, approval requirements, idempotency, and append-only audit. Scheduled evaluation uses a database advisory lock so only one API process evaluates time-based rules at a time.

**Tech Stack:** TypeScript/Fastify/PostgreSQL/Next.js/Vitest, existing platform-admin services from the core plan, native `fetch` for the initial OpenAI Responses adapter, configurable model via environment rather than hard-coded model identity.

**Spec:** `docs/superpowers/specs/2026-10-16-system-admin-v2-ai-automation-design.md`

## Global Constraints

- Deterministic facts precede AI interpretation; the model cannot invent platform state.
- AI never writes tenant, billing, security, release, or entitlement tables directly.
- Class 2 actions require an authorized human approval before canonical mutation services execute.
- Class 3 actions are never delegated to AI.
- Model unavailability must degrade to deterministic attention/metrics; core admin operations remain functional.
- AI/tool inputs and outputs must exclude secrets, raw passwords, access/session tokens, provider secrets, and payment credentials.
- Every AI recommendation and automation run records evidence references, policy/version, actor/approver where applicable, state transitions, and correlation ID.
- Duplicate trigger/policy-version evaluations must be idempotent.
- AI responses must clearly distinguish facts, computed metrics, predictions, and recommendations.
- Initial provider configuration uses `OPENAI_API_KEY` plus a configured `TRADEOS_AI_MODEL`; no model name is hard-coded in source.

## Review Focus

- Model returns malformed/hostile structured output: parsing failure must create no action and must surface a safe failed recommendation/run; pinned in Task 4.
- Two schedulers evaluate the same time-based trigger: advisory lock + idempotency must create one effective run; pinned in Task 6.
- Approval race: two admins approving the same Class 2 run must execute the canonical mutation at most once; pinned in Task 3.
- Evidence becomes stale after recommendation creation: approval must revalidate current entity revision/eligibility before mutation; pinned in Task 3.
- AI provider unavailable or rate-limited: deterministic command center/attention queue remains usable and retry state is visible; pinned in Tasks 4–5.

---

### Task 1: Attention and automation persistence contracts

**Files:**
- Create: `packages/db/migrations/0022_platform_ai_automation.sql`
- Modify: `packages/contracts/src/platform-admin.ts`
- Test: `apps/api/test/platform-admin-automation-schema.integration.test.ts`

**Interfaces:**
- Produces tables `platform_attention_items`, `platform_automation_policies`, `platform_automation_runs`, and optional `platform_ai_recommendations` if recommendations are not embedded in runs.
- Produces contract types `AdminAttentionItem`, `PlatformAutomationClass = 0|1|2|3`, `AdminAutomationPolicy`, `AdminAutomationRun`, `AdminAutomationApprovalDecision`, `AdminAiRecommendation`, `AdminOperationsBriefing`.

- [ ] **Step 1: Write failing schema/constraint tests**
  - Assert attention item uniqueness by stable source key/scope while open.
  - Assert automation run idempotency on `(policy_id, policy_version, trigger_correlation_id)`.
  - Assert run states are limited to the spec states and execution class is 0–3.
  - Assert approver/executor foreign keys target `platform_users` and tenant scope optionally targets `businesses`.

- [ ] **Step 2: Run RED**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-automation-schema.integration.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement migration/contracts**
  - Store structured conditions/actions/evidence as JSONB but keep state, class, approval role, timestamps, scope, and idempotency keys as typed columns/indexes.
  - Include `policy_version integer NOT NULL DEFAULT 1`; any policy mutation increments it.

- [ ] **Step 4: Verify migration and contract build**
  - Run migration validation from CI, targeted test, then `pnpm --filter @tradeos/contracts build`.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin-ai): add attention and automation schema`

### Task 2: Deterministic attention engine

**Files:**
- Create: `apps/api/src/platform-admin/attention-service.ts`
- Modify: `apps/api/src/platform-admin/routes.ts`
- Test: `apps/api/test/platform-admin-attention.integration.test.ts`

**Interfaces:**
- Produces `evaluatePlatformAttention(pool, input: { now: Date; businessId?: string; correlationId: string }): Promise<AdminAttentionItem[]>`, `listPlatformAttention(pool, actor, query)`, `resolveAttentionItem(pool, actor, id, reason)`.
- Rule codes: `TRIAL_EXPIRING_3D`, `SUBSCRIPTION_PAST_DUE`, `COLLECTION_FAILED_3X`, `DEVICE_STALE`, `SYNC_RISK`, `CLIENT_BELOW_MINIMUM`, `ENTITLEMENT_OVERRIDE_HIGH`, `ADMIN_LOGIN_FAILURES_HIGH`.

- [ ] **Step 1: Write failing rule tests**
  - Seed each rule’s minimum authoritative data and assert exact rule code, severity, evidence payload, target business/entity, and stable source key.
  - Re-evaluate unchanged data and assert the same open item is updated rather than duplicated.
  - Resolve a no-longer-true condition and assert it is marked resolved/closed, not deleted.

- [ ] **Step 2: Run RED**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-attention.integration.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement attention service/API**
  - Add `GET /api/admin/attention` and privileged `POST /api/admin/attention/evaluate` for explicit evaluation/testing.
  - Rules query authoritative control-plane data directly inside this deterministic service; no model call is involved.

- [ ] **Step 4: Verify GREEN/typecheck**
  - Run targeted test and API typecheck.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin-ai): add deterministic attention engine`

### Task 3: Automation policies, runs, approvals, and canonical action dispatch

**Files:**
- Create: `apps/api/src/platform-admin/automation-service.ts`
- Create: `apps/api/src/platform-admin/automation-actions.ts`
- Modify: `apps/api/src/platform-admin/routes.ts`
- Test: `apps/api/test/platform-admin-automation.integration.test.ts`

**Interfaces:**
- Produces `createAutomationPolicy`, `updateAutomationPolicy`, `evaluateAutomationPolicies`, `approveAutomationRun`, `rejectAutomationRun`, `executeAutomationRun`.
- `automation-actions.ts` exposes an allow-list dispatcher `executeApprovedPlatformAction(context, proposedAction)` that delegates to core services such as `changeTenantStatus`, `transitionSubscription`, entitlement/device actions when those services exist.

- [ ] **Step 1: Write failing automation enforcement tests**
  - Assert Class 0 records information only; Class 1 can execute only allow-listed low-risk workflow actions; Class 2 stops at `WAITING_APPROVAL`; Class 3 policy creation is rejected.
  - Race two approvals of the same Class 2 run and assert canonical mutation executes once.
  - Mutate the target entity after recommendation creation and assert approval revalidation fails safely if the proposed action is stale.
  - Assert approver role requirement is checked server-side and run/audit state transitions are append-only.

- [ ] **Step 2: Run RED**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-automation.integration.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement policy/run service and action dispatcher**
  - Add `/api/admin/automation/policies`, `/api/admin/automation/runs`, `/approve`, `/reject`, `/retry` routes.
  - Lock the run row `FOR UPDATE` during approval/execution and revalidate target revision/eligibility immediately before calling a canonical mutation service.

- [ ] **Step 4: Verify GREEN plus core mutation regressions**
  - Run automation test plus tenant/subscription/billing tests from the core plan.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin-ai): add policy controlled automation`

### Task 4: Grounded AI provider and intelligence service

**Files:**
- Create: `apps/api/src/ai/provider.ts`
- Create: `apps/api/src/ai/openai-responses-provider.ts`
- Create: `apps/api/src/platform-admin/intelligence-tools.ts`
- Create: `apps/api/src/platform-admin/intelligence-service.ts`
- Modify: `apps/api/src/platform-admin/routes.ts`
- Test: `apps/api/test/platform-admin-intelligence.test.ts`

**Interfaces:**
- Produces shared interface `AiTextProvider.generateStructured(input: AiStructuredPrompt): Promise<{ value: unknown; providerRequestId: string | null }>` in `apps/api/src/ai/provider.ts`; both System Admin and tenant intelligence services consume this interface.
- `OpenAiResponsesProvider` reads `OPENAI_API_KEY` and `TRADEOS_AI_MODEL`; if either is absent, provider reports `AI_UNAVAILABLE` without breaking deterministic routes.
- `intelligence-tools.ts` exposes an allow-list: tenant summary/detail, platform metrics, attention items, invoice/payment summary, device/sync health, release health, recent audit summary. No arbitrary SQL/tool name is accepted.
- Routes: `POST /api/admin/intelligence/query`, `POST /api/admin/intelligence/briefing`.

- [ ] **Step 1: Write failing provider/tool-grounding tests**
  - Use a fake provider; assert the service supplies only allow-listed structured facts and records tool/evidence IDs used.
  - Assert unsupported tool requests are rejected before execution.
  - Assert malformed model JSON/schema output returns a typed AI error and creates no automation action.
  - Assert provider unavailable/rate-limited response leaves deterministic attention APIs unaffected.

- [ ] **Step 2: Run RED**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/platform-admin-intelligence.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement provider abstraction, OpenAI adapter, tools, and service**
  - Provider request uses native `fetch`; model name is configuration-only.
  - Validate model output into the exact `AdminAiRecommendation`/briefing structure before persistence/display.
  - Redact/severely limit raw audit/provider payloads before model context construction.

- [ ] **Step 4: Verify GREEN/typecheck with no API key required for tests**
  - Tests inject the fake provider; CI must not require a live AI key.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin-ai): add grounded operations copilot service`

### Task 5: AI briefing, attention, approvals, and automation UI

**Files:**
- Modify: `apps/system-admin/app/components/nav.ts`
- Modify: `apps/system-admin/app/console/page.tsx`
- Create: `apps/system-admin/app/console/automation/page.tsx`
- Create: `apps/system-admin/app/components/ai-insight-card.tsx`
- Create: `apps/system-admin/app/components/approval-card.tsx`
- Modify: `apps/system-admin/app/admin-components.css`
- Test: `apps/system-admin/app/components/admin-ai-automation-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 APIs.
- Produces: AI Operations Briefing on Overview; Attention Queue; Automation page with policies, waiting approvals, run history, and natural-language query surface.

- [ ] **Step 1: Write failing UI contract tests**
  - Assert insight cards show finding, severity, evidence, confidence when predictive, recommendation, authoritative record link, and generated timestamp.
  - Assert waiting-approval cards show proposed action/impact, target, evidence, required role, approve/reject buttons, and reason input where required.
  - Assert AI-unavailable state retains deterministic attention cards and does not blank the page.
  - Assert narrow/mobile markup does not rely on horizontal tables for approval workflows.

- [ ] **Step 2: Run RED**
  - Run: `pnpm --filter @tradeos/system-admin exec vitest run app/components/admin-ai-automation-contract.test.ts`

- [ ] **Step 3: Implement UI using existing admin primitives**
  - Default Overview briefing is concise: urgent now, revenue/billing risk, tenant health, sync/device health, release/platform issues, opportunities.
  - Natural-language query answers render fact/recommendation labels and evidence links; do not render model output as unrestricted HTML.

- [ ] **Step 4: Verify System Admin tests/typecheck/build**
  - Run full System Admin verification.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin-ai): add operations briefing and approval center`

### Task 6: Proactive scheduler and event-trigger integration

**Files:**
- Create: `apps/api/src/platform-admin/automation-scheduler.ts`
- Modify: `apps/api/src/server.ts`
- Modify: core billing/tenant/device/release mutation services only where event hooks exist
- Test: `apps/api/test/platform-admin-automation-scheduler.integration.test.ts`

**Interfaces:**
- Produces `startPlatformAutomationScheduler(pool, options?: { intervalMs?: number; now?: () => Date }): { stop(): void }`.
- Scheduled default: evaluate time-based attention/automation every 15 minutes; use PostgreSQL advisory lock for one active evaluator.
- Event hook: `enqueue/evaluatePlatformEvent(pool, { eventType, entityType, entityId, businessId?, correlationId })` for immediate evaluation after authoritative mutations.

- [ ] **Step 1: Write failing scheduler/idempotency tests**
  - Start two scheduler instances against the same DB; assert one effective evaluation per interval/correlation.
  - Assert repeated event hook with same correlation does not duplicate runs.
  - Assert scheduler stop prevents future ticks and server shutdown can call it cleanly.

- [ ] **Step 2: Run RED**
  - Run scheduler targeted test.

- [ ] **Step 3: Implement advisory-lock scheduler and event hook**
  - The scheduler must not call the AI model merely because a tick occurred; run deterministic evaluation first and invoke AI only when a policy/briefing request requires it.

- [ ] **Step 4: Run full API + System Admin verification and Visual QA**
  - Run contracts build, API test/typecheck, System Admin test/typecheck/build, `git diff --check`.
  - Visual QA: Overview briefing, attention queue, automation policies, approval cards, run history at mobile and desktop widths.

- [ ] **Step 5: Commit**
  - Commit: `feat(admin-ai): enable proactive automation evaluation`
