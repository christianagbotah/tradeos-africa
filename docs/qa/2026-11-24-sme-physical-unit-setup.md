# SME physical-unit conversion onboarding

This owner-facing guided unit setup uses the existing catalog model:
one item with named, independently priced selling units, linked by measured
per-item factors. It does NOT create an inventory adjustment, stock,
financial transaction, or manufacturing transformation.

### Ghana hardware scenarios

- **Concrete nail 3-inch:** distinct catalog item from Concrete 2-inch,
  Roofing 3-inch, Common 3-inch, Felting 3-inch. Choose Box → Pound,
  and enter the measured pounds in THIS item's box, e.g. 25.5. Enter sale
  prices per box and per pound in their unit rows. No universal pounds/box.
- **Sandpaper grade 80:** Choose Coil → Yard with the actual coil length.
  A supplier's 30-yard coil selling at yards can deduct a full coil or
  fractions thereof with one stock balance in yards.
- **Drinks:** Crate → Bottle uses actual bottles/crate, e.g. 24 if so
  configured; Bottle → Shot uses separately measured servings per bottle.
  The UnitConverter graph supports reverse conversion for partial bottles.
- **Cement:** Bag → Kilogram factor uses actual bag weight. A burst bag
  requires quarantine, recovery weigh-in and a distinct audited stock
  transformation: merely adding this factor must NOT manufacture stock.
- **Iron rods:** Tonne → Piece depends on diameter, length and material.
  Each distinct SKU needs its own measured factor. Never assume that one
  tonne has the same number of 8mm and 16mm rods.

### Implementation boundaries

On new, untouched PRODUCT forms the default blank 'each' placeholder may be
replaced with the template's two stock/sale units. The template marks one
physical stock base, enabling trackable stock and separate selling prices.
A cashier may not edit catalog data; owner/manager/inventory roles use the
existing catalog permissions.

The factor is required, not defaulted. The UI rejects malformed/nonpositive
values, duplicate conflicting factors, and edits that would silently
overwrite existing units or sale prices. When editing an item with existing
stock, no stock-unit code is automatically changed; the merchant must
confirm a valid conversion path to the preexisting stock unit before saving.
The server remains authoritative for stock-unit reachability, COGS,
valuation, sale price, identity and mutation authorization.

### Future enhancements, not part of this implementation

Multiple package sizes with different weights, expiry/batch labels,
returnable drink bottles, fractional valuation and inventory
transformations require additional end-to-end tests. Cement rebaging,
sale of goods held for later pickup, deposits and repricing are separate
accounting workflows, not part of this catalog convenience feature.

Source-only GitHub PR. No database migration, service restart, financial
posting or cutover on the protected shared VPS.
