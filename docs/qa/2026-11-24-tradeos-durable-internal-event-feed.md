# TradeOS — durable internal outbox consumer (opt-in, default OFF)

## Purpose and accounting boundary

The app commits real SALE_COMPLETED, PURCHASE_RECEIVED, refund, treasury and
other business events to outbox_events in the same transaction as canonical
accounting. Previously no worker consumed these events, and an old backlog
remained unpublished even though the actual sales were already posted.

This change makes a **real, queryable, durable local subscriber**:
business_event_feed. The worker only acknowledges outbox published_at after
a matching immutable event receipt has been inserted to the feed in the same
PostgreSQL transaction. This is NOT a dummy "mark delivered" operation.

Feed rows contain only tenant/branch scoped event metadata and aggregate UUIDs:
no original raw provider payloads, customer names, payment tokens, amount
claims, personal contact details, secret keys or refund provider status.
A protected GET /v1/intelligence/activity-feed?businessId=UUID&branchId=UUID
lists the last 50 feed events. The owner/admin/manager/accountant role, active
business membership and active branch are verified before query. Tenant-
level (null branch) events are visible to authorized tenant readers; cross-
tenant events are never visible. No public access or notification send occurs.

Only internal feed durability is acknowledged. published_at means the event
has been captured in the primary in-app subscriber; it does NOT imply
third-party webhook/SMS/email delivery, bank settlement, MoMo receipt,
merchant action completion, or offsite backup. Future external subscribers
MUST keep their own event-id keyed durable cursor/ack, reading the immutable
internal feed, not rely on reusing published_at as an external-provider ack.

## Fail-closed semantics

- Worker starts ONLY when TRADEOS_OUTBOX_INTERNAL_FEED_ENABLED=true; it is
  disabled by default even when server.ts imports it. Do not enable this flag
  during ordinary deployment.
- Each tick selects at most 25 unpublished events by occurred_at/id using
  FOR UPDATE SKIP LOCKED and a single DB transaction. Replicas can cooperate.
- Each selected event is inserted into business_event_feed, unique by original
  outbox_event_id. A trigger rejects mismatched tenant/branch/aggregate/type/
  occurrence fields and forbids UPDATE/DELETE of delivered rows.
- A locked source may get published_at only when an identical, committed
  internal subscriber row exists. Row-count mismatch, constraint failure,
  dead connection or worker exception rolls back both insert and ack.
- No external network call, provider action, receipt, financial posting,
  refund status update or user notification is generated.
- A failed tick is logged with just an error class, not the event body.
- Unknown event types remain metadata-only; no replay of original sale
  mutations, stock movements or payments occurs.
- The read endpoint rejects unauthenticated, cross-tenant, suspended or
  unauthorized users and does not return raw outbox payloads.

## Certification and staged activation

The protected CI migrations and integration suite must pass first. Before
activating on staging, establish a verified offsite recovery target and a
successful independent restore rehearsal, preserve existing immutable app
releases, and use the signed CI-built artifact promotion and rollback process.
Then inspect the historical outbox records read-only, authorize the internal
feed destination, enable with a reversible environment change, run one
bounded tick under controlled supervision and verify:

1. identical event ids and tenant/branch/aggregate identity in source/receipt;
2. 1 receipt per source id, with committed published_at only for delivered rows;
3. zero mismatched or silently dropped events;
4. tenant/role authorization for the GET activity feed;
5. all financial pending states and payment ledger unchanged; no refund/Hubtel
   verification or settlement issued by the worker;
6. stop/restart and duplicate-tick replay does not create duplicate receipts.

CI alone cannot certify the current shared production/staging database. The
last read-only database audit found 3 historical undelivered events (2 sale,
1 purchase); this PR does **not** process those records, change financial data,
or authorize a release. Keep issue #218 and cutover issue #204 open until
post-deployment operational evidence exists.
