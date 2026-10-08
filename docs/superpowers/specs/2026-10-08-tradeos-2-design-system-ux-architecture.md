# TradeOS 2.0 Design System & UX Architecture

Date: 2026-10-08
Status: Approved design direction; written specification awaiting owner review before implementation planning

## 1. Product intent

TradeOS must become the business operating system that African business owners choose to keep on their phones all day, not merely a competent web administration dashboard.

The product must work for a one-person informal business, a small shop with a cashier, a salon or barber, a food seller, a washing bay, a drinking spot, a car park, a building-materials dealer, a wholesaler, a transporter, and a growing multi-branch SME without forcing all of them into the same dense enterprise interface.

The experience must feel modern, fast, trustworthy, intelligent and recognizably TradeOS across web, mobile and desktop. The system should help a business owner understand what is happening now, complete frequent transactions quickly, and know what needs attention next.

This redesign is a presentation and interaction architecture change. It must preserve proven business behavior including authentication, tenancy, roles, business/branch context, offline-first synchronization, POS and server pricing, bulk-to-small-unit conversions, inventory, purchasing, sales returns/refunds/exchanges, cashbook, treasury, customer credit, receivables/payables, financial reporting, CFO actions, operations/reconciliation and audit behavior.

### Relationship to the 2026-10-07 multi-page UX spec

The 2026-10-07 `tradeos-multipage-ux-design` remains authoritative for the route-first architecture, shared workspace state, business-logic preservation, authorization boundaries and module route map. This 2026-10-08 specification supersedes its visual-system, shell, responsive/mobile-navigation and dashboard-composition guidance wherever the two documents differ. Implementation planning must use this document as the controlling presentation/interaction architecture.

## 2. Why the current design must change

TradeOS already has a real multi-page route architecture, but the visual and interaction architecture remains transitional.

The authenticated workspace currently loads several overlapping presentation layers: global styles, the older real-app layer, workspace shell, UI primitives, workspace polish and multiple module-specific style sheets. The result is a product that can look locally polished while still lacking one coherent product language.

The current shell is still desktop-admin shaped: a wide left sidebar, small context labels, dense top-bar controls and many 9–12px text treatments. Mobile primarily hides desktop information in a drawer instead of behaving as a first-class phone application.

The current dashboard starts with conventional summary cards and reporting blocks. It does not yet behave as an intelligent business command center that answers, in order:

1. How is my business doing today?
2. What needs my attention?
3. What should I do next?
4. Can I complete that action immediately from here?

The redesign must solve those root issues rather than add another polish stylesheet.

## 3. Approaches considered

### A. Continue polishing the existing shell

This is the lowest-risk short-term option, but it would preserve the existing design debt and admin-dashboard personality. Rejected.

### B. Introduce one TradeOS design foundation and progressively replace the presentation layer

This preserves working domain logic while replacing the shell, design tokens, primitives, page hierarchy, mobile navigation and module composition with one coherent architecture. Selected.

### C. Rewrite the entire frontend from scratch

This gives maximum visual freedom but creates unnecessary regression risk across money, stock, returns, credit and offline workflows. Rejected.

## 4. Core design principles

### 4.1 Phone first, not desktop shrunk to a phone

The primary mental model is a phone-native business application. Desktop expands capability and information density; it is not the source layout that mobile must imitate.

### 4.2 Action before administration

Every major screen should prioritize the user’s next business action. Configuration and administration remain available, but daily operating tasks should dominate the first viewport.

### 4.3 Money and business state must be instantly readable

Amounts, balances, stock risk, debt and profit signals use strong hierarchy, consistent numeric formatting and sufficient size. Important values must never look like metadata.

### 4.4 Intelligence must be contextual

AI is not a decorative panel. Evidence-based insights appear near the relevant business state and always distinguish observed facts from suggestions.

### 4.5 Progressive complexity

A microbusiness should see a simple application. A multi-branch SME should see additional controls and analysis only where relevant. Capability may expand by role, business type, enabled modules and available data.

### 4.6 Trust over novelty

