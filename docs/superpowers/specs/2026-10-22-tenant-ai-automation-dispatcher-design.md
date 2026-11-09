# Tenant AI Automation Dispatcher Design

**Date:** 2026-10-22
**Status:** Approved for implementation planning
**Parent workstream:** Tenant/User AI Intelligence & Automation
**Related plan:** `docs/superpowers/plans/2026-10-16-tenant-user-ai-intelligence-automation.md`

## 1. Purpose

TradeOS already lets authorized tenant users create safe automation policies and execute them manually through **Run now**. Those policies create internal workflow/action items only and explicitly forbid direct economic or access-control mutations.

The missing capability is proactive execution. An enabled tenant policy must be able to react to deterministic TradeOS attention signals without requiring the owner or manager to open the Dashboard and press a button.

This design adds a background **tenant automation dispatcher** that evaluates safe tenant policies against authoritative attention facts and creates internal action items automatically while preserving the existing tenant, branch, role, accounting, inventory, offline-sync, and audit boundaries.

The dispatcher is infrastructure for deterministic business workflow automation. It is not an AI-model worker, not a general job runner, and not a replacement for canonical TradeOS mutation services.

## 2. Goals

The dispatcher must:

- proactively execute eligible `ATTENTION` automation policies without a human opening the UI;
- reuse the existing PostgreSQL-backed API deployment rather than introduce a new queue/microservice dependency;
- remain safe when multiple API replicas are running;
- preserve business and branch isolation;
- preserve policy-version and trigger idempotency;
- create only the existing safe internal action types;
- never impersonate an owner/admin to obtain broader mutation authority;
- retain durable run history for success and failure;
- allow one tenant/policy failure without stopping unrelated work;
- start and stop with the real API server lifecycle;
- remain fully usable when the AI/model provider is unavailable;
- keep **Run now** as an explicit human test/execution path.

## 3. Non-goals

This slice does not:

- execute payments, refunds, purchases, sales, stock adjustments/write-offs, credit mutations, or role/access changes;
- introduce autonomous financial posting;
- add a Redis/BullMQ/Kafka dependency;
- add a separate worker deployment;
- turn arbitrary JSON conditions into executable code;
- run LLM/model inference as part of scheduling or dispatch;
- make Dashboard/briefing reads cause workflow mutations;
- replace the existing offline mutation queue or canonical economic services;
- add user-configurable cron expressions in this first version.

## 4. Existing foundation

The implementation builds on mechanisms already present in TradeOS:

- `business_attention_items` stores deterministic tenant/business signals and evidence;
- `business_automation_policies` stores business/branch scope, trigger type, conditions, safe action type, configuration, and policy version;
- `business_automation_runs` has an idempotency boundary of business + policy + policy version + trigger correlation ID;
- `business_action_items` stores non-economic workflow tasks;
- the current tenant automation service already rejects forbidden direct actions;
- the System Admin automation scheduler already demonstrates the approved in-process pattern: PostgreSQL advisory lock, interval tick, duplicate-safe run evaluation, no model dependency, and graceful server shutdown;
- `evaluateBusinessAttention` already produces/refreshes deterministic evidence-backed attention state.

The tenant dispatcher reuses these patterns instead of creating parallel infrastructure.

## 5. Chosen architecture

### 5.1 In-process scheduler

The real API server starts one tenant automation scheduler alongside the existing platform automation scheduler.

Default interval: **15 minutes**.

The interval is configurable through environment configuration, with a conservative minimum to prevent accidental tight loops. A deployment kill switch disables scheduler startup without disabling manual automation APIs.

Suggested configuration names:

- `TENANT_AUTOMATION_SCHEDULER_ENABLED`
- `TENANT_AUTOMATION_SCHEDULER_INTERVAL_MS`

`buildApp()` itself does not start the scheduler. Tests and callers that construct the Fastify application therefore do not silently create background timers. Only the real server lifecycle owns start/stop.

### 5.2 PostgreSQL advisory lock

Every scheduled tick attempts a tenant-specific PostgreSQL advisory lock distinct from the System Admin scheduler lock.

