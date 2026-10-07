# TradeOS Multi-Page Web Workspace Design

Date: 2026-10-07
Status: Proposed for implementation after owner review
Repository: `christianagbotah/tradeos-africa`
Surface: `apps/web`

## 1. Purpose

The current authenticated TradeOS web experience is structurally a single long page. The sidebar uses hash anchors such as `#dashboard`, `#sell`, `#operations`, and every major module is rendered sequentially inside one `BusinessWorkspace`. This makes a growing business system feel like a prototype even though the underlying sales, inventory, credit, cashbook, returns, operations, reporting, offline, and authorization capabilities are real.

The goal is to turn the web client into a professional multi-page business operating system without rewriting or weakening the working business logic. Existing module components and API contracts remain the starting point; the redesign introduces a persistent application shell, real Next.js routes, route-specific composition, a coherent visual system, and responsive behavior suitable for desktop, tablet, and mobile.

## 2. Success criteria

The redesign is successful when:

- authenticated navigation changes real URLs instead of scrolling to hash anchors;
- each major business workflow has a focused page with an appropriate title, actions, layout, loading state, and empty state;
- navigating between workspace pages preserves active business, active branch, user session, catalog context, and offline/sync status;
- the existing HttpOnly-cookie session model remains intact and access tokens are never exposed to page JavaScript;
- all existing sales, returns, purchasing, inventory, operations, cashbook, customer-credit, catalog, reports, and offline behaviors remain functional;
- sidebar and mobile navigation are role-aware without becoming an authorization boundary;
- the dashboard gives an owner/manager an immediate operational picture rather than duplicating every module;
- desktop, tablet, and mobile layouts are purposefully composed rather than merely shrinking the desktop UI;
- tables, forms, cards, buttons, dialogs, empty states, errors, and loading states use a consistent professional design system;
- all nine seeded demo roles can sign in and reach the routes appropriate to their existing permissions;
- direct navigation/reload on a workspace URL restores the correct authenticated context;
- application build, tests, offline behavior, and API authorization remain green.

## 3. Non-goals

This phase does not:

- rewrite backend commerce, ledger, inventory, credit, returns, or reporting logic;
- replace deterministic financial calculations with client-side or AI-generated figures;
- add a new frontend framework or heavyweight component library solely for appearance;
- redesign the native desktop/mobile applications in the same change;
- change tenant or branch authorization semantics;
- remove offline-first support;
- create a separate design-only mock application disconnected from the real APIs;
- make the sidebar visibility map a substitute for backend RBAC;
- add entirely new accounting modules that do not already have backend support.

## 4. Current architecture and preservation rule

`TradeOSWebApp` currently owns session resolution, business selection, branch selection, catalog loading, authentication, onboarding, and the entire authenticated workspace. `BusinessWorkspace` renders one sidebar plus all major components in sequence.

Existing working components include:

- `FinancialReports`
- `QuickSale`
- `PurchasesInventory`
- `OperationsReconciliation`
- `CashbookExpenses`
- `CustomersCredit`
- `CatalogStarter`
- `SalesAndReturns`
- `NetworkStatus`
- `CfoActionCenter`
- `CashForecast`

The preservation rule is: **move and compose before rewriting**. A module may be split into smaller presentational/exported views when necessary for separate routes, but API calls, money calculations, mutation semantics, idempotency rules, offline queue behavior, and role checks must not be casually duplicated or reimplemented.

## 5. URL and route model

The public root remains the entry surface:

- `/` — sign in, demo account selection, registration, or business onboarding as appropriate.

The authenticated workspace uses real App Router pages:

- `/dashboard` — business command center
- `/sell` — POS / quick sale
- `/sales` — sales history and transaction drill-down
- `/customers` — customers and credit
- `/purchases` — supplier purchasing and receiving
- `/inventory` — stock, movements, valuation, and adjustments already supported by current APIs
- `/catalog` — products, services, pricing, units, and conversion setup
- `/returns` — sales returns, refunds, exchanges/status workflows already supported
- `/cashbook` — cashbook, expenses, and money movement surfaces
- `/operations` — operating days, shifts, and reconciliation
- `/reports` — financial reports, cash forecast, business health, and decision-support surfaces