The interface must never obscure transaction status, offline state, sync state, money movement or destructive actions. Critical financial operations should remain deterministic even when AI services are unavailable.

### 4.7 Low-bandwidth and intermittent-network operation are first-class

The interface should remain responsive on unstable networks. Offline-safe actions should be clearly available, pending sync must be visible without being alarming, and the application must avoid unnecessary visual or data payloads.

## 5. One TradeOS design foundation

Create a single shared design foundation that provides semantic design tokens and platform-neutral interaction rules.

The web implementation may initially live inside `apps/web`, but the token model and component contracts must be designed so they can be reused or mirrored by `apps/mobile` and `apps/desktop` without inventing new visual identities.

### 5.1 Foundation layers

```text
TradeOS Design Foundation
├── Tokens
│   ├── color
│   ├── typography
│   ├── spacing
│   ├── radius
│   ├── elevation
│   ├── motion
│   └── breakpoints
├── Primitives
│   ├── Button
│   ├── IconButton
│   ├── Input
│   ├── Select
│   ├── Textarea
│   ├── SearchField
│   ├── SegmentedControl
│   ├── Badge
│   ├── Avatar
│   ├── Sheet / Drawer
│   ├── Dialog
│   ├── Toast
│   ├── EmptyState
│   └── Skeleton
├── Business Components
│   ├── MoneyValue
│   ├── MoneyMetric
│   ├── BusinessPulse
│   ├── InsightCard
│   ├── AttentionItem
│   ├── TransactionRow
│   ├── StockHealth
│   ├── CustomerBalance
│   ├── PaymentMethod
│   ├── SyncStatus
│   └── QuickAction
└── Adaptive Application Shell
    ├── Desktop navigation
    ├── Tablet navigation
    ├── Mobile bottom navigation
    ├── Mobile sheets
    ├── Global search/action entry
    └── TradeOS Assistant entry
```

### 5.2 CSS architecture

The target architecture must reduce overlapping global CSS layers rather than append another override file.

The implementation should converge toward:

- one semantic token source;
- one base/reset layer;
- one shared primitive/component layer;
- feature-local styles only where genuinely feature-specific;
- no new generic selectors that silently restyle unrelated modules;
- no reliance on source order between multiple “polish” files to produce the intended result.

Existing CSS files may be removed progressively only after each migrated route has visual and functional parity.

## 6. Visual identity

### 6.1 Brand character

TradeOS should feel premium, calm, modern and African without relying on stereotypical decorative motifs.

Primary identity:

- deep midnight/navy for authority and navigation;
- warm TradeOS gold for selected states, premium emphasis and important actions;
- emerald/green for positive money movement and healthy business states;
- controlled amber for warnings;
- controlled red for destructive or dangerous states;
- warm/cool neutral surfaces for depth and separation.

Gold should be an accent, not a page-wide decoration.

### 6.2 Typography

The system should use one modern sans-serif family with strong numeric legibility and a robust offline/system fallback stack.

Recommended web scale:

- mobile body/default controls: 15–16px;
- secondary/supporting text: 13–14px;
- metadata: normally 12px minimum; 11px only for rare non-essential annotations;
- navigation labels: 14–15px;
- card/section titles: 17–22px;
- page titles: 26–36px depending on viewport;
- primary money values: 28–44px depending on importance;
- dashboard hero money values: up to 48px where space permits.

Do not use 9–10px text for normal business context, navigation, role names or primary labels.

Use tabular numerals for money, quantities, dates and KPI comparisons where available.

### 6.3 Touch and interaction sizing

- primary touch targets: 48–52px minimum height on mobile;
- compact desktop controls may use 40–44px where appropriate;
- icon-only targets: at least 44x44px on touch layouts;
- critical actions should not depend on precise small targets.

### 6.4 Shape and elevation

Use fewer, stronger levels of hierarchy:

1. page canvas;
2. section group;
3. actionable/elevated surface;
4. lightweight row or inline status.

Do not place every piece of information in a separate shadowed white card.

Radii should generally use a restrained 12/16/20px scale. Strong elevation is reserved for overlays, mobile sheets and selected focal surfaces.

