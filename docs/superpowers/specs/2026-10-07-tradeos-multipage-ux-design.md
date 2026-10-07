# TradeOS Multi-Page UX Design

Date: 2026-10-07
Status: Proposed for implementation after owner review

## Purpose

TradeOS must stop behaving like a single long dashboard page. The logged-in product should feel like a modern business operating system with real page-level navigation, a stable application shell, clear module boundaries, and professional responsive layouts.

The redesign must preserve existing business behavior: authentication, business and branch context, offline-first mutation queues, permissions, reporting calculations, POS, purchases, inventory, operations, cashbook, customer credit, catalog units, returns/refunds, and treasury logic.

## Current problem

The current `BusinessWorkspace` renders Financial Reports, Quick Sale, Purchases & Inventory, Operations, Cashbook, Customers & Credit, Catalog, and Returns sequentially inside one page. Sidebar items are anchor links such as `#cashbook`, not real routes. This creates very long pages, weak information hierarchy, expensive rerenders, awkward mobile behavior, and makes module-specific UX difficult.

The Cashbook & Expenses screen demonstrates the visual problem most clearly: filters, summary figures, entry fields, category creation, treasury, movements and expenses are all stacked into one generic panel and share the broad `.form-row` utility. This produces large empty gaps, browser-default form styling, inconsistent alignment and poor scanability.

## Approaches considered

1. **Restyle the existing single page.** Fastest, but it preserves hash navigation, long-page rendering and weak module boundaries. Rejected because it does not satisfy the requirement that TradeOS stop being a single-page workspace.
2. **Rewrite every module while introducing routes.** Produces a clean slate but creates unnecessary functional risk across sales, inventory, returns, credit and offline behavior. Rejected because too much proven business logic would be replaced at once.
3. **Route-first progressive extraction.** Introduce the shared shell and real routes, preserve existing business logic, then modernize each route's composition and visual system. Selected because it removes the single-page architecture immediately while controlling regression risk.

## Chosen architecture

Use Next.js App Router route-level pages behind one authenticated shared application shell.

The shell owns business-wide context and navigation. Individual route pages own module presentation. Existing domain components should be preserved and progressively adapted rather than rewritten wholesale. Existing combined components such as Purchases/Inventory and Sales/Returns may be split into route-specific presentation wrappers and shared hooks, but their mutation/API logic must remain single-sourced.

### Route map

- `/dashboard` — business health, CFO actions, KPIs, working capital, cash forecast and recent activity.
- `/sell` — dedicated POS / quick-sale workspace.
- `/sales` — transaction history, receipts, sale drill-down and settlement status.
- `/customers` — customers, receivables and credit.
- `/purchases` — suppliers, purchasing and receiving.
- `/inventory` — stock, valuation, movement and adjustments.
- `/catalog` — products, services, pricing and unit conversions.
- `/returns` — returns, refunds and exchanges.
- `/cashbook` — cashbook, expenses and treasury.
- `/operations` — operating days, shifts and reconciliation.
- `/reports` — financial and operational reports and AI-assisted business intelligence.

The root authenticated entry should redirect to `/dashboard`. Public login and first-business setup remain outside the application shell.

## Application shell

The desktop shell uses a fixed/collapsible navy sidebar and a sticky top bar. The sidebar uses grouped, role-aware navigation rather than one flat list. The top bar contains page title/breadcrumb, business selector, branch selector, sync/offline status, attention/notification affordance, and user menu.

Tablet uses a compact collapsible rail/drawer. Mobile uses a top app bar plus drawer or bottom-priority navigation for the most important destinations. The content area must never rely on a 300px+ fixed sidebar that squeezes forms into narrow columns.

Navigation state comes from the active route, not hard-coded `active` CSS on Overview.

## Shared workspace state

Create one authenticated workspace provider responsible for:

- current session and memberships;
- selected business and branch;
- role and staff context;
- catalog/sellable-item cache where shared;
- network/offline status;
- global refresh/invalidation helpers.

Route transitions must not log the user out, recreate the business context unnecessarily, or clear pending offline mutations.

## Visual system

TradeOS should use a restrained premium business-OS visual language:

- deep navy/slate navigation;
- warm gold/amber accent for primary actions and important status;
- soft neutral page background;
- white elevated cards with subtle borders and restrained shadows;
- 14–18px card radii;
- 14–16px readable body text;
- 20–32px page and section headings;
- 44–48px minimum interactive control height;
- consistent 8/12/16/24/32px spacing rhythm;
- clear positive, warning and negative states without excessive color;
- no raw browser-default buttons, selects or text fields;
- no decorative gradients unless they communicate hierarchy.

Controls must use consistent label-above-field treatment. Related fields should be grouped into responsive grids rather than arbitrary flex rows.

## Cashbook & Expenses page

Cashbook is the first reference implementation for the new page system.

### Page header

The page header contains:

- title: `Cashbook & expenses`;
- subtitle explaining money movements and offline availability;
- pending-sync badge/status on the right;
- optional contextual action if the role permits entry creation.

### Filter toolbar

A compact toolbar contains Method, From, To and Today on one row at desktop widths. Controls wrap predictably on tablet and become full-width/2-column on small screens.

### Summary cards

