# Ghana Market Pilot Readiness Design

## Intent

Prove TradeOS can survive a realistic Ghanaian SME trading journey before we put a live pilot business on it. The gate must exercise the public authenticated API across commerce, stock, credit, cash, returns, roles/offline replay and TradeOS Intelligence, then reconcile authoritative database/accounting state at the end.

## Goals

- Simulate one Ghana retail/hardware business in GHS using realistic bulk-buy/small-unit selling.
- Use phone-first owner identity so email is not required for the pilot owner.
- Cross module boundaries in one continuous tenant/branch journey rather than relying only on isolated feature tests.
- Prove sync replay/idempotency and authoritative actor binding.
- Prove purchase cost flows into inventory/COGS and returns reverse stock/revenue/payment correctly.
- Prove customer receivables and supplier payables reconcile after partial payments/refunds.
- Prove expenses/cash reporting and financial reports agree with the transaction ledgers.
- Prove AI reads the resulting business state, creates only safe internal review work, and cannot mutate economic/access ledgers.
- Produce a concise pilot-readiness result that can later be repeated against staging with synthetic pilot data.

## Non-goals / anti-goals

- No fake success by directly inserting commerce transactions that normal users must create through API/sync flows.
- No real customer data, real money, provider charges, or production tenant mutation in the automated gate.
- No weakening of the destructive-test database guard.
- No bypass of role, tenant, branch, sync or idempotency controls.
- No AI direct sale, payment, purchase, refund, stock, cashbook, staff, role or subscription mutation.
- Browser UX is a second gate after accounting correctness; it is not a substitute for ledger reconciliation.

## Approaches considered

### 1. Public-API market journey plus authoritative reconciliation — chosen

Create one integration scenario through Fastify injection and normal authenticated/sync routes. Seed only what the normal product cannot yet create through public APIs, and verify final stock, inventory value, COGS, revenue/refunds, cash, customer credit, supplier credit and AI task state directly from authoritative read models/ledgers. This catches cross-module defects and gives exact expected balances.

### 2. Keep relying on existing module-specific integration tests

Existing coverage is strong but fragmented. It can miss defects caused by sequencing valid features together in one day of trading. Rejected as the final commercial-readiness gate.

### 3. Browser-only Playwright pilot

Useful for interaction and responsive validation, but weak for proving accounting invariants and expensive to diagnose. Retained as the second-stage staging/UAT gate after the API/ledger simulation is green.

## Pilot business and journey

Use a synthetic Ghana hardware business, `Akwaaba Hardware & Building Supplies`, country `GH`, currency `GHS`, timezone `Africa/Accra`.

The owner registers and later logs in using a Ghana phone number only. The business creates a supplier, customer and a tracked product `Roofing Nails` with stock unit `lb`, purchase unit `box` (`1 box = 50 lb`) and sell unit `lb`.

The journey then:

1. receives two boxes on supplier credit;
2. repeats the receipt mutation and proves it is idempotent;
3. sells stock for cash;
4. sells stock on named-customer credit;
5. records another electronic/MoMo sale without manufacturing customer debt;
6. records a partial customer payment;
7. returns part of the cash sale with restock and validates refund/payment reversal semantics;
8. makes a partial supplier payment;
9. records a business expense through the normal cashbook/sync path;
10. attempts a rejected invalid/over-limit operation and proves no partial write occurred;
11. validates reports, inventory, receivables, payables and cashbook against the expected final state;
12. replays selected offline mutations to prove exactly-once results;
13. exercises deterministic attention/briefing/entity intelligence and creates a safe internal review task when eligible;
14. proves the AI task write leaves economic/access ledgers unchanged.

Exact transaction amounts belong in the test as constants so the expected final balances are auditable rather than inferred from the implementation under test.

## Roles and identity

- Owner registration must succeed with `phone` and no email.
- Login by normalized phone must succeed.
- Actor IDs submitted by clients for authoritative mutations are treated as untrusted and replaced server-side.
- A lower-role user must be unable to perform at least one owner/management-only action and must not receive financial AI evidence outside current-role permissions.

If creating the lower-role user requires the invitation acceptance flow, the pilot uses that public flow; it must not directly grant membership in the test unless no public route exists.

## Offline / replay semantics

The pilot sends commerce through `/v1/sync`, uses stable `clientMutationId` values, and replays representative purchase/sale/payment mutations. Replays must return the previously accepted result without duplicate sales, inventory movements, receivable/payable entries or cashbook effects.

## AI safety gate

The pilot records counts/sums for economic and access tables immediately before a safe entity review action. After creating/replaying that internal review task:

- `business_action_items` may change exactly as expected;
- sales, purchases, payments/refunds, inventory movements, cashbook, customer/supplier obligations, memberships and staff must not change;
- duplicate entity-action clicks remain idempotent;
- briefing/entity intelligence remains evidence-backed and tenant/branch scoped.

Provider-backed Ask TradeOS is not a hard gate until a real provider is configured; deterministic intelligence remains mandatory.

## Browser/staging second gate

After the branch is integrated through the canonical main-only deployer, run authenticated Visual QA plus a synthetic staging pilot covering login, dashboard, catalog, sell, inventory, customers, purchases, returns, reports, settings/team access and AI panels. Do not use real customer records or provider charges. This gate records screenshots and endpoint failures but does not replace the automated ledger gate.

## Success criteria

Pilot-ready means:

- the end-to-end market simulation is green on a clean migrated test database;
- all final accounting/stock balances match explicit expected values;
- duplicate/offline replay produces no duplicate economic effect;
- tenant/role boundaries hold;
- deterministic AI insight and safe review tasks operate without economic mutation;
- full API/Web/deployment-security suites remain green;
- staging is deployed only through the canonical guarded release path and its smoke/Visual QA gates pass.
