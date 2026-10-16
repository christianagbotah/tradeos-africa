# TradeOS Africa System Admin V2 + AI Operations Design

**Date:** 2026-10-16  
**Status:** Written design for owner review  
**Scope:** Upgrade the existing secure System Admin read plane into an easy-to-use, auditable platform control center with tenant management, subscription billing, administrator account controls, and AI-assisted operations. This is Workstream A of a committed two-workstream TradeOS intelligence program; Workstream B applies the same ease-of-use, rich workflows, and policy-controlled AI automation to tenant/business users.

## 1. Product intent

TradeOS System Admin must become the operating console for the SaaS platform itself. It must let authorized Lightworld/TradeOS operators understand what is happening across tenants, subscriptions, payments, devices, releases, and support activity without entering a tenant's normal day-to-day workspace.

The interface must be simple enough for routine operational work, while still exposing deep information when needed. Advanced capabilities must not make the portal feel like a developer console.

AI is a first-class operational capability, not a decorative chatbot. The System Admin AI layer must detect conditions that deserve attention, explain why they matter, recommend concrete next actions, and automate low-risk work when policy allows. High-impact actions remain explicitly permissioned, reversible where possible, and audited.

## 2. Success criteria

System Admin V2 succeeds when an authorized operator can:

- manage their own administrator profile and security settings;
- open any tenant from the tenant list and see a complete operational summary;
- understand branches, devices, subscription state, entitlements, and recent platform activity for that tenant;
- manage plans and tenant subscriptions according to role permissions;
- view authoritative TradeOS subscription invoices and subscription payments separately from tenant POS/sales payments;
- identify failed payments, expiring trials, past-due subscriptions, sync failures, stale devices, and other platform risks without manually inspecting multiple pages;
- use an AI operations copilot to ask platform questions in natural language and receive answers grounded in live control-plane data;
- review AI recommendations and approve or reject sensitive actions;
- configure safe automations for repetitive platform work;
- see a complete audit trail for administrator and AI-assisted actions;
- perform common workflows comfortably on phone, tablet, or desktop;
- establish reusable attention, recommendation, approval, automation, and evidence patterns that the tenant/business-user experience will consume in Workstream B.

## 3. Existing foundation

The current repository already provides:

- platform-admin authentication using isolated `platform_users` and `platform_admin_sessions`;
- `__Host-` secure HttpOnly admin session cookies;
- roles: `SUPER_ADMIN`, `PLATFORM_ADMIN`, `DEVELOPER`, `SUPPORT`, `BILLING`, `OPERATIONS`;
- live read APIs for tenants, tenant detail, devices, platform audit, client releases, and feature flags;
- `subscription_plans`, `plan_entitlements`, `business_subscriptions`, and `business_entitlement_overrides`;
- tenant list UI, device UI, audit UI, release UI, and feature-flag UI;
- platform audit storage;
- deployment separation between tenant web and dedicated System Admin host.

The main missing pieces are account/profile management, tenant drill-down UI, write-plane APIs, platform billing ledger, richer dashboards, platform-user administration, and AI/automation orchestration.

## 4. Approaches considered

### Approach A — embed normal tenant screens into System Admin

This would be fast because existing tenant pages already expose many details. It is rejected because it weakens the security boundary between platform administration and tenant operations, encourages support impersonation, and makes cross-tenant auditing harder.

### Approach B — create a separate billing/AI microservice immediately

This gives strong isolation but introduces unnecessary deployment and operational complexity before the control-plane domain is mature. It is rejected for this phase.

### Approach C — extend the existing System Admin control plane with dedicated services and policy-controlled AI

This is selected. The current `/api/admin/*` boundary remains authoritative. Billing, automation, and AI features are implemented as focused modules behind that boundary. The design preserves the dedicated admin host, existing platform roles, and audit model while allowing future extraction into separate services if scale requires it.

## 5. UX principles

### 5.1 Progressive disclosure

Each page starts with the most important state and actions. Detailed identifiers, provider references, raw configuration, and historical records appear in expandable sections, side sheets, or detail tabs rather than overwhelming the default screen.

### 5.2 Task-oriented navigation

Navigation groups are organized around operator jobs:

- **Overview** — health, alerts, AI briefing, action queue;
- **Tenants** — businesses, branches, users, devices, lifecycle;
- **Billing** — subscriptions, plans, invoices, payments, reconciliation;
- **Automation** — AI recommendations, rules, approvals, execution history;
- **Platform** — releases, feature flags, integrations;
- **Security** — administrators, sessions, audit;
- **My account** — profile and security.