## 7. Adaptive application shell

### 7.1 Desktop

Desktop keeps persistent navigation but should be visually lighter and more intentional than the current 272px traditional admin sidebar.

The sidebar should support a comfortable expanded width and a compact/collapsed mode. It contains grouped role-aware navigation and a small business identity area. Business/branch switching should not dominate the top bar when only one context exists.

The top bar contains only high-value context:

- current destination;
- business/branch context when changeable;
- sync/network state;
- universal search/action entry when implemented;
- TradeOS Assistant entry;
- profile/account.

### 7.2 Tablet

Tablet uses a compact rail or temporary navigation drawer depending on width and orientation. Content should remain the primary surface rather than being squeezed between fixed chrome.

### 7.3 Mobile

Mobile receives its own first-class shell.

The default owner/manager bottom navigation is:

- Home
- Sell
- Money
- Stock
- More

The exact tabs are role-aware. Examples:

- Cashier: Home, Sell, Sales, Money, More
- Inventory: Home, Stock, Purchases, Catalog, More
- Accountant: Home, Money, Customers, Reports, More
- Viewer: Home, Sales, Stock, Reports, More

`More` opens a structured module sheet rather than reproducing the desktop sidebar in a narrow drawer.

The mobile top bar should stay compact. It may contain business identity, branch where relevant, sync state and contextual actions. It must not duplicate a full desktop header.

Respect device safe-area insets for bottom navigation and transactional actions.

## 8. Information architecture

Keep the real route model established by the multi-page architecture:

- `/dashboard`
- `/sell`
- `/sales`
- `/customers`
- `/purchases`
- `/inventory`
- `/catalog`
- `/returns`
- `/cashbook`
- `/operations`
- `/reports`

Desktop navigation may group these as Overview, Commerce, Money, Operations and Insights. Mobile navigation exposes the most frequent role-specific actions directly and places the rest under More.

Do not create separate business logic for mobile routes. Mobile and desktop are adaptive presentations of the same domain workflows.

## 9. Dashboard: Business Command Center

The dashboard is the strongest expression of the new TradeOS identity.

It should not start with four generic database counts. The first screen answers the owner’s operating questions.

### 9.1 Greeting and today state

Example structure:

- contextual greeting / business name;
- Today status;
- primary sales/revenue figure;
- comparison against a useful baseline when sufficient data exists;
- compact transaction/profit/cash context.

The comparison baseline must be explicit, for example yesterday, same weekday last week or recent average. TradeOS must not present a percentage without explaining what it compares against.

### 9.2 Business Pulse

A focal `TradeOS Pulse` component combines deterministic observations and, where enabled, AI-written interpretation.

Example:

> Sales are ahead of your normal Thursday pace, but three overdue customers owe ₵2,760 and Malt may run out tomorrow.

It then provides actions such as:

- Collect debt
- Restock
- View sales

Every claim must be traceable to current TradeOS data. If AI interpretation is unavailable, deterministic observations still render.

### 9.3 Needs attention

Prioritized list of operational exceptions, such as:

- low/out-of-stock items;
- overdue receivables;
- supplier payments approaching due date;
- unusual expenses;
- pending offline transactions;
- failed/reversed payments;
- cash forecast shortfall;
- branch reconciliation issue.

Each item should provide an immediate action or destination.

### 9.4 Quick actions

Role-aware quick actions should include the most common operating tasks, for example:

- Sell
- Receive stock
- Record expense
- Receive customer payment
- Create purchase
- Add product/service

On mobile, these actions should be reachable without scrolling through analytics.

### 9.5 Money position

Show cash, MoMo, bank, receivables and payables with clear distinctions between balance, expected inflow and expected outflow.

### 9.6 Business momentum

Use simple, compact visualizations for sales, gross profit, transaction volume or cash position. Avoid dashboard decoration charts that do not change a decision.

## 10. Sell / POS redesign

Sell is a transactional workspace, not a generic form page.

### 10.1 Mobile POS

The first viewport prioritizes:

- search/barcode entry;
- favourites/recent/popular products where available;
- fast product/service selection;
- quantity and selling-unit selection;
- cart count and running total;
- sticky bottom action such as `Charge ₵124.50`.

The cart opens as a dedicated screen or bottom sheet depending on viewport and item count.

Payment presents large, clear methods for Cash, MoMo, Card, Bank or Credit according to configuration. Customer selection and credit eligibility happen without leaving the sale flow.

### 10.2 Desktop POS

Desktop may use a two-pane workspace: searchable catalog on the left/main area and cart/payment summary on the right. It should remain fast with keyboard and barcode workflows.

### 10.3 Unit conversion UX

Buying/selling conversions must be natural at the line-item level. Examples include:

- carton → bottle;
- bottle → glass/shot;
- box → packet/piece;
- bag → kg/smaller measure.

The user chooses the configured sale unit and sees the corresponding quantity/price without understanding internal conversion formulas.

### 10.4 Offline behavior

When a sale is safely accepted offline, the confirmation screen says so clearly and shows pending sync state. The customer-facing success state should not look like an error merely because synchronization is pending.

## 11. Money / Cashbook redesign

Money becomes a consolidated operating area rather than several unrelated financial cards.

Mobile first view should prioritize:

- available money position;
- today inflow/outflow;
- quick `Record expense`, `Receive money`, `Transfer` actions;
- recent movements;
- receivable/payable alerts.

Advanced treasury, forecast and reconciliation capabilities remain available progressively.

Money-entry screens should use purpose-built flows instead of presenting every optional financial field at once.

## 12. Stock, purchases and catalog

### 12.1 Stock home

Prioritize:

- stock health summary;
- low-stock/out-of-stock attention;
- high-value inventory;
- recent receiving/adjustments;
- fast search;
- contextual restock recommendations.

### 12.2 Product detail

A product detail screen should combine:

- available quantities by unit;
- cost/selling price;
- conversion structure;
- stock movement history;
- supplier information;
- low-stock threshold;
- sales velocity and restock insight when sufficient data exists.

### 12.3 Purchases

Receiving stock must be optimized for real physical operations. A user should be able to create/select supplier, add lines, receive full/partial quantities, record payment/credit terms and finish without navigating through unrelated inventory administration.

## 13. Customers, credit and receivables

Customer lists prioritize amount owed/credit state where financially relevant.

Customer detail should present a simple account story:

- current balance;
- overdue amount;
- credit limit/terms;
- recent purchases;
- recent payments;
- aging;
- next recommended action.

`Receive payment` must be a first-class action.

Intelligence may identify payment behavior, but must phrase conclusions as observed patterns rather than guarantees.

## 14. Returns, refunds and exchanges

Return workflows remain first-class and must feel as polished as sales.

The flow should guide the user through:

1. locate original sale/customer/receipt where available;
2. choose items/services and quantities;
3. choose refund, return or exchange path;
4. decide restock/damaged/non-restockable handling;
5. choose payment reversal/refund method;
6. show financial/inventory effect summary;
7. confirm with permission/approval rules;
8. show final audit-safe result.

Do not present accounting internals as the primary interface, but make material effects visible before confirmation.

## 15. Reports and CFO intelligence

Reports should separate three levels:

- quick owner summaries;
- operational drill-downs;
- accounting/management reports.

CFO actions and 30-day cash forecast remain deterministic and evidence-driven. TradeOS Assistant may explain them in plain language but must not replace source calculations.

## 16. Contextual intelligence architecture

### 16.1 Three intelligence layers

**Layer 1: deterministic signals**

Examples: overdue balance, days of stock remaining, cash forecast deficit, sales comparison, expense variance.

**Layer 2: contextual explanation**

AI may translate signals into concise natural language using supplied evidence.

**Layer 3: proposed action**

The system recommends a relevant TradeOS action or destination. High-risk financial mutations still require the normal user flow and permissions.

### 16.2 Evidence contract

Every intelligent recommendation must carry sufficient structured evidence for the UI to answer “why am I seeing this?”

Recommended shape:

