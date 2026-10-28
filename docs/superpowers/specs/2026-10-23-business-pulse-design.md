# Business Pulse Design

## Intent

Make TradeOS proactively surface important business changes without forcing users to visit Dashboard, Reports, Inventory, Customers, or Purchases to discover them. Business Pulse is a global, evidence-backed attention surface built from existing tenant attention and action-item data; it is not a second notification engine and it never performs economic or access mutations.

## Goals

- Add a global Pulse entry in the workspace shell with an unseen badge.
- Merge currently authorized open attention signals and current-role-visible review tasks into a concise feed.
- Persist only a per-user/per-business/per-branch last-seen cursor so unseen state follows the user across web/desktop/mobile sessions.
- Preserve current role, tenant, branch, and evidence filtering on every read.
- Let users mark the pulse as seen by opening it; the server owns the seen timestamp.
- Keep links navigation-only and reuse canonical workflows.
- Degrade explicitly when offline or unavailable without blocking core TradeOS workflows.

## Non-goals

- No email, SMS, WhatsApp, OS push, mobile push, or browser notification permissions in this slice.
- No new AI/provider requirement; Pulse must work when OpenAI is unavailable.
- No copied notification/event rows for every attention or task change.
- No autonomous sale, payment, refund, purchase, inventory, cashbook, staff, role, membership, subscription, or access mutation.
- No list-row intelligence fan-out.

## Approaches considered

### Browser-local last-seen timestamp
Simple but inconsistent across devices and easy to lose. Rejected because TradeOS targets desktop, web and mobile.

### Full notification event/outbox table
Powerful for future delivery channels but duplicates authoritative attention/action records and adds premature delivery semantics. Deferred until mobile/push channels are implemented.

### Server cursor + synthesized Pulse — chosen
Store only the user's last-seen cursor for a business/branch. Synthesize Pulse from existing attention and action-item services on every read, preserving their current role/evidence rules. This is cross-device, minimal, deterministic and avoids a parallel notification domain.

## Data model

Migration `0025_business_intelligence_pulse.sql` creates `business_intelligence_pulse_state` with business, optional branch, user, `last_seen_at`, created/updated timestamps, branch/business consistency, and one state row per user/business/branch using a null-safe unique index.

No attention titles, task evidence, financial values, or model output are copied into this table.

## API

`GET /v1/intelligence/pulse?businessId=&branchId=&limit=` authenticates the user, resolves the current business role, loads role-filtered open attention plus the existing role-filtered action queue, and returns:

- `generatedAt`, `lastSeenAt`, `unseenCount`
- attention summary counts by severity
- bounded `attentionItems`
- bounded `actionItems`

An attention item is unseen when its `lastSeenAt` is later than the cursor. An action item is unseen when its `createdAt` is later than the cursor. Only active attention and active (`OPEN`/`SNOOZED`) action items are included.

`POST /v1/intelligence/pulse/seen` accepts only `businessId` and `branchId`. The server records `now()` and returns the new cursor. Client-supplied timestamps are rejected.

## UX

AppShell adds one global `Pulse`/bell-style button with a numeric badge when `unseenCount > 0`. Opening it shows a mobile-friendly drawer with two sections: “Needs attention” and “Review tasks”. Each row has concise title/context and a safe canonical workflow link. Opening the drawer marks the pulse seen only after a successful live fetch.

Offline state is explicit: the drawer says fresh Pulse data requires reconnection; core offline workflows continue. No seen mutation is queued offline.

## Security and privacy

- Pulse reuses `listBusinessAttention` and `listBusinessActionItems`; it does not bypass their role/evidence filtering.
- Current-role changes immediately affect visible items and evidence.
- Forged business/branch IDs are rejected before data is returned.
- Seen state is scoped by authenticated user + business + branch.
- Client cannot inject item content, severity, evidence, timestamps or action types.

## Performance

One lazy Pulse GET per shell/context refresh/open, bounded item limits, no LLM call, no list-row calls. A seen POST occurs only when a live Pulse is opened and the fetched snapshot has content/newness worth acknowledging.

## Testing

- Migration constraints and null-safe uniqueness.
- API integration for tenant/branch isolation, current-role visibility/evidence, unseen math, idempotent seen cursor, and client timestamp rejection.
- Web contract for global badge/drawer, online-only seen POST, context switching, offline copy, safe navigation and no economic mutation endpoint.
- Full API/Web tests, typechecks/builds, migration validation, VPS contracts, CI and Visual QA.
