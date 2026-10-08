# TradeOS CRUD, Master-Data Lifecycle & Professional POS Architecture

Date: 2026-10-08
Status: Approved design direction; written specification awaiting owner review before implementation planning

## 1. Product intent

TradeOS must behave like a complete business operating system, not a collection of create forms and reporting pages.

When a business user creates a product, service, customer, supplier, expense category, money account or other manageable master record, the user must be able to manage that record through its complete safe lifecycle according to role permissions. Creation is only the beginning of the workflow.

TradeOS must also provide a professional point-of-sale experience. A cashier or owner must be able to sell to a walk-in customer or a named customer, adjust cart quantities naturally, select sell units, remove lines, understand totals, choose payment methods and complete the sale confidently on phone, tablet or desktop.

The objective is to make TradeOS feel like a premium, phone-first African business OS while preserving accounting correctness, inventory integrity, offline-first operation, tenant isolation, auditability and permission boundaries.

## 2. Relationship to earlier TradeOS specifications

The following remain authoritative:

- `2026-10-07-tradeos-multipage-ux-design.md` for route-first workspace architecture and business-logic preservation.
- `2026-10-08-tradeos-2-design-system-ux-architecture.md` for TradeOS 2 visual identity, adaptive shell, typography, responsive behavior and interaction principles.

This specification extends those documents with the authoritative lifecycle model for editable business records and the authoritative Sell/POS interaction model.

PR #30 (`feat/tradeos-2-foundation-shell-dashboard`) establishes the design foundation, adaptive shell and dashboard command center that this work consumes. This work must not introduce another competing visual system.

## 3. Current-state findings

Repository audit confirms several important gaps:

- Catalog products/services currently support create + read but no first-class update/deactivate lifecycle route.
- Customers support create, read and patch with active/inactive state.
- Suppliers support create, read and patch with active/inactive state.
- Expense categories support create and patch with active/inactive state.
- Money accounts support create and patch.
- The current Sell flow keeps cart quantity internally, but provides no professional cart quantity editor.
- Named-customer selection is primarily exposed for customer-credit sales instead of being a general sale attribute.
- The current catalog UX is dominated by an add form rather than a management workspace.

The architecture must correct the system pattern, not only these individual screens.

## 4. Core principle: full lifecycle, not naive database CRUD

“Complete CRUD” in TradeOS means complete business-safe lifecycle management.

A business system must not physically delete historical entities merely because a generic CRUD acronym includes Delete. Deleting an item referenced by a sale, purchase, stock movement, refund, receivable or audit record would damage history.

TradeOS therefore distinguishes two object classes.

### 4.1 Master data

Examples:

- products;
- services;
- customers;
- suppliers;
- expense categories;
- money accounts;
- configurable future master records.

Master data supports the lifecycle operations appropriate to the record:

1. Create
2. View
3. Edit
4. Duplicate where useful
5. Archive / Deactivate
6. Reactivate
7. Permanently delete only when the record is provably unused and policy permits it

### 4.2 Posted transactions

Examples:

- completed sales;
- purchase receipts;
- customer payments;
- supplier payments;
- stock movements;
- cashbook entries;
- returns and refunds;
- money transfers;
- reconciliations.

Posted transactions are immutable business events. They are not edited or deleted after posting. Corrections happen through explicit business operations such as:

- void before final posting where supported;
- return;
- refund;
- reversal;
- stock adjustment;
- corrective payment;
- reconciliation correction.

This rule protects financial statements, inventory valuation, customer/supplier balances and audit evidence.

## 5. Shared lifecycle capability architecture

TradeOS should expose a shared capability model rather than independently deciding which buttons to show on every page.

Conceptual capabilities:

```text
EntityCapabilities
├── canCreate
├── canView
├── canEdit
├── canDuplicate
├── canArchive
├── canReactivate
├── canDeleteUnused
├── canChangeFinancialTerms
├── canAdjustStock
└── canViewAudit
```

The API remains authoritative. UI capability helpers mirror server authorization only to improve usability; they never replace server-side enforcement.

Each entity module defines:

- read roles;
- create roles;
- edit roles;
- sensitive-field roles;
- archive/reactivate roles;
- safe-delete rules;
- audit event names;
- offline support level.