```text
Insight
- type
- priority
- title
- summary
- evidence[]
- source period
- confidence/coverage when meaningful
- recommended action
- target route/action
- generatedAt
```

AI should not invent data to fill missing evidence. If data coverage is insufficient, show that limitation.

### 16.3 Global TradeOS Assistant

A dedicated assistant entry should eventually support questions such as:

- Why is my profit lower this week?
- What should I restock tomorrow?
- Who owes me the most?
- Can I afford this purchase?
- Which branch is underperforming?

Responses should link directly to the underlying records or workflows.

## 17. Business-type adaptation

TradeOS should not fork into separate products for each industry. It uses configuration and progressive disclosure.

Examples:

- salon/barber: services, staff performance, optional product stock;
- food/drinking spot: fast POS, ingredient/product stock, units, shifts;
- retail/hardware: barcode/search, stock, suppliers, bulk/small-unit conversion;
- washing bay/car park: service-first transactions, staff/shift reconciliation;
- wholesaler/distributor: customers, credit, purchases, receivables, multi-unit stock;
- multi-branch SME: branch switching, reports, treasury, permissions and consolidated intelligence.

The design system remains constant while the first-run setup and dashboard emphasis adapt.

## 18. Responsive behavior

Reference breakpoints:

- compact phone: below 480px;
- phone: 480–767px;
- tablet: 768–1099px;
- desktop: 1100px and above.

Components should respond to available space rather than relying solely on global breakpoints.

Rules:

- no horizontal page scrolling caused by grids or forms;
- tables may scroll within dedicated containers when a mobile list/card representation would lose essential information;
- filters use compact sheets or stacked controls on phones;
- primary actions may become sticky bottom actions in transactional mobile flows;
- two-column forms should not survive onto widths where labels/values become cramped;
- desktop information density must not reduce mobile text below the agreed readable scale.

## 19. Accessibility and inclusivity

- WCAG AA contrast for normal text and interactive states;
- visible keyboard focus;
- explicit control labels;
- active/navigation state not communicated by color alone;
- touch targets appropriate for phone use;
- semantic headings and table headers;
- screen-reader labels for icon-only controls;
- reduced-motion support;
- numeric/money values remain understandable without color;
- common flows should remain usable with zoomed text.

## 20. Performance and offline UX

The visual redesign must not make TradeOS feel heavier.

Targets and rules:

- route transitions should preserve workspace context;
- use skeletons only where they improve perceived progress;
- avoid full-page loading states for small data refreshes;
- cache/read offline-safe data using existing mechanisms;
- lazy-load genuinely secondary analytics where useful;
- avoid large animation libraries for basic interaction polish;
- respect reduced motion;
- maintain clear pending-sync and last-synced indicators;
- offline mutations preserve existing idempotency and queue behavior.

## 21. Migration architecture

The redesign is progressive and vertical rather than a big-bang frontend rewrite.

### Phase 1 — Design foundation

- establish semantic tokens;
- establish typography and spacing scale;
- create modern primitives;
- introduce business-specific components;
- begin consolidating CSS architecture;
- add visual/interaction regression tests where practical.

### Phase 2 — Adaptive shell

- redesign desktop shell;
- add compact tablet behavior;
- add mobile bottom navigation;
- replace desktop-style mobile drawer as the primary phone navigation model;
- add consistent page chrome and contextual actions.

### Phase 3 — Dashboard command center

- replace count-first dashboard hierarchy;
- add Today summary;
- add Business Pulse;
- add Needs Attention;
- add role-aware Quick Actions;
- add Money Position and useful momentum visualization.

### Phase 4 — Core daily transaction flows

Order:

1. Sell/POS
2. Money/Cashbook
3. Stock/Inventory
4. Purchases
5. Customers/Credit

### Phase 5 — Control and intelligence flows

- Sales history/detail
- Returns/refunds/exchanges
- Catalog and units
- Reports/CFO
- Operations/reconciliation

### Phase 6 — Entry and secondary experiences

- login/demo login;
- onboarding/business setup;
- profile/settings;
- empty/error/offline recovery states;
- cross-platform visual parity review.