### 5.3 Mobile-first administration

Tables must degrade into meaningful cards on narrow screens. Filters and bulk actions must remain reachable. Destructive or financial actions use sheets/dialogs with clear summaries rather than tiny inline controls.

### 5.4 Explain before mutate

Every state-changing action shows what will change, what may be affected, and whether the action is reversible. Financial and access-control changes require an explicit reason when policy requires one.

### 5.5 No fake intelligence

AI output must distinguish facts, computed metrics, predictions, and recommendations. The UI must never present a model suggestion as an authoritative platform fact.

## 6. Route map

Existing routes remain and are expanded with:

- `/console` — platform command center;
- `/console/tenants` — tenant list;
- `/console/tenants/[id]` — tenant 360 detail;
- `/console/subscriptions` — subscription portfolio;
- `/console/plans` — plan/pricing/entitlement management;
- `/console/billing/invoices` — subscription invoices;
- `/console/billing/payments` — subscription payment ledger and reconciliation;
- `/console/automation` — AI recommendations, automation policies, approvals, execution history;
- `/console/admins` — platform administrators and role state;
- `/console/audit` — privileged audit trail;
- `/console/devices` — registered devices and sync health;
- `/console/releases` — client releases;
- `/console/flags` — feature flags;
- `/console/profile` — current administrator profile, password, and sessions.

## 7. Administrator account and security

### Profile

The signed-in administrator can view and update:

- display name;
- email, with uniqueness validation;
- avatar/image if image storage is available through the platform file service;
- personal timezone/display preference later without changing business data.

Role cannot be self-edited.

### Password change

Changing password requires:

1. current password;
2. new password validation;
3. password hash update and `password_changed_at` refresh;
4. revocation of all other administrator sessions;
5. append-only platform audit event.

### Sessions

The profile page shows active administrator sessions with device key, platform, created time, last activity, and expiry. The current session is clearly marked. An administrator may revoke other own sessions.

### Admin-user management

`SUPER_ADMIN` may create, deactivate/reactivate, and change the role of other platform users. It must be impossible to deactivate or demote the last active `SUPER_ADMIN`.

## 8. Tenant 360 detail

Selecting a tenant opens a dedicated detail route, not an embedded tenant workspace.

The default overview shows:

- legal/display business name and business type;
- tenant status;
- country/currency;
- created and updated timestamps;
- owner/admin contacts where available;
- branch count and branch states;
- staff/membership counts by role/status;
- registered-device count and health;
- latest platform activity;
- current subscription and plan;
- entitlement overrides;
- billing standing;
- AI-generated attention summary grounded in deterministic signals.

Tabs/sections:

1. **Overview**
2. **Branches & access**
3. **Subscription & entitlements**
4. **Billing**
5. **Devices & sync**
6. **Platform activity**
7. **AI insights**

### Tenant lifecycle writes

Authorized operators may suspend/reactivate a tenant. Suspension requires a reason and confirmation. The API records actor, target, prior state, new state, reason, timestamp, and correlation ID in `platform_audit_events`.

Closing/deleting a tenant is not part of this phase. Historical tenant data is never hard-deleted from System Admin.

## 9. Plans, subscriptions, and entitlements

The existing `subscription_plans`, `plan_entitlements`, `business_subscriptions`, and overrides remain authoritative.

### Plan management

Billing-authorized administrators can:

- create plans;
- edit plan name/description;
- set currency and amount in integer minor units;
- choose monthly, annual, or custom interval;
- set trial days;
- activate/deactivate plans;
- control public/private visibility;
- edit entitlement values and limits.

Historical subscriptions keep the plan relationship used when created. Price changes do not rewrite historical invoices.

### Subscription lifecycle

Authorized actions:

- assign initial plan;
- begin trial;
- activate;
- upgrade/downgrade;
- pause/reactivate;
- cancel immediately where policy allows;
- cancel at period end;
- resume before effective cancellation;
- record provider references.

Every transition is server validated and audited. The API prevents more than one current subscription in the states covered by the existing unique index.

## 10. Platform billing ledger

Tenant operational payments such as POS sales, customer receipts, supplier payments, and refunds must never be reused for TradeOS SaaS billing.

Add dedicated platform billing tables.

### `subscription_invoices`

Required fields:

- id;
- business_id;
- subscription_id;
- invoice_number;
- currency_code;
- subtotal_minor;
- tax_minor;
- total_minor;
- amount_paid_minor;
- status: `DRAFT`, `OPEN`, `PARTIALLY_PAID`, `PAID`, `VOID`, `UNCOLLECTIBLE`, `REFUNDED`;
- period_start / period_end;
- issued_at;
- due_at;
- paid_at;
- provider;
- provider_invoice_reference;
- created_at / updated_at.