Unknown roles fail closed.

## 6. Permission model

The existing business-role model remains authoritative. The implementation should preserve existing permissions unless this specification deliberately narrows an unsafe UI action.

### 6.1 Catalog products and services

Create/edit/archive/reactivate:

- OWNER
- ADMIN
- MANAGER
- INVENTORY

Read:

- all existing catalog-readable business roles.

Permanent delete:

- OWNER / ADMIN only;
- record must have no transaction, stock, recipe, purchase, sale, return or other protected references;
- otherwise TradeOS offers Archive instead.

### 6.2 Customers

General profile create/edit:

- existing customer-write roles.

Credit limit, credit terms, activation/deactivation and other credit-control fields:

- existing credit-control roles only.

Customer financial history remains immutable.

### 6.3 Suppliers

General supplier create/edit/archive/reactivate:

- existing supplier-write roles.

Payment terms and financial controls:

- existing supplier-terms roles only.

### 6.4 Expense categories

Create/edit/archive/reactivate follows current cashbook administration permissions.

Historical cashbook entries retain the category snapshot/reference even after a category is inactive.

### 6.5 Money accounts

Create/edit/activate/deactivate follows treasury administration permissions.

A money account with financial history must never be physically deleted. It can be disabled for future use.

### 6.6 Universal UI rule

A user must never see a write action that their role cannot successfully execute.

The API must still reject unauthorized direct requests with 403.

## 7. Catalog domain lifecycle

Catalog is the first major lifecycle gap and must become a true management module.

### 7.1 Catalog item model

A catalog record may be:

- PRODUCT
- SERVICE
- PREPARED_PRODUCT

Editable forward-looking properties include, subject to history rules:

- name;
- SKU/reference;
- active state;
- tax category;
- sale unit labels and sale eligibility;
- default selling prices;
- purchase unit labels and purchase eligibility;
- stock tracking configuration when safe;
- stock unit;
- unit conversions;
- future service/recipe configuration.

### 7.2 Historical safety

Completed transactions already snapshot or reference historical commercial facts. Editing a catalog item must not rewrite historical sales, purchases, COGS or return behavior.

Safe edits such as display name or future selling price apply going forward.

Structural edits become restricted when history exists. Examples include:

- changing PRODUCT to SERVICE;
- changing the stock unit after stock movements exist;
- deleting a unit used by historical transactions;
- changing a conversion in a way that would reinterpret historical quantities.

Where a structural change would invalidate history, TradeOS must either:

1. reject the change with a clear explanation; or
2. create a new forward-looking unit/configuration version while preserving historical meaning.

The first implementation should prefer the simpler safe rule: reject history-breaking structural edits and guide the user to duplicate/create a replacement item when necessary.

### 7.3 Inventory quantity is not a profile field

Users must never edit “quantity on hand” by changing the catalog record.

Stock quantity changes through explicit inventory events:

- purchase receiving;
- opening balance during initial setup;
- stock adjustment;
- damage/write-off;
- transfer;
- sale consumption;
- sales return;
- purchase return;
- service/prepared-product consumption where applicable.

This keeps inventory valuation and audit correct.

### 7.4 Archive behavior

Inactive catalog items:

- disappear from normal Sell selection;
- disappear from normal purchasing/receiving selection where appropriate;
- remain visible in history, reports and an “Archived” catalog filter;
- may be reactivated by an authorized role.

### 7.5 Delete-unused behavior

Permanent deletion is allowed only when the server proves the catalog item has no protected references.

The check must include at least:

- sale lines;
- purchase lines;
- inventory movements;
- returns/refunds;
- supplier/catalog relationships where applicable;
- service recipes/components when introduced;
- other tables with foreign/reference semantics.

If any protected reference exists, return a domain error such as `CATALOG_ITEM_IN_USE` and direct the UI to Archive instead.

## 8. Customer lifecycle

Customers are selectable business identities, not only credit accounts.

Customer edit supports:

- name;
- phone;
- email;
- non-financial profile information added later;
- active/inactive state where role permits;
- credit settings only where role permits.

Inactive customers:

