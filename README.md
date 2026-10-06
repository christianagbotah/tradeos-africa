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
11. **Cross-platform by design.** The same business account and economic ledger must work across the web, Windows, macOS, Android and iOS without platform-specific business-rule forks.
12. **Separate control plane.** TradeOS operators/developers need a dedicated system administration portal for tenant control, subscriptions, licensing, plans, feature flags, configuration, support, monitoring and platform operations.

## Required product surfaces

TradeOS Africa is not a web-only product. The target product family includes all of the following:

- **Web business portal** — responsive browser/PWA experience for owners, managers, cashiers and staff.
- **Windows desktop application** — installable desktop client with offline-first transaction support and device integrations where needed.
- **macOS desktop application** — installable Mac client sharing the same domain/contracts and offline-sync model as Windows.
- **Android mobile application** — phone/tablet access for POS, inventory, field operations, approvals, reports and owner monitoring.
- **iOS mobile application** — iPhone/iPad access with feature parity appropriate to mobile workflows.
- **Business owner/admin portal** — tenant-level setup, branches, staff, roles, catalog, pricing, stock, suppliers, customers, reports, settings and subscriptions visible to the business.
- **TradeOS system/developer admin portal** — platform-wide control plane operated by TradeOS/Lightworld staff, separate from customer tenant administration.

All clients must connect to the same versioned API/contracts and shared business rules. Offline-capable clients must use the same durable mutation/idempotency model so switching between a Windows counter PC, Android phone, iPhone, MacBook or web browser cannot duplicate economic transactions.

## System/developer admin control plane

The system/developer portal is a first-class application and will include, at minimum:

- tenant/business provisioning, activation, suspension and closure
- subscription plans, billing cycles, trials, renewals, upgrades and downgrades
- feature/module licensing and entitlement management
- pricing, coupons/promotions and regional plan configuration
- payment-provider and subscription-payment configuration
- usage limits and metering where applicable
- tenant configuration overrides and feature flags
- supported business packs and default templates
- tax/currency/country/regional configuration
- application/version compatibility and minimum-supported-client controls
- Windows/macOS/mobile release-channel and update controls
- platform users, developer/support roles and privileged access
- audit logs for all system-admin actions
- customer-support tooling and safe tenant impersonation/access with audit controls
- sync/device health, failed-mutation diagnostics and operational monitoring
- API/integration configuration and credentials management without exposing secrets to tenant users
- announcements, maintenance notices and service-status controls
- subscription/revenue/tenant-growth dashboards

Customer business administrators must never receive unrestricted access to this platform control plane.

## Cross-platform architecture direction

The repository will remain a TypeScript monorepo with shared domain rules and contracts. Platform shells can differ, but business logic must not be duplicated independently per operating system.

```text
apps/
  web/              # responsive/PWA business portal
  api/              # transactional API + sync endpoint
  admin/            # TradeOS system/developer control plane
  desktop/          # Windows + macOS desktop shell
  mobile/           # Android + iOS mobile client
packages/
  domain/           # framework-independent business rules
  contracts/        # shared API/event schemas
  db/               # PostgreSQL schema/repositories
  sync/             # reusable offline queue/sync primitives
  ui/               # reusable UI primitives/design system
  config/           # shared lint/TS/build config
```

The intended implementation strategy is to maximize shared code:

- **Web/PWA:** Next.js/React.
- **Windows + macOS:** a desktop shell around shared React/TypeScript application modules, with native bridges only where desktop hardware/OS integration requires them.
- **Android + iOS:** a shared mobile codebase consuming the same APIs/contracts and domain-safe client libraries.
- **System admin:** a separate web application and authorization boundary, not merely hidden menus inside the customer portal.

Technology choices for the desktop/mobile shells may evolve as implementation progresses, but Windows, macOS, Android and iOS are mandatory release targets.

## Initial architecture

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