### `subscription_payments`

Required fields:

- id;
- business_id;
- invoice_id;
- amount_minor;
- currency_code;
- method/provider;
- provider_transaction_reference;
- status: `PENDING`, `SUCCEEDED`, `FAILED`, `REVERSED`, `REFUNDED`, `PARTIALLY_REFUNDED`;
- failure_code/message where applicable;
- received_at;
- reconciled_at;
- created_at / updated_at.

### `subscription_payment_refunds`

Refund records reference an original subscription payment. The ledger records requested, succeeded, failed, and provider references without mutating the original payment amount.

### Reconciliation

Provider callbacks and manual reconciliation update platform billing state idempotently. Duplicate provider events must not create duplicate payments.

## 11. Dashboard and attention model

The System Admin overview becomes an action-oriented command center.

### Core metrics

- total/active/suspended tenants;
- trialing, active, past-due, paused, canceled subscriptions;
- MRR and ARR from active recurring subscription amounts;
- open/overdue invoice value;
- successful/failed subscription collections;
- active/stale devices;
- tenants with sync risk;
- release adoption/unsupported-client counts.

### Attention queue

A deterministic rules layer produces attention items before AI interpretation. Examples:

- trial expires within 3 days;
- subscription past due;
- three failed collection attempts;
- tenant has no recent device activity;
- large increase in sync failures;
- app version below minimum supported version;
- unusually high entitlement override count;
- repeated admin login failures.

This deterministic layer provides stable facts that AI can summarize and prioritize.

## 12. AI Operations Copilot

### Purpose

The AI copilot helps an operator understand platform state and take the next correct action faster.

It supports questions such as:

- “Which tenants need attention today?”
- “Why is Acme Traders marked past due?”
- “Show tenants whose trials expire this week and have been active recently.”
- “Which failed payments are likely provider errors rather than customer non-payment?”
- “Summarize sync problems since yesterday.”
- “What changed after the latest web release?”

### Grounding model

The model does not query production tables directly. An `AdminIntelligenceService` exposes allow-listed read tools that return structured control-plane facts. Each answer records which tool calls/data windows were used.

The model may summarize, rank, explain, or draft actions. It may not invent missing values.

### Explainability

AI insight cards include:

- finding;
- severity;
- evidence/factors;
- confidence when predictive inference is involved;
- recommended action;
- link to the authoritative tenant/payment/device record;
- generated timestamp.

## 13. AI automation engine

AI automation is policy-controlled and event-driven.

### Automation classes

**Class 0 — Inform only**  
Summaries, explanations, risk flags, daily briefing. No mutation.

**Class 1 — Auto-execute low-risk communication/workflow**  
Create internal follow-up tasks, tag/queue records, draft notices, send notifications only when a configured template/channel policy allows it.

**Class 2 — Recommend + human approval**  
Plan changes, subscription pause/cancel, tenant suspension, entitlement changes, device revocation, payment refunds, admin-role changes. AI can prepare the action but cannot execute without an authorized administrator confirming it.

**Class 3 — Never delegated to AI**  
Deleting platform administrators, deleting tenant/business history, changing the last SUPER_ADMIN, bypassing payment/security controls, changing audit history, exposing credentials/secrets.

### Automation policy storage

Add `platform_automation_policies` with:

- id/code/name;
- enabled;
- trigger/event type;
- scope (global or tenant-specific);
- conditions JSON;
- action type;
- action configuration JSON;
- execution class;
- approval role requirement;
- created_by/updated_by platform user;
- timestamps.

Add `platform_automation_runs` with:

- policy id;
- trigger source/correlation id;
- state: `QUEUED`, `EVALUATING`, `WAITING_APPROVAL`, `APPROVED`, `EXECUTING`, `SUCCEEDED`, `FAILED`, `CANCELED`, `SKIPPED`;
- AI/model metadata where AI is used;
- structured inputs/output summary;
- proposed action;
- approver/executor identities;
- error information;
- timestamps.

### Idempotency

An automation run uses trigger/event identity plus policy version as an idempotency boundary. Retried events must not duplicate financial or access-control actions.

## 14. AI daily briefing and proactive operations

The overview includes a concise “AI Operations Briefing” generated from deterministic platform signals and current billing/device/release data.

The briefing groups findings into:

- urgent now;
- revenue/billing risk;
- tenant health;
- sync/device health;
- release/platform issues;
- opportunities/follow-ups.

It must be possible to regenerate the briefing, inspect evidence, and convert a recommendation into an approval request or internal task.

The briefing is not allowed to silently execute Class 2 actions.

## 15. Notifications and communications

The platform should support notification adapters without coupling the control plane to one provider.

Initial abstractions:

- email;
- in-app administrator notification;
- future SMS/WhatsApp/provider integration.

AI may draft message content, but customer-facing billing or suspension messages use controlled templates with variable insertion unless a human explicitly approves free-form AI text.

## 16. Permissions

### SUPER_ADMIN

Full platform control, admin-user management, all approvals, billing, lifecycle, automation policy management.

### PLATFORM_ADMIN

Broad platform operations excluding last-SUPER_ADMIN controls and other reserved security operations.

### BILLING

Plans, subscriptions, invoices, payments, reconciliation, billing reports; no release/security administration.

### OPERATIONS

Tenant lifecycle, branches/devices/support operations; billing read access as needed; no payment refunds unless separately granted.

### SUPPORT

Tenant diagnostics, device/sync state, activity, AI explanations; no tenant suspension, plan mutation, payment mutation, or administrator management by default.

### DEVELOPER

Releases, feature flags, technical health and diagnostic views; no billing or tenant-lifecycle writes by default.

All authorization is enforced server-side. Hidden buttons are not a security boundary.

## 17. Audit model

Every privileged action and AI-assisted workflow records an immutable `platform_audit_events` entry.

Required audit context:

- platform user;
- target business when applicable;
- event type;
- entity type/id;
- reason;
- previous/new state for mutations;
- automation run id when applicable;
- AI recommendation identifier/model metadata when applicable;
- correlation id;
- occurred_at.

Secrets, raw passwords, access tokens, provider signing secrets, and full payment credentials are never written to the audit payload.

## 18. Service boundaries

Keep modules focused:

- `platform-admin/security` — login/session/password/account security;
- `platform-admin/profile-service` — self profile/session operations;
- `platform-admin/tenant-service` — tenant read/write lifecycle;
- `platform-admin/subscription-service` — plans/subscription state transitions;
- `platform-admin/billing-service` — invoices/payments/refunds/reconciliation;
- `platform-admin/automation-service` — policies, runs, approvals, idempotency;
- `platform-admin/intelligence-service` — allow-listed AI context tools and recommendation generation;
- `platform-admin/read-service` — existing read models, progressively narrowed as domain services own richer reads.

Routes remain under `/api/admin/*` and call services rather than embedding business rules in route handlers.

## 19. Data flow

Typical AI-assisted past-due workflow:

1. provider callback or scheduled billing evaluation updates a subscription payment/invoice;
2. billing service recomputes invoice/subscription standing transactionally;
3. a platform event is emitted for the changed condition;
4. attention rules create/update a deterministic attention item;
5. automation policies evaluate the event;
6. AI may summarize cause/context and propose a next action;
7. if Class 0/1 and policy permits, the action completes automatically;
8. if Class 2, an approval item appears in System Admin;
9. an authorized administrator reviews evidence and confirms/rejects;
10. the service executes the canonical mutation;
11. audit + automation-run records capture the complete chain.

AI never writes directly to billing or tenant tables.

## 20. Error handling

- Mutation APIs return stable typed error codes and user-safe messages.
- Optimistic UI is avoided for sensitive subscription/access mutations unless reversal is trivial.
- Failed provider callbacks are retryable and idempotent.
- AI/model unavailability degrades to deterministic control-plane data; core admin operations remain functional.
- AI output parsing/validation failures never trigger an action.
- Automation failures remain visible in the run history with retry eligibility.
- Partial bulk actions report successes and failures explicitly.
- Stale-write protection uses expected revision/timestamp where concurrent edits matter.

## 21. Testing strategy

### Database/migration tests

- constraints and indexes for invoices/payments/automation;
- idempotency uniqueness;
- current-subscription invariants;
- refund/payment-state integrity.

### Service tests

- every role/permission boundary;
- last-SUPER_ADMIN invariant;
- subscription state transitions;
- invoice/payment/reconciliation flows;
- tenant suspend/reactivate auditing;
- automation class enforcement;
- approval requirement enforcement;
- model failure cannot execute mutations.

### API tests

- admin session/auth boundaries;
- tenant detail;
- profile/password/session revocation;
- plans/subscriptions/billing endpoints;
- AI context/tool allow-list;
- automation approve/reject/run flows.

