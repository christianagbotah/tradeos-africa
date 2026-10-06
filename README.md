# TradeOS Africa

**An offline-first, AI-assisted operating system for African businesses — from one-person microbusinesses to multi-branch SMEs.**

TradeOS Africa is being designed for businesses such as provision shops, hardware/building-material shops, barber shops, ladies' salons, washing bays, car parks, waakye/chop-bar operators, drinking spots, wholesalers and distributors.

## Product principles

1. **Simple enough for a microbusiness, powerful enough for a growing SME.**
2. **Offline-first.** Selling and recording work must continue through connectivity outages and sync safely when online.
3. **Business-language UX.** Users should not need accounting terminology to run their business.
4. **One economic ledger.** Sales, purchases, stock movements, services, recipes, payments, refunds, returns, commissions and credit must reconcile through auditable transactions.
5. **Flexible units.** A business can buy in one unit and sell in another: crate → bottle, bottle → glass/shot, sack → kg/bowl/portion, box → lb/kg, coil → metre/yard, tonne/bundle → piece/cut length.
6. **Services can consume inventory.** A haircut, salon treatment or vehicle wash can automatically consume blades, shampoo, chemicals, packaging or other consumables.
7. **Recipes/yields are first-class.** Prepared foods and transformed stock can be costed from ingredients, expected yield, portions, wastage and actual usage.
8. **Returns and refunds are first-class.** Full/partial refunds, sales returns, exchanges, damaged/non-restockable returns, service refunds and payment reversals must correctly reverse money, tax, stock, COGS, customer balances and commissions.
9. **AI explains the business.** Insights should use clear language: profit, cash shortages, stock-outs, unusual wastage, credit risk, pricing and demand — not accounting jargon.
10. **Ghana first, Africa/global capable.** Currency, taxes, payments, units, languages and regulatory integrations are tenant-configurable.

## Initial architecture

This repository will use a TypeScript monorepo with clear domain boundaries:

```text
apps/
  web/              # responsive/PWA business app
  api/              # transactional API + sync endpoint
packages/
  domain/           # framework-independent business rules
  contracts/        # shared API/event schemas
  db/               # PostgreSQL schema/repositories
  ui/               # reusable UI primitives
  config/           # shared lint/TS/build config
```

The first implementation slice is the **commerce kernel**:

- unit families and conversions
- products, variants and sellable units
- stock lots and inventory movements
- service definitions and consumables
- recipes/yields and transformations
- sales and payments
- returns/refunds/exchanges
- append-only audit events and idempotency

## Return/refund invariants

A refund is not simply a negative sale. TradeOS distinguishes the commercial and physical events:

- **refund without return** — money is refunded but stock does not return (e.g. service complaint)
- **return + refund** — customer returns stock and receives money
- **return + store/customer credit** — stock returns but money is held as credit
- **exchange** — returned item and replacement item are linked in one workflow
- **non-restockable return** — returned quantity is quarantined/damaged instead of available stock
- **partial return/refund** — only selected lines/quantities are reversed

Every flow must be idempotent and retain the original sale, actor, reason, approvals and payment reversal status.

## Status

Initial build started October 2026. The repository is being bootstrapped around the domain model before UI vertical packs are layered on top.