Display four KPI cards:

- Inflow;
- Outflow;
- Net movement;
- Pending/offline entries.

Per-payment-method totals should appear in a compact secondary summary strip/card group, not mixed into the form.

### Record money movement card

For roles allowed to create entries, render a dedicated `Record money movement` card.

Desktop uses a two-column form grid with labels above controls. Mobile collapses to one column.

Recommended field arrangement:

1. Entry type | Amount
2. Payment method | Money account
3. Category | Payee
4. Provider | Provider reference
5. Description / required explanation — full width
6. Primary `Save entry` action aligned consistently

Balance-adjustment mode keeps its explanatory copy close to the reason field and preserves current automatic sign handling.

### Expense category management

Category creation moves into a small secondary card, separate from the transaction form. Input and `Add category` sit on one row on desktop. Online-only availability is communicated with concise helper text/status, not a disabled browser-looking control with no context.

### Treasury

Treasury remains functionally intact but is visually separated into its own section/card below entry creation. It should use the same form and card primitives as the new Cashbook layout.

### History

Recent movements render in a dedicated data card with a responsive table, sticky header where practical, readable amount alignment, and horizontal scrolling only when necessary.

Recent expenses render as a proper table/list card with category, description/payee, payment method, amount and date instead of unstructured paragraph rows.

Empty states must explain what will appear and provide the relevant action when the user has permission.

## Reuse strategy

Do not duplicate business logic across route pages. Existing functional components should be refactored into page-friendly sections or hooks where necessary. The first goal is to move stable capabilities behind real routes, then improve each module's page composition.

Generic CSS such as `.form-row` should no longer control complex module layouts. Introduce reusable primitives such as:

- `PageHeader`;
- `PageToolbar`;
- `StatCard` / `StatGrid`;
- `FormCard`;
- `FormGrid`;
- `Field`;
- `DataCard`;
- `EmptyState`;
- `StatusBadge`;
- `ResponsiveTable`.

Primitives should be presentational. Domain behavior remains in feature components/hooks.

## Role-aware navigation

The shell must hide or de-emphasize destinations a role cannot meaningfully use, while backend authorization remains authoritative. At minimum, Owner/Admin/Manager can see all licensed business pages, while Cashier, Sales, Inventory, Accountant, Staff and Viewer receive a relevant subset.

This is presentation logic only; route protection must still validate session/business/role on the server or API boundary.

## Responsive behavior

Desktop target: 1280px and above.
Tablet target: 768–1279px.
Mobile target: below 768px.

No page may overflow the viewport horizontally because of fixed-width grids. Forms collapse from 2 columns to 1 column when needed. KPI grids reduce columns progressively. Tables may scroll inside their own container rather than widening the whole page.

The sidebar becomes a drawer/compact navigation on mobile; content should use the full available width.

## Accessibility

- Every form control has an explicit label.
- Keyboard focus is visible and consistent.
- Touch targets meet comfortable minimum size.
- Status is not communicated by color alone.
- Tables keep accessible headers.
- Navigation marks the active route with `aria-current="page"`.
- Offline/sync status uses text plus icon/status treatment.

## Migration sequence

1. Introduce shared workspace provider and multi-page app shell.
2. Add route structure and active-route navigation without changing underlying business APIs.
3. Move Dashboard and Cashbook first.
4. Modernize Cashbook using the new primitives.
5. Move Sell, Sales, Customers, Purchases, Inventory, Catalog, Returns, Operations and Reports one by one.
6. Remove the legacy all-modules `BusinessWorkspace` only after every route has parity.

During migration, there must never be two independent implementations of business mutations. Route pages reuse existing logic or extracted shared hooks.

## Testing

### Unit/component

- route-to-navigation active state;
- role-aware nav visibility;
- business/branch context preserved across route changes;
- cashbook filter behavior;
- cashbook mode-specific fields;
- category creation states;
- offline pending/error states;
- responsive class/layout contracts where practical.

### Integration

- demo OWNER can navigate all primary routes;
- demo CASHIER can reach Sell/Cashbook-relevant pages and cannot access unauthorized management actions;
- demo VIEWER remains read-only;
- business and branch switching persists while navigating;
- existing mutation queues continue to work after route changes.

### Visual/manual

Verify desktop, tablet and mobile widths for dashboard, cashbook and one data-heavy page. Confirm there are no raw browser-default controls, no clipped cards, no unintended horizontal page scrolling, and no giant empty form gaps.

## Acceptance criteria

The redesign is complete when:

- authenticated TradeOS uses real URL routes, not sidebar hash anchors, for its major modules;
- the root workspace is no longer one page containing every module;
- the app shell persists across route changes;
- the Cashbook page matches the professional layout described above;
- all existing Cashbook behavior remains functional;
- desktop/tablet/mobile layouts are usable without horizontal page overflow;
- role-aware navigation works for demo roles;
- offline queue/session/business/branch context survives navigation;
- legacy single-page `BusinessWorkspace` is removed only after route parity is achieved.

## Non-goals for this phase

This phase does not redesign backend accounting logic, change ledger calculations, alter money semantics, replace the offline queue, or add new cashbook financial features. It is an application architecture and professional UX restructuring while preserving current business behavior.
