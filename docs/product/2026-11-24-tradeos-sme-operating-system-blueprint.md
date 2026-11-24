# TradeOS Africa — multi-industry SME operating system

Status at 2026-11-24: product blueprint with a specific implemented enhancement
(price-button creation for prepared items/services). Other workflows listed
below are requirements and staged acceptance tests, NOT claims that the
serving website, mobile binaries or API already support them. All financial
flows must be independently verified before being enabled.

## Core design principles

One accounting, identity, audit, inventory and payments foundation across
tenants, businesses, branches and devices, with an operating mode appropriate
to the business. Configuration is owner/manager controlled, while a cashier
has a restricted POS role. No user needs to learn the whole ERP to make a sale.
Support offline queue idempotency and explicit pending/failed confirmations;
authoritative prices, inventory, receipts, taxes and balances come from the
backend. Never confuse local capture with provider payment settlement.

Use an active-branch currency (Ghana displays ₵) and provide localized names,
units, tax and payment integrations. Business owners set item names and
prices: never force a hardcoded food or product name into the application.

## Vertical configuration, entry flow and receipt/report implications

| Mode | Catalog and transaction | Day close, exception handling |
| --- | --- | --- |
| Waakye/food stall or market vendor | Owner names items (Waakye, Fish, Gari, Egg, Salad) and configures price-button amounts, e.g. Waakye 10/12/15/20/30, Fish 10/15/20. Clerk taps item/price, again for quantity two, sees total, records cash, advances to next person. Preserve canonical line item/unit/quantity and server price. | Cash vs MoMo vs credit by method; shift cash count, refund/void audit, ingredient recipe/cost optionally later. |
| Hairdresser or salon | Services (braiding type, washing, treatment), optional products, stylist assignment, appointment and walk-in; service start/finish, repeat clients and commission; deposits for bookings. | Staff commission/payroll, daily service revenue and product COGS, chair occupancy, appointment cancellations/refunds. |
| Barber | Tap Haircut/Beard/Line-up and optional add-ons, record barber and tender in seconds; chair and walk-in queue. | Tips, staff earnings, shift reconciliation and cash drawer discrepancy. |
| Provision/grocery | Barcode or text/voice SKU search, size/pack variants, quantities, prices, expiry/lot optionally, returns. | Margin/stock reorder, expiry/write-off, purchases and payables. |
| Hardware/building materials | Distinct items by nail type AND length: Concrete 3in, Common 2.5in, Roofing 4in etc. Stock base unit pounds or individual pieces; only allow box to pound with an explicit per-product conversion. Sandpaper coil to yards must record actual coil length, rod ton to length based on configured stock specifications. | Prevent double-counted sales by box/pound, fractional quantities, cost allocation, wastage and stocktake. |
| Cement distributor | Bag lots, broken or damaged bags, repack/transfer with explicit before/after quantities and valuation; optional batch/expiry/supplier. | Rebag loss, packing material cost, lot traceability, loss vs saleable recovered stock. |
| Drinking spot | Crate to bottle, bottle to glass/shot where measured conversion is configured; optional empty-bottle returnables/deposits and staff shift. | Bottle-stock reconciliation, bar tabs, spillage/breakage, glass-level revenue. |
| Restaurant or café | Counter/self-service/table order, modifiers and allergy notes; paid vs unpaid ticket; route by station to KDS (kitchen, grill, bar). Staged statuses: new/accepted/preparing/ready/served/closed/cancelled. | Kitchen time, waiters/table bills, cancellations/returns, pickup screen and optional order-number announcement. |
| Car wash, parking, laundry and repair | Service SKU with dimensions/duration, job/ticket status, deposits, pickup, staff assignment; proof of service. | Deferred services, daily shift cash, resources and performance reports. |

## Explicit acceptance examples (future end-to-end tests)

1. **Food seller / 22 people**: A cashier with only sales permission opens
   Quick Serve. Tap Waakye ₵10, Gari ₵2, Salad ₵2, Egg x2 at the configured
   per-egg price, Fish ₵20. Show the correct number and sum. A second fish
   button creates a separate line with independent itemId/unitCode. Attempt
   sale with an ambiguous server acknowledgement: DO NOT clear current order.
   Retry the same mutation id; one sale only. A durable offline capture
   advances the customer only with a pending-sync label.
2. **Nails**: A 3-inch concrete nail has two actual physical sale units,
   pound and box. Owner configures that particular box's pounds per box;
   the sale of one box and two pounds decrements the same inventory in
   pounds and values each sale using proper conversion/COGS. No universal
   1 box = N pounds assumption.
3. **Sandpaper**: The owner defines a coil with 30 yards and has two coils in stock;
   selling 2 yards and then 1 full coil must decrement 32 yards from
   correctly configured 60-yard stock. Reject inadequate stock, partial loose coils and invalid factors
   under a controlled inventory policy.