A route group may be used internally, for example `app/(workspace)/...`, while keeping URLs clean.

After successful login or onboarding, the default destination is `/dashboard`. If an unauthenticated user directly opens a workspace route, the client returns them to `/` while preserving a safe intended-route hint when practical.

## 6. Shared authenticated workspace context

The large stateful responsibilities currently inside `TradeOSWebApp` move into a shared authenticated workspace provider used by the workspace route group.

The provider owns:

- resolved session and current user;
- memberships;
- active business ID;
- active business context;
- active branch ID;
- catalog snapshot needed across routes;
- derived sellable item choices;
- business/branch switch operations;
- catalog refresh operation;
- logout operation;
- offline/sync status integration.

The provider continues to use `/api/session/me`, `/api/tradeos/v1/businesses/:id/context`, and catalog endpoints through the current HttpOnly-cookie proxy model. Tokens are not placed into local storage, React state, query strings, or client-readable cookies.

Changing business or branch updates shared context once and the active page reacts without remounting the entire authenticated application.

## 7. App shell

### Desktop

The desktop workspace uses:

- a fixed/collapsible left sidebar;
- a sticky topbar above route content;
- a scrollable main content region;
- consistent page gutters and maximum readable content widths where appropriate;
- full-width layouts for POS and dense operational tables when needed.

Sidebar groups:

**Home**
- Dashboard

**Commerce**
- Sell / POS
- Sales
- Customers & Credit
- Returns & Refunds

**Supply & Stock**
- Purchases
- Inventory
- Catalog & Units

**Money & Operations**
- Cashbook & Expenses
- Operations
- Reports & Intelligence

The sidebar shows a compact business identity area, grouped navigation with clear active state, sync/network state near the bottom, and the user/profile/sign-out affordance without making the navigation visually noisy.

### Topbar

The topbar contains, as appropriate:

- current page title and optional breadcrumb/context label;
- active business selector when the user has multiple memberships;
- active branch selector when the business has multiple active branches;
- offline/sync indicator;
- contextual primary action supplied by the active page;
- attention/notification affordance when backed by real application data;
- user profile menu.

The topbar must not duplicate the page heading unnecessarily on small screens.

## 8. Page responsibilities

### Dashboard — `/dashboard`

The dashboard is a command center, not a dump of every module.

First viewport priorities:

- `What needs my attention today?` using CFO/action-center evidence;
- today/selected-period sales and cash indicators from authoritative reports;
- projected cash / forecast confidence where available;
- receivables and overdue customer credit;
- payables/supplier pressure where available;
- stock-risk summary using current inventory data;
- current branch/operating-day state;
- quick actions such as New Sale, Add Purchase, Record Expense, Add Product, and Open Shift when the role permits them.

Below the first viewport, show concise trend/recent-activity sections, not full module forms.

### Sell / POS — `/sell`

`QuickSale` becomes the core of a dedicated transaction workspace. It receives the full useful content width and is optimized for fast keyboard/touch interaction. Product/service search, cart, quantity/unit selection, payment/customer choices, totals, and completion feedback must be visually prioritized over dashboard chrome.

On mobile, the cart and tender actions remain reachable without excessive scrolling.

### Sales — `/sales`

Extract or mode-split the sales-history portion of `SalesAndReturns` so sales history is independently navigable. Preserve existing transaction data and mutation behavior. A selected sale can expose receipt/return eligibility/details through a drawer, detail region, or dedicated subview without forcing the returns workflow into the primary list.

### Customers & Credit — `/customers`

`CustomersCredit` moves to a dedicated page. The page prioritizes customer search/list, balances, aging/credit state, payment/recovery actions, and customer details. Existing role restrictions remain authoritative.