No phase may replace domain logic merely to simplify presentation. Extract shared hooks/services where presentation components are currently entangled with domain behavior.

## 22. Testing strategy

### 22.1 Component and design-system tests

Cover:

- token/variant contracts where appropriate;
- button/field states;
- mobile sheets/drawers;
- bottom-navigation active state;
- MoneyValue formatting;
- Insight evidence rendering;
- offline/sync treatments;
- responsive variants for business components.

### 22.2 Route/integration tests

At minimum:

- OWNER can access all licensed primary destinations;
- CASHIER receives sale-oriented navigation and cannot invoke management-only actions;
- INVENTORY role receives stock/purchase-oriented navigation;
- ACCOUNTANT receives money/report-oriented navigation;
- VIEWER remains read-only;
- business/branch context survives navigation;
- pending offline queue survives navigation;
- POS works online and offline-safe path;
- customer payment, expense, receive-stock and return workflows preserve existing semantics.

### 22.3 Visual QA matrix

Required reference widths:

- 360px phone;
- 390/393px phone;
- 430px large phone;
- 768px tablet portrait;
- 1024px tablet/compact desktop;
- 1280px desktop;
- 1440px desktop.

Required initial reference routes:

- dashboard;
- sell;
- cashbook;
- inventory;
- customers;
- reports.

### 22.4 Interaction QA

Verify:

- no tiny click targets;
- no clipped money values;
- no accidental horizontal page overflow;
- no fixed bottom action hidden behind phone safe area;
- forms remain reachable when keyboard opens;
- drawers/sheets trap and restore focus appropriately;
- destructive actions remain explicit;
- network loss does not collapse the experience into an error page when cached/offline-safe behavior is available.

## 23. Success metrics and acceptance criteria

The TradeOS 2.0 presentation architecture is accepted when:

1. The authenticated product uses one documented design-token system rather than depending on layered override styles for its intended appearance.
2. Normal mobile body/control text is generally 15–16px and essential UI does not depend on 9–10px labels.
3. Primary mobile touch targets are at least 48px in the redesigned core workflows.
4. Mobile uses role-aware bottom navigation and a structured More surface rather than treating the desktop sidebar drawer as the main phone navigation model.
5. Dashboard first viewport communicates Today performance, urgent attention and next actions before deep analytics.
6. Dashboard intelligence remains useful without an AI model because deterministic source signals render independently.
7. Sell/POS can complete a normal sale on a 360px-wide device without horizontal scrolling and with the running total/charge action continuously understandable.
8. Bulk-to-small-unit sale selection is directly usable from the POS line-item flow.
9. Money, Inventory and Customers expose their most common actions without first navigating through dense administration forms.
10. Offline/pending-sync states remain visible and understandable without presenting successful offline-safe actions as failures.
11. Desktop, tablet and phone all share the same TradeOS identity while using layout patterns appropriate to each form factor.
12. Existing financial, inventory, returns, credit, role and offline behavior passes regression tests after each route migration.
13. Core reference pages pass the visual QA matrix with no viewport-level horizontal overflow.
14. AI-generated insights link to evidence and never become the authoritative calculation for money, stock or accounting state.
15. The old CSS layers are progressively retired as their routes migrate; the final design does not add a new global “polish” stylesheet on top of the current stack.

## 24. Non-goals

This initiative does not:

- rewrite accounting or ledger semantics;
- replace the offline queue/sync engine;
- alter existing return/refund financial correctness requirements;
- remove role-based authorization;
- create separate business apps for every industry;
- make AI a dependency for core transaction correctness;
- introduce a second set of mobile-only domain APIs;
- prioritize ornamental animation over speed and clarity.

## 25. Implementation boundary

The first implementation plan should cover the design foundation, adaptive shell and dashboard command center as one controlled architectural slice. POS and subsequent module redesigns should follow as later vertical slices after the foundation is proven in production-quality code.

This boundary prevents a full-product visual rewrite from becoming one unreviewable change while still fixing the root architecture before more feature pages adopt the current transitional patterns.