4. **Cement broken-bag transformation**: Start with 10 intact bags and a
   damaged bag. Quarantine the damaged one; inspect recorded recoverable
   weight. Create recovered saleable stock from exact weight, material
   inputs and documented loss, with paired quantity/value movements,
   immutable audit and no arbitrary creation of inventory value.
5. **Unallocated advance**: Customer pays ₵100 without selecting products.
   Create a customer-deposit LIABILITY, linked to the receipt and payment
   method. Do not report as sale revenue. Later allocate all or part against
   actual orders, or refund the unused portion with independent approval
   and provider reversal where applicable.
6. **Cement later pickup**: Customer orders 10 bags, pays deposit, and
   picks up in 3 trips. Sales order, stock reservation and pickup tickets
   stay distinct. Owner policy chooses:
   A fixed-price commitment with expiry; or
   B floating-price reprice at pickup; or
   C shared price-difference adjustment (customer vs merchant). Explicitly
   record consent, who bears the adjustment and tax/COGS effects.
   Never retroactively alter an issued receipt or silently release goods.
7. **Restaurant**: Counter ticket R-00123 with optional customer display
   name moves to KITCHEN/GRILL/BAR; bar completes independently, expediter
   marks READY, a connected pickup monitor shows R-00123 and optionally
   uses text-to-speech to call it. Offline/duplicate synchronization must
   not ring twice or reissue meal preparations.
8. **Staff/shift**: Cashier sees POS and own shift only; cannot edit
   prices, issue privileged refunds, view other branches' bank activity
   or administer users. Supervisor reviews returns, overrides, drawer
   differences and staff settlement. Every act is audited.

## Credits, deposits and layaway are distinct financial products

- **Credit sale:** delivered goods and a receivable due by customer. Authorize
  credit limit, due date and collections; no hidden wallet.
- **Unallocated deposit/advance:** cash/bank/MoMo received before SKU/order
  choice; customer liability until used or refunded.
- **Order deposit:** payment allocated to a defined order. Shipment/pickup
  is independent from receipt, and delivery may be partial.
- **Stock reservation:** stock earmarked for an order but not necessarily
  owned or paid in full. Separate on-hand, reserved and available.
- **Variable-price agreement:** signed terms for expiry, owner approval,
  floating price and pro-rated sharing of increases. Ledger adjustments
  must be append-only, never overwrite original deposits/receipts.

## What exists in the source vs remaining implementation

Evidence from GitHub main source as of this plan:
- Existing source foundation: tenant/business/branch session scope; role
  list (OWNER, ADMIN, MANAGER, CASHIER, SALES etc.); canonical priced catalog
  units and conversions; sale create/stock valuation; returns/refunds;
  customer-account credit payments; inventory adjustment/quarantine/damage;
  cashbook; financial reports; offline POS queue and web/native Quick Serve.
- This PR: owner-configured comma-separated price-button generation for
  PREPARED_PRODUCT and SERVICE without touching real product conversions.
  It uses the existing CATALOG_ITEM_CREATE/UPDATE transaction pathway.
- Not certified complete: independent liability accounting for unallocated
  customer deposits, partial pickup/price-policy contracts, stock
  transformation/rebag manufacturing, recipe-level prepared food stock, bar
  bottle returns, per-worker salon commissions and appointments, KDS
  production state machine, pickup TTS, table inventory and CCTV occupancy.

## Phased implementation order

P0: Complete price-button setup and rapid verified sale experience. Validate
      cashier access, return/credit permissions, shift count and offline retry.
P1: Physical-unit sector presets (box→pound, coil→yard, crate→bottle→shot)
      with explicit per-item conversions and tests against accounting/stock.
P2: Customer liability deposits, reserved order stock, partial pickups, three
      price-policy options, signed policy history and partial refunds.
P3: Rebag and inventory transformation with batch/cost/waste allocation,
      plus complex bar containers/returnables.
P4: Restaurant order management, kitchen station queue, customer pickup
      display, configurable sound/TTS, allergy and dispatch tracking.
P5: Appointments and chairs for salon/barber; commissions, staff shifts and
      mobile service tickets; remaining verticals.
P6: Advanced AI forecasting, bilingual/voice search, dynamic replenishment
      and low-intrusion occupancy indicators, with human verification.

## CCTV table availability: optional and privacy-limited

The preferred v1 table signal is waiter seating/clearing, customer QR check-in
or a table sensor, not face identification. If optional CCTV analysis is
added: require owner configuration, lawful privacy notices and approval,
local processing where practicable, minimal retained footage, access
controls, no individual identity or demographic inference, and staff
confirmation before showing "available". A camera can misread an obstructed
chair; it must not allocate or charge a table automatically. Security/privacy
requirements must be reviewed in each operating country, including Ghana.