### Purchases — `/purchases`

Split the purchasing/receiving responsibilities currently housed in `PurchasesInventory` into a route-focused view while retaining the existing API logic. Supplier, receiving, purchase status, and payable context should be coherent on one page.

### Inventory — `/inventory`

The inventory-facing responsibilities of `PurchasesInventory` become a separate stock page: current stock, unit-aware quantities, valuation/movements already available, low-stock/risk cues where data exists, and stock-related actions permitted by the role.

### Catalog & Units — `/catalog`

`CatalogStarter` remains the creation engine but is placed in a fuller catalog workspace with the existing catalog list/context. The page clearly distinguishes Product, Prepared Product, and Service where supported; buying/stock/selling units and conversions are presented in plain business language. Bulk-to-small-unit configuration remains a first-class capability.

### Returns & Refunds — `/returns`

The return/refund side of `SalesAndReturns` becomes its own workflow page. It must preserve full/partial returns, stock/restock decisions, non-restockable/damaged handling, refund status, and existing financial reversal semantics supplied by the backend. The UI should communicate lifecycle/status clearly rather than hide it inside a general sales section.

### Cashbook & Expenses — `/cashbook`

`CashbookExpenses` moves intact initially, then may be internally segmented into Cashbook and Expenses tabs/subviews if the existing component naturally supports it. Money totals remain server/ledger-derived.

### Operations — `/operations`

`OperationsReconciliation` becomes the operations page for operating days, shifts, method balances, and reconciliation. Status, open/closed state, variance, and role-appropriate actions should be visually obvious.

### Reports & Intelligence — `/reports`

`FinancialReports`, `CashForecast`, business health, and CFO decision-support surfaces live here in full detail. The dashboard may consume concise reusable summary components, but report computations must not be duplicated client-side.

## 9. Role-aware navigation

Navigation visibility is derived from a centralized route capability map using the current membership role. The nine seeded roles are:

- OWNER
- ADMIN
- MANAGER
- CASHIER
- SALES
- INVENTORY
- ACCOUNTANT
- STAFF
- VIEWER

The implementation must first audit the existing backend/component role gates before finalizing the exact matrix. The rule is conservative: do not expose an action merely because a link is visible, and do not hide an existing permitted workflow based on an invented frontend policy.

Backend authorization remains the security boundary. Direct URL access to an unauthorized mutation must still fail server-side. A route may show a professional read-only or access-denied state where appropriate rather than crash or silently render an empty page.

Automated coverage must log in as all nine demo roles and exercise the route matrix.

## 10. Visual design system

The desired style is a modern professional business operating system, not a generic template dashboard.

### Palette

- deep navy/slate for primary navigation and high-contrast structural surfaces;
- warm TradeOS gold/amber as the primary accent/action color;
- off-white/light neutral application canvas;
- white/near-white cards and forms;
- restrained semantic success, warning, danger, and information colors;
- no decorative gradient overload.

All colors become CSS custom properties/tokens so light surfaces and future theme work stay coherent.

### Typography

- readable 14–16px body scale on desktop and mobile;
- page titles with clear hierarchy, not oversized marketing typography inside the app;
- KPI numerals use stronger size/weight and tabular figures where useful;
- labels and helper text remain legible and never collapse into tiny 10–11px UI text.

### Controls

- primary interactive controls target at least roughly 44px touch height;
- buttons use consistent heights, padding, border radius, disabled state, focus state, and loading state;
- form fields align labels, help, errors, and values consistently;
- tables use readable density, sticky headers where beneficial, horizontal containment on narrow screens, and clear row hover/focus states;
- cards use restrained borders/shadows rather than excessive floating panels.

### Icons

Use a coherent icon approach. Prefer an existing lightweight icon solution; if no appropriate package exists, introduce one small well-supported icon dependency only if justified by the implementation plan. Do not use emoji as primary application navigation icons.

## 11. Responsive behavior

### Desktop