- remain visible in historical sales and ledgers;
- cannot be selected for new sales or payments unless reactivated;
- can be shown with an Inactive badge in customer history.

A customer with any financial or sales history is never physically deleted.

An unused customer may be permanently deleted only if a future server safe-delete check explicitly supports it; archive/deactivate remains the normal operation.

## 9. Supplier lifecycle

Supplier edit supports:

- name;
- phone;
- email;
- address;
- active state;
- payment terms where authorized.

Inactive suppliers:

- cannot receive new purchases;
- remain visible on historical purchases, payables and reports;
- remain available for settling existing obligations if accounting rules require it, even if new procurement is blocked.

Suppliers with transaction or payable history are not physically deleted.

## 10. POS: customer model

Customer selection is independent of payment method.

### 10.1 Default sale identity

Every new sale begins as:

**Walk-in customer**

Walk-in is a UI transaction state, not a fake database customer record.

No customerId is sent for a walk-in sale.

### 10.2 Named customer

The cashier can search/select any active customer for:

- Cash;
- MoMo;
- Card;
- Bank;
- Other supported immediate payment methods;
- Customer Credit / Pay Later.

Selecting a named customer for a fully paid sale records the customer relationship so purchase history and customer analytics remain useful.

### 10.3 Credit constraint

Customer Credit requires:

- named active customer selected;
- credit enabled;
- valid credit limit/terms;
- sufficient available credit;
- currency compatibility;
- server authorization and validation.

Switching from a named credit customer to Walk-in while Customer Credit is selected automatically changes the payment flow away from credit or blocks checkout until a valid immediate method is chosen. It must never silently create unsecured credit.

### 10.4 Customer picker UX

The picker must provide:

- Walk-in as a prominent default option;
- fast search by name/phone;
- recent customers;
- clear selected-customer chip/card;
- available credit only when relevant;
- “Add customer” shortcut when role permits;
- no requirement to leave Sell merely to identify a customer.

On mobile it should open as a full-height or near-full-height sheet. On desktop it may use a popover/search panel or side panel.

## 11. POS: cart interaction model

The cart is a first-class editable object before posting.

Each cart line displays:

- item/service name;
- selected sale unit;
- unit price;
- quantity;
- line total;
- stock availability where relevant;
- remove action.

### 11.1 Quantity controls

Each line provides:

- minus button;
- direct numeric quantity input;
- plus button;
- remove action.

Touch targets must meet the TradeOS 2 mobile sizing rules.

Quantity must support the numeric behavior required by the sale unit. Integer-only units may be constrained to whole values. Fractional sell units may accept approved decimals.

Quantity cannot be zero or negative. Reducing below the minimum removes the line only after a clear interaction, not through accidental invalid state.

### 11.2 Add-item behavior

Adding the same `itemId + saleUnitCode` again increments the existing cart line.

Adding the same item in a different sell unit creates a separate line because price and stock conversion may differ.

### 11.3 Unit selection

If an item has multiple sellable units, the user can choose the unit before or within the cart.

Changing a cart line’s unit must cause the server-authoritative price/conversion rules to be used at checkout. The client must not invent accounting conversions.

### 11.4 Pricing

Displayed prices may come from the loaded catalog for responsiveness, but completed sale pricing remains server-authoritative according to the existing sale mutation contract.

No client-only override may bypass server pricing rules.

Future manual discounts/price overrides require a separate permissioned design and are not implied by this specification.

## 12. POS: checkout and payment

### 12.1 Mobile flow

The primary mobile Sell hierarchy is:

1. customer identity row;
2. search/barcode entry;
3. favourites/recent/popular or searchable catalog;
4. cart summary;
5. sticky `Charge <amount>` action;
6. checkout/payment sheet.

The cart remains accessible without forcing the user to scroll through the entire product list.

### 12.2 Desktop flow

Desktop uses a two-pane composition:

- left: search/catalog/product selection;
- right: current customer, cart, totals and checkout.

The cart pane remains visible/sticky within sensible viewport limits.

### 12.3 Payment methods

The UI exposes only methods supported by the backend and current business configuration.

Current relevant methods include:

- Cash;
- MoMo;
- Card;
- Bank;
- Other;
- Customer Credit.