If the lock is held by another API replica, the current instance skips the tick immediately. This prevents duplicated global sweeps while requiring no external coordination service.

The lock is released in `finally`, and server shutdown stops future timers before closing Fastify/database resources.

### 5.3 Facts first, automation second

A scheduled tick follows this order:

1. discover businesses/branches that actually have enabled `ATTENTION` policies;
2. refresh deterministic attention for the applicable scope;
3. load open attention items;
4. match open attention items to enabled policies;
5. execute each unique eligible policy/signal pair through the safe automation execution path;
6. continue after isolated failures and record failure state.

No model/provider call occurs in this path.

## 6. Scope semantics

### 6.1 Branch-specific policy

A policy with `branch_id` set evaluates only signals for that branch. A signal from another branch can never match it.

### 6.2 Business-wide policy

A policy with `branch_id = NULL` means the policy applies across the business's active branches.

For dispatch, TradeOS evaluates the policy **branch by branch**. It does not also create a second aggregate business-level task for the same signal. This keeps tasks attached to the operational branch where the evidence occurred and avoids duplicate branch + aggregate work items.

If a future deterministic attention rule is genuinely business-only rather than branch-derived, that rule must define its own single business-level dispatch semantics explicitly; it is not inferred automatically in this slice.

### 6.3 Tenant isolation

Every discovery, attention refresh, policy lookup, run lookup/insert, and action-item insert remains constrained by authoritative `business_id`. Branch IDs must also belong to that business.

No scheduler query may accept a client-supplied business or role context.

## 7. Trigger matching contract

This first proactive dispatcher handles `trigger_type = 'ATTENTION'`.

A policy matches an open attention item only when:

- the policy is enabled;
- business scope matches;
- branch semantics match section 6;
- the policy action type remains server-allowed;
- configured `ruleCodes`, when present, contain the attention item's `rule_code`;
- configured minimum severity, when present, is satisfied.

The scheduler does not invent or evaluate arbitrary expression languages. Only server-understood condition fields are executable.

Unsupported condition keys are ignored only if current policy validation explicitly permits them; implementation planning should prefer server validation that rejects condition shapes that imply behavior TradeOS does not actually implement.

## 8. Correlation and idempotency

For attention-triggered dispatch, the stable correlation identity is based on the durable attention item:

`attention:<attentionItemId>`

The existing run uniqueness boundary remains:

- business ID;
- policy ID;
- policy version;
- trigger correlation ID.

Consequences:

- repeated scheduler ticks for the same open signal and unchanged policy do not create another run/action item;
- overlapping or retried delivery is safe;
- editing the policy increments `policy_version`, intentionally allowing the updated policy to evaluate the still-open attention signal once under the new version;
- if the old attention item is resolved and a genuinely new attention item is created later, it receives a new ID and may dispatch again.

The implementation must handle the database race directly. A pre-insert lookup is not sufficient by itself; concurrent duplicate delivery must resolve through the unique constraint/conflict handling and return the existing run rather than surfacing an avoidable 500.

## 9. Execution authority

### 9.1 Human execution

The existing authenticated **Run now** route remains a human action. It continues to apply the signed-in user's business membership and role restrictions.

### 9.2 System dispatcher execution

Background dispatch does **not** manufacture an Owner/Admin actor.

The service introduces an internal execution origin/principal such as `SYSTEM_DISPATCHER`. It has authority only to execute the explicit safe internal action allow-list already supported by tenant automation:

- `CREATE_FOLLOW_UP`
- `CREATE_REORDER_REVIEW`
- `CREATE_RECEIVABLE_FOLLOW_UP`
- `CREATE_CASH_REVIEW`
- `SNOOZE_ATTENTION` only if/when its implementation remains non-economic and is explicitly supported by dispatcher tests

The system principal is not a business role, cannot be passed to generic authorization helpers as OWNER/ADMIN, and must not be reusable to call canonical economic mutation services.

Forbidden actions remain forbidden even if a malformed legacy row somehow contains one. Dispatcher execution re-validates the action type server-side before mutation.