- sidebar expanded by default at comfortable widths;
- optional collapse to icon rail;
- main region uses responsive grid composition;
- POS and large data tables may use wider layouts than reporting forms.

### Tablet

- compact/collapsible sidebar;
- two-column cards reduce to one column where necessary;
- filters/actions remain in the same row while space allows, then wrap as grouped controls rather than arbitrary stacking.

### Mobile

- sidebar becomes an accessible drawer or equivalent compact navigation;
- a small priority navigation affordance may expose Dashboard, Sell, Sales, and More depending on role;
- page actions remain reachable near the page heading or via a clearly labelled action control;
- forms become single-column unless a two-field row remains genuinely readable;
- wide tables use responsive row/card treatment or contained horizontal scrolling, never page-wide overflow;
- sticky purchase/sale totals and action areas are allowed where they improve transaction completion;
- no desktop card is simply scaled down until text becomes tiny.

## 12. Offline-first and sync behavior

The redesign must preserve the existing offline-first contract.

- `NetworkStatus` moves into the shared shell so it persists across pages.
- Offline state must not be reset by route transitions.
- Existing queued mutations and client ID behavior stay centralized.
- Pages that can operate offline must continue to do so using existing cache/queue rules.
- Pages requiring unavailable live data show a clear cached/offline state rather than generic failure.
- Cached generated timestamps and authoritative-data labels are preserved on financial/report surfaces.

## 13. Loading, empty, error, and access states

Every route must define:

- initial loading/skeleton state;
- no-data state with a useful next action where permitted;
- API error state with retry when safe;
- offline/cached state where relevant;
- unauthorized/read-only state where relevant.

Avoid blank panels, raw JSON/errors, browser alerts, and layout jumps caused by late-loading controls.

## 14. Accessibility and interaction quality

- semantic `nav`, `main`, headings, forms, tables, dialogs/drawers;
- visible keyboard focus states;
- keyboard-operable sidebar/drawer/menu controls;
- labels associated with form inputs;
- color contrast meeting WCAG AA intent for normal text and controls;
- active navigation indicated by more than color alone;
- escape/close behavior for drawers/dialogs;
- reduced-motion-friendly transitions;
- no important action available only on hover.

## 15. State and component decomposition

Recommended high-level structure:

```text
apps/web/app/
  page.tsx                         public auth/onboarding entry
  (workspace)/
    layout.tsx                     authenticated route shell boundary
    dashboard/page.tsx
    sell/page.tsx
    sales/page.tsx
    customers/page.tsx
    purchases/page.tsx
    inventory/page.tsx
    catalog/page.tsx
    returns/page.tsx
    cashbook/page.tsx
    operations/page.tsx
    reports/page.tsx
  components/
    workspace/
      workspace-provider.tsx
      app-shell.tsx
      sidebar.tsx
      topbar.tsx
      mobile-nav.tsx
      page-header.tsx
      route-access.ts
    dashboard/
      ...reusable dashboard composition
    ...existing business module components...
```

Exact filenames may be refined in the implementation plan after checking component boundaries, but the ownership boundaries must remain: provider owns shared context, shell owns navigation/chrome, pages own composition, domain modules own their existing workflow logic.

## 16. Migration strategy from the single page

The change should be incremental and testable:

1. extract auth/onboarding from the monolithic client without behavior change;
2. extract shared authenticated context from `TradeOSWebApp`;
3. create the shell and route map with placeholder route tests;
4. move Dashboard/Reports first because they are read-heavy;
5. move Quick Sale to `/sell` and verify transaction behavior;
6. split and move Sales/Returns;
7. split and move Purchases/Inventory;
8. move Customers, Cashbook, Operations, and Catalog;
9. remove old hash navigation and sequential workspace only after every route has parity tests;
10. perform all-role, mobile, offline, direct-navigation, and production-build verification.

At no stage should the old working module be deleted before its routed replacement is verified.

## 17. Testing strategy