The current simplified QuickSale method set must be expanded to align with the server contract rather than artificially limiting the UI.

### 12.4 Completion states

Online successful sale:

- clear success state;
- receipt/reference available when supported;
- cart resets only after local mutation acceptance is guaranteed.

Offline accepted sale:

- treated as a successful local business action;
- clear `Saved offline · pending sync` status;
- cart resets after durable local enqueue;
- synchronization happens through the existing offline queue.

Rejected sync:

- mutation is preserved for review;
- UI must not imply the sale reached the server;
- provide a clear resolution path.

## 13. Offline lifecycle architecture

TradeOS is offline-first, but not every master-data mutation should be blindly allowed offline.

### 13.1 Transaction mutations

Existing offline-safe transactional mutations such as `SALE_CREATE` continue through the current durable queue.

### 13.2 Master-data mutations

The architecture should add typed mutation contracts for offline-safe master-data operations where conflict handling is deterministic, for example:

- `CATALOG_ITEM_CREATE`
- `CATALOG_ITEM_UPDATE`
- `CATALOG_ITEM_ARCHIVE`
- `CUSTOMER_CREATE`
- `CUSTOMER_UPDATE`
- `SUPPLIER_CREATE`
- `SUPPLIER_UPDATE`

However, structural catalog edits that depend on current server history checks may require connectivity. The UI must clearly distinguish:

- available offline;
- queued offline;
- requires connection.

Do not pretend a destructive/history-sensitive operation succeeded offline when the server has not validated it.

### 13.3 Conflict/version policy

Editable master records should carry `updatedAt` and, where needed, a version/revision token.

A stale edit must not silently overwrite a newer server edit. Optimistic concurrency is required for the master-data records migrated by Slices A–C. Each editable entity must expose a server revision token (an existing reliable `updatedAt` value or an explicit revision counter). Update requests must include the expected revision. If the current server revision differs, the API returns HTTP 409 with `STALE_VERSION`.

The UI then offers reload/review rather than last-write-wins corruption. Offline queued edits preserve the revision they were based on and must surface a conflict instead of silently overwriting newer server state.

## 14. Audit requirements

Every meaningful master-data lifecycle change writes an audit event with:

- businessId;
- branchId when relevant;
- actor staff/user;
- event type;
- entity type;
- entity id;
- timestamp;
- correlation/client mutation id when applicable;
- changed fields;
- safe before/after values or structured delta.

Examples:

- `CATALOG_ITEM_UPDATED`
- `CATALOG_ITEM_ARCHIVED`
- `CATALOG_ITEM_REACTIVATED`
- `CATALOG_ITEM_DELETED_UNUSED`
- `CUSTOMER_UPDATED`
- `CUSTOMER_DEACTIVATED`
- `SUPPLIER_UPDATED`
- `MONEY_ACCOUNT_DEACTIVATED`

Sensitive values must not be unnecessarily copied into audit payloads.

## 15. API architecture

### 15.1 Catalog routes

Add first-class routes conceptually equivalent to:

```text
GET    /v1/catalog/items?businessId=...
GET    /v1/catalog/items/:itemId?businessId=...
POST   /v1/catalog/items
PATCH  /v1/catalog/items/:itemId
DELETE /v1/catalog/items/:itemId?businessId=...
```

`DELETE` is safe-delete only. It must refuse records with protected history.

Archive/reactivate may use PATCH `active` if that remains consistent with customer/supplier patterns.

### 15.2 Validation

Server validation owns:

- tenant isolation;
- role permission;
- SKU uniqueness;
- unit validity;
- conversion validity;
- structural-history restrictions;
- safe delete;
- optimistic concurrency where enabled.

### 15.3 Response shape

Mutation responses should return the authoritative updated entity so the client can refresh without reconstructing state.

Domain errors should be specific and actionable rather than generic 400 messages.

## 16. Professional Catalog UX

Catalog becomes a management workspace.

### 16.1 Page hierarchy

Desktop/tablet:

- page title and concise business context;
- search;
- Product / Service / Archived filters;
- optional stock-health filter where relevant;
- primary `Add item` action;
- responsive management list/grid;
- edit/detail side panel.