## 10. Assignment semantics

The current action configuration supports `assignToActor`. That is meaningful for manual Run-now execution but ambiguous for a system dispatcher because the system is not a staff member.

For policies created/edited after this design:

- when the user selects **Assign to me**, the server binds assignment intent to the authenticated policy-saving user/staff relationship rather than trusting client-provided assignee IDs;
- the persisted configuration may store a server-derived assignment target/reference suitable for later system dispatch;
- a background run assigns only if that target still has an active valid relationship to the same business and applicable branch/scope;
- if the target is no longer valid, TradeOS creates the action item unassigned rather than impersonating another user or failing the whole tenant sweep.

For existing policies that contain only the legacy `assignToActor=true` flag, the dispatcher may fall back to the policy creator only after validating that creator's current active business/staff relationship. Otherwise the action remains unassigned.

Manual Run now may continue to interpret `assignToActor` as the current authenticated actor for backward compatibility unless implementation chooses to normalize the policy configuration during edit.

## 11. Run lifecycle and failure durability

The current manual implementation creates the run and action item in one transaction. That is safe for all-or-nothing manual execution, but background automation also needs durable evidence that an attempted dispatch failed.

The dispatcher execution path should therefore separate **run preparation** from **action execution** sufficiently to persist failure state.

Expected lifecycle:

1. validate enabled policy and scope;
2. establish or retrieve the idempotent run;
3. transition a new run to `EVALUATING`;
4. execute safe internal action creation;
5. mark `SUCCEEDED` with output summary on success;
6. mark `FAILED` with sanitized error information on execution failure.

A failed policy does not abort the scheduler's remaining tenants/policies. Errors are logged with correlation/run identifiers but without secrets.

A later implementation plan may choose a transaction layout different from the System Admin automation service as long as these durability and idempotency properties are preserved.

## 12. Attention lifecycle interaction

Automatic dispatch is driven by authoritative open attention state.

The dispatcher does not require Dashboard access and does not rely on cached web intelligence. It calls server-side deterministic attention evaluation/loaders directly.

A workflow action being created does not automatically resolve the source attention item. Resolution remains owned by the attention engine when underlying business facts no longer satisfy the rule, or by an explicit safe attention action if one is separately supported.

This avoids hiding a real stock/cash/receivables problem merely because a task was created.

## 13. UI contract

After dispatcher rollout:

- the Automations panel explains that enabled attention automations are checked automatically;
- **Run now** is described as immediate testing/manual execution, not the primary execution mechanism;
- the previous temporary wording that background execution still needs a dispatcher is removed;
- users can still disable a policy at any time;
- existing offline UI behavior remains: policy changes/manual execution require connectivity, while normal POS/offline sync remains unaffected.

The UI must not imply that TradeOS autonomously posts money, stock, refunds, purchases, sales, or permission changes.

## 14. Observability and operations

Each scheduler tick should expose concise structured logs for:

- lock acquired/skipped;
- tick correlation/bucket;
- eligible business/branch count;
- evaluated policy count;
- matched attention count;
- succeeded/failed run count;
- duration.

Logs must avoid leaking policy secrets, user tokens, customer-sensitive free text, or raw evidence payloads.

The kill switch allows operators to stop proactive dispatch while preserving manual policy management and Run now.

The first version does not require a new metrics stack, queue dashboard, or dead-letter queue. Durable failed automation runs are the operational failure record.

## 15. Security and safety invariants

The implementation is unacceptable if any of the following invariants are violated:

1. System dispatch can never call a forbidden direct economic/access action merely because a policy row requests it.
2. A business can never read or execute another business's policy, attention item, run, action item, or assignee.
3. A branch-scoped policy can never act on another branch's signal.
4. Business-wide dispatch cannot create duplicate business-level + branch-level tasks for the same branch signal.
5. Multiple API replicas cannot duplicate a scheduler sweep or duplicate a policy/signal run.
6. Dashboard/briefing GET behavior does not become the hidden trigger for workflow mutation.
7. Model/provider availability does not affect deterministic dispatch.
8. Scheduler failures do not block POS, catalog, purchases, inventory, cashbook, reports, authentication, or offline sync.
9. The dispatcher does not become a generic privileged tenant actor.
10. Automatic workflow creation never mutates sales, payment, refund, stock movement, cashbook, credit, subscription, or role/access ledgers.