### UI tests

- desktop/mobile route coverage;
- tenant row -> detail navigation;
- profile/password/session workflows;
- billing filters and drill-down;
- approval confirmation flows;
- AI evidence links and recommendation states;
- role-aware controls.

### Visual QA

Authenticated screenshots at mobile and desktop widths for Overview, Tenant 360, Billing, Automation, and Profile.

## 22. Delivery sequence

This subsystem is implemented in slices so each release is useful and testable.

1. **Foundation hardening** — merge/retain System Admin cache fix, extend contracts/navigation, preserve dedicated-host runtime.
2. **My Account & Security** — profile, password change, own sessions.
3. **Tenant 360** — rich tenant detail UI and lifecycle actions.
4. **Plans & Subscriptions** — plan CRUD, entitlement management, subscription transitions.
5. **Platform Billing Ledger** — invoices, payments, refunds, reconciliation views.
6. **Admin Users & RBAC** — platform-user lifecycle and last-SUPER_ADMIN invariant.
7. **Attention Engine** — deterministic attention rules and command-center metrics.
8. **AI Operations Copilot** — grounded question/answer, explanations, insight cards, daily briefing.
9. **Automation & Approvals** — policies, execution classes, approval queue, run history.
10. **Provider integrations and advanced analytics** — payment adapters, notifications, churn/revenue forecasting after enough authoritative history exists.

## 23. Explicit non-goals for this implementation cycle

These limits apply to the **System Admin V2 implementation plan only**. They do not remove tenant/user AI from the TradeOS roadmap; Workstream B below is mandatory follow-on scope.

- replacing tenant/business operational pages inside System Admin;
- allowing AI to autonomously refund money, suspend tenants, change plans, revoke administrators, or alter permissions without the required approval class;
- building a general-purpose chatbot with unrestricted database access;
- deleting tenant operational history;
- hard-coding Hubtel as the only billing provider;
- attempting predictive churn/profit models before enough trustworthy platform history exists;
- implementing tenant-facing operational AI inside the **same** System Admin implementation plan.

## 24. Committed Workstream B — tenant/user intelligence and automation

TradeOS tenant users must receive the same product philosophy as System Admin: easy to understand, rich in capability, proactive, mobile-first, and AI-assisted without surrendering accounting correctness or role controls. This is a committed implementation track, not an optional future idea.

Workstream B will be specified and implemented as its own subsystem because tenant operations have different permissions, offline behavior, accounting invariants, branch context, and user roles. It will reuse the platform patterns for evidence, recommendations, approval classes, automation runs, idempotency, and audit where appropriate.

The tenant/user scope includes at minimum:

- **Owner/manager daily briefing** — sales, cash, stock, receivables, payables, unusual events, and prioritized next actions;
- **natural-language business queries** — questions such as “what sold best this week?”, “who owes us money?”, “what stock should I reorder?”, and “why is cash lower than expected?”, answered from authoritative business data;
- **cash-flow and working-capital intelligence** — forward-looking cash pressure, overdue receivables/payables, expected inflows/outflows, and explainable recommendations;
- **inventory intelligence** — reorder suggestions, slow/dead stock, stockout risk, unusual consumption/wastage, unit-conversion-aware recommendations, and supplier-aware purchase suggestions;
- **sales/customer intelligence** — trend and anomaly detection, customer follow-up opportunities, declining sales alerts, basket/product insights, and branch comparisons where authorized;
- **guided workflows** — AI can pre-fill or prepare purchase orders, follow-up tasks, expense categorizations, stock checks, customer reminders, reports, and other low-risk work, while the canonical transaction services remain authoritative;
- **role-aware automation** — owners/admins may configure business automations, while managers/cashiers/accountants see only actions appropriate to their permissions;
- **offline-aware behavior** — AI recommendations can be viewed from cached authoritative data where appropriate, but economic mutations continue through the existing durable/offline sync contracts and never bypass idempotency;
- **human approval for sensitive actions** — payments, refunds, credit changes, stock write-offs, destructive actions, user/role changes, and other high-impact mutations remain governed by existing permissions and explicit approval policies;
- **explainability and evidence** — recommendations must link to the sales, stock, cashbook, customer, supplier, or report facts that produced them;
- **simple UX** — AI appears in contextual cards, action queues, smart defaults, command/search surfaces, and concise briefings rather than forcing users into a generic chat screen for routine work.

Workstream B will have its own written design and implementation plan immediately after the System Admin V2 foundation is underway, so both tracks share primitives without coupling tenant operational logic to the platform-admin security boundary.