Mobile:

- compact sticky search/filter area where useful;
- clear item rows/cards;
- floating or prominent Add action;
- full-height item detail/edit sheet.

### 16.2 Catalog row/card

Show only useful information:

- name;
- Product/Service type;
- primary sale unit + price;
- stock state for stock-tracked products;
- active/inactive state;
- overflow/context action.

Do not expose database-like field density by default.

### 16.3 Item actions

Authorized actions:

- View details;
- Edit;
- Duplicate;
- Archive;
- Reactivate;
- Delete unused when eligible.

Destructive operations require confirmation that names the affected entity and explains the consequence.

### 16.4 Edit experience

Use a structured drawer/sheet rather than a tiny modal.

Sections:

- Basics;
- Selling;
- Buying/stock where relevant;
- Units & conversions;
- Tax/configuration;
- Status.

History-sensitive fields show why they are locked rather than merely disabling them without explanation.

## 17. Professional Sell UX

The current `QuickSale` visual pattern should be replaced, not cosmetically patched.

### 17.1 Design goals

- fast with one hand on phone;
- usable at a counter on desktop/tablet;
- minimal taps for common cash/MoMo sales;
- clear customer context;
- obvious cart state;
- large readable totals;
- no tiny controls;
- no generic form grid dominating the screen.

### 17.2 Search and discovery

Support:

- search by name;
- SKU/barcode-ready input architecture;
- recent/popular items when data exists;
- category/favourite architecture later without requiring a redesign;
- services and products in one coherent selling surface.

### 17.3 Cart presentation

Mobile cart may use a bottom sheet or dedicated cart state reached from the sticky total/Charge bar.

Desktop cart is continuously visible.

The user should never wonder:

- who is buying;
- what is in the cart;
- how many units are selected;
- the current total;
- which payment method will be used;
- whether the sale is saved/synced.

## 18. CRUD consistency across the rest of TradeOS

The capability/lifecycle architecture established here becomes a platform rule.

Every current and future user-manageable master-data screen must explicitly answer:

1. Who may create it?
2. Who may view it?
3. Who may edit it?
4. Which fields are sensitive?
5. Can it be archived?
6. Can it be reactivated?
7. Can an unused record be physically deleted?
8. What historical references block deletion or structural edits?
9. Is the operation offline-safe?
10. What audit event is written?

Current master-data modules expected to conform include at least:

- Catalog products/services;
- Customers;
- Suppliers;
- Expense categories;
- Money accounts;
- Money-account defaults/configuration where editable;
- later staff/branch/settings records as their management surfaces are completed.

This rule prevents future “create-only” features.

## 19. Error handling and user trust

Errors must be business-language actionable.

Examples:

Instead of:

`CATALOG_ITEM_IN_USE`

Show:

“This item has sales, purchases or stock history, so it cannot be permanently deleted. Archive it instead.”

Instead of:

`STALE_VERSION`

Show:

“This item was changed on another device. Reload the latest version before saving your changes.”

Offline and sync messages must distinguish:

- saved locally;
- synchronized;
- pending;
- rejected and needs review.

## 20. Responsive and accessibility acceptance

Use TradeOS 2 breakpoints and typography rules.

Required viewport checks:

- 360px
- 390/393px
- 430px
- 768px
- 1024px
- 1280px
- 1440px

Acceptance rules:

- no horizontal page overflow at 360px;
- mobile primary controls at least 48px high where specified by TradeOS 2;
- icon-only touch targets at least 44x44px;
- body/control text normally 15–16px on mobile;
- labels/support text generally 13–14px;
- keyboard-operable dialogs/sheets;
- visible focus state;
- Escape closes overlays where appropriate;
- focus returns to the triggering control;
- destructive confirmation is screen-reader understandable;
- reduced-motion preference respected.

## 21. Data correctness acceptance

The implementation is not complete unless the following are true:

- named customer can be attached to an immediate-payment sale;
- walk-in sale sends no fake customer id;
- customer-credit sale cannot proceed without a valid credit customer;
- cart quantity adjustments change the mutation payload correctly;
- multiple sell units remain distinguishable in the cart;
- server remains authoritative for sale pricing and inventory conversion;
- archived catalog item cannot be sold as a new line;
- historical sale/purchase/return records remain readable after catalog/customer/supplier archive;
- catalog edits do not reinterpret historical stock or accounting data;
- unauthorized role cannot execute a write via UI or direct API;
- safe-delete rejects referenced entities;
- every lifecycle mutation writes expected audit evidence;
- offline sale behavior remains durable and idempotent.

## 22. Testing architecture

### 22.1 API integration tests

Add/extend tests for:

- catalog update permissions;
- archive/reactivate;
- safe delete unused;
- delete rejection with sale history;
- delete rejection with purchase/inventory history;
- structural edit rejection after history;
- customer association on immediate sale;
- credit validation unchanged;
- tenant isolation;
- audit events;
- optimistic-concurrency conflicts for migrated master-data entities.

### 22.2 Domain/unit tests

Add tests for:

- cart line identity (`itemId + saleUnitCode`);
- quantity validation;
- role capability mapping;
- lifecycle state mapping;
- safe UI action selection;
- money and quantity formatting.

### 22.3 Web tests

Add tests for:

- Walk-in default;
- named-customer selection for Cash/MoMo/etc.;
- plus/minus/direct quantity editing;
- removal;
- unit switching;
- role-safe catalog actions;
- archive/reactivate flows;
- edit-sheet accessibility;
- mobile sticky Charge behavior;
- offline/pending-sync states.

### 22.4 Regression gates

Before integration:

- full web test suite;
- API integration suite against isolated TradeOS CI PostgreSQL;
- domain tests;
- repository typecheck;
- repository lint;
- production web build;
- `git diff --check`;
- manual responsive UAT on key roles and viewports.

## 23. Delivery decomposition

This architecture is intentionally larger than a one-page change. Implementation should be delivered in coherent vertical slices without changing the architectural rules.

### Slice A — lifecycle foundation + Catalog CRUD

- shared capability helpers;
- catalog read/detail/update/archive/reactivate/safe-delete API;
- audit and history guards;
- professional Catalog management UX;
- edit/detail sheet;
- tests.

### Slice B — professional Sell/POS

- new POS composition;
- Walk-in/named customer model;
- customer picker;
- editable cart quantities;
- sell-unit selection;
- expanded payment-method UI aligned with server contract;
- mobile sticky Charge + desktop two-pane layout;
- offline preservation;
- tests.

### Slice C — lifecycle completion for existing master-data modules

- customers;
- suppliers;
- expense categories;
- money accounts;
- consistent archive/reactivate/permission/action UX;
- safe-delete only where domain-safe;
- audit consistency.

### Slice D — platform rollout

Apply the same lifecycle checklist to subsequent staff, branch, settings and future master-data surfaces as those modules are completed.

Slices A–C together constitute this implementation program. Slice D is the standing architecture rule for future module work.

## 24. Explicit non-goals for this program

The following are not silently included:

- arbitrary editing/deleting of posted transactions;
- client-side accounting recalculation;
- manual sale-price override/discount authorization redesign;
- loyalty program;
- promotions engine;
- barcode hardware integration beyond barcode-ready search architecture;
- new AI features unrelated to CRUD/POS;
- rewriting the backend or replacing the existing offline-sync architecture.

These may be designed separately when needed.

## 25. Definition of done

This program is complete when:

1. TradeOS has a reusable permission-aware master-data lifecycle pattern.
2. Catalog products/services can be professionally viewed, edited, archived, reactivated, duplicated and safely deleted when unused.
3. Customers and suppliers expose complete lifecycle actions consistent with permissions and history safety.
4. Existing editable expense categories and money accounts conform to the same interaction language.
5. Sell supports Walk-in or named customer independently of immediate payment method.
6. Cart quantities are directly adjustable and sale units are handled correctly.
7. Mobile Sell feels like a native business POS rather than a form page.
8. Desktop Sell uses an efficient two-pane counter workflow.
9. Offline transaction safety is preserved.
10. Audit, authorization, inventory and financial history remain correct.
11. All required automated gates pass.
12. Responsive UAT confirms a professional TradeOS 2 experience at the target widths.