## 16. Verification requirements

Implementation must be test-driven and include at minimum:

### Scheduler coordination

- one instance acquires the tenant advisory lock;
- a second concurrent instance skips;
- scheduler start/stop is wired only in the real server lifecycle;
- disabling the scheduler prevents background ticks while manual routes still work.

### Matching and scope

- matching attention rule dispatches the expected safe action;
- non-matching `ruleCodes` do not dispatch;
- severity threshold is respected;
- disabled policy does not dispatch;
- branch policy never crosses branches;
- business-wide policy evaluates eligible branches exactly once each;
- another tenant's attention/policy cannot be forged into the run.

### Idempotency and concurrency

- repeated ticks produce one run/action for the same policy version + attention item;
- true concurrent duplicate delivery resolves to the existing run rather than 500;
- a new policy version can evaluate the still-open attention item once;
- a newly-created later attention item can trigger a new run.

### Authority and assignment

- system origin executes only safe allow-listed internal actions;
- forbidden economic/access actions are rejected even when seeded directly in the database;
- Assign-to-me binds from server-authenticated policy owner/editor data;
- inactive/deleted/invalid assignee falls back to unassigned without cross-user substitution.

### Failure isolation

- action creation failure leaves a durable `FAILED` automation run;
- one failed policy does not prevent another policy/business from succeeding in the same sweep;
- scheduler continues on the next interval after a tick error.

### Economic invariants

Before and after dispatcher execution, tests assert no unintended changes to canonical economic/access tables, including at least:

- sales/orders;
- customer/supplier payments;
- refunds/returns economic postings;
- stock/inventory movement ledgers;
- cashbook entries;
- credit obligations/limits where applicable;
- memberships/roles/access grants.

### Regression verification

- existing business automation integration tests stay green;
- existing business attention tests stay green;
- platform automation scheduler tests stay green;
- API typecheck/build gates stay green;
- relevant web tests/typecheck stay green after wording/control updates.

## 17. Expected implementation surface

The implementation plan should prefer a small surface such as:

- create `apps/api/src/business-intelligence/automation-dispatcher.ts`;
- refactor `apps/api/src/business-intelligence/automation-service.ts` to expose a safe internal execution path with durable failure handling;
- update `apps/api/src/server.ts` to start/stop the tenant scheduler;
- add targeted dispatcher integration tests;
- extend business automation integration tests for concurrency/system authority/assignment;
- update the tenant Automations panel copy/tests to reflect active background execution;
- add a migration only if assignment/audit persistence cannot be represented safely with the existing policy/run/action schemas.

A migration is not automatically required. Existing persistence should be reused unless implementation planning identifies a concrete invariant that cannot be enforced otherwise.

## 18. Rollout

1. Land implementation behind the scheduler kill switch.
2. Verify manual Run now remains unchanged for existing safe policies.
3. Verify background dispatch in isolated integration tests with all migrations applied.
4. Deploy with scheduler enabled on staging.
5. Observe run/action history for enabled tenant policies and confirm no duplicate tasks across multiple API processes/restarts.
6. Keep PR #92 draft until dispatcher tests, full tenant-AI regressions, and staging verification are complete.

## 19. Future extensions

Not part of this implementation, but this architecture leaves room for:

- event-triggered tenant dispatch from canonical domain events;
- scheduled policy types beyond attention, with explicit server-defined schedules;
- approval-required `PREPARE_*` workflows for sensitive actions;
- notification delivery policies;
- richer assignment strategies (role/team/round-robin) with explicit authorization semantics;
- extraction to a dedicated worker only if scale/operational evidence justifies it.

Those extensions must preserve the execution-principal, idempotency, tenant isolation, evidence, and economic safety invariants defined here.