### Unit/component tests

- workspace provider selects remembered business or valid fallback;
- branch switching updates shared context;
- role-capability map produces expected navigation for all nine demo roles;
- active route renders correct nav state;
- logout clears active business and returns to public entry;
- mobile navigation open/close and focus behavior;
- page header/context selectors retain values across route transitions.

### Route/integration tests

- login redirects to `/dashboard`;
- direct authenticated route load works;
- unauthenticated route load returns to public entry;
- business and branch selection survive navigation;
- existing module actions call the same API endpoints and preserve current payload semantics;
- sell, purchase, return, cashbook, customer-credit, and operations critical paths retain behavior;
- all nine demo accounts receive coherent navigation and server-enforced permissions.

### Responsive/manual verification

Verify representative widths around mobile, tablet, laptop, and wide desktop. Check no page-level horizontal overflow, controls remain usable, table strategy is intentional, sidebar/drawer does not cover inaccessible content, and POS completion is practical on touch screens.

### Regression gates

Run full repository typecheck, tests, and production build. Preserve existing API integration tests and financial determinism tests unchanged unless route extraction requires test harness adaptation.

## 18. Performance constraints

- route extraction must not refetch the entire session/business/catalog context unnecessarily on every navigation;
- large modules may be route-split/lazy-loaded naturally through App Router;
- avoid loading every business module into the initial dashboard bundle;
- do not add a large design-system runtime dependency solely for common controls;
- minimize repeated report requests by sharing already-authoritative cached state where appropriate without serving stale data as current.

## 19. Observability and user feedback

- mutation feedback uses consistent inline/toast status patterns rather than browser alerts;
- offline queued work is visibly distinguished from server-confirmed work;
- destructive or money-affecting operations retain explicit confirmation where existing workflows require it;
- route-level failures identify the affected module and offer safe retry rather than collapsing the entire shell.

## 20. Acceptance criteria

The first multi-page release is accepted when:

1. the public login/demo/onboarding entry remains functional;
2. successful login lands on `/dashboard`;
3. the sidebar uses real route links and active states;
4. every route listed in Section 5 renders its intended real module/workflow;
5. no old sequential mega-workspace remains as the primary authenticated UI;
6. active business and branch persist while navigating;
7. offline/network status persists in the shell;
8. all nine demo roles can log in and receive coherent role-aware navigation;
9. backend RBAC still rejects unauthorized operations independent of navigation visibility;
10. desktop/tablet/mobile layouts have no uncontrolled page overflow or tiny controls;
11. dashboard first viewport surfaces actionable owner/manager information rather than full forms;
12. POS, returns, purchases/inventory, customer credit, cashbook, operations, and reports retain functional parity;
13. financial figures remain authoritative/server-derived;
14. direct URL reloads work on workspace pages;
15. typecheck, test, and production build are green.

## 21. Design decisions

- **Real routes over hash anchors:** improves orientation, browser history, deep links, bundle splitting, and professional application behavior.
- **Preserve domain modules:** lowers regression risk while allowing UX modernization.
- **Shared workspace provider:** keeps business/branch/session/offline state stable across pages.
- **Dashboard as command center:** avoids recreating the current single-page problem inside a new route.
- **Role-aware but not role-authoritative navigation:** improves usability while keeping security on the server.
- **Responsive composition rather than shrink-to-fit:** makes TradeOS practical for the small-business phones and tablets it is intended to serve.
- **Tokenized CSS visual system:** gives a coherent premium identity without forcing a heavyweight UI framework.

## 22. Implementation planning requirement

Before product code changes, the implementation plan must inspect the internal boundaries of `FinancialReports`, `PurchasesInventory`, and `SalesAndReturns` to decide the smallest safe exports/mode splits needed for Dashboard vs Reports, Purchases vs Inventory, and Sales vs Returns. The plan must specify route files, shared-provider interfaces, role map tests, responsive shell tests, and migration order so no working module is removed before parity is proven.
