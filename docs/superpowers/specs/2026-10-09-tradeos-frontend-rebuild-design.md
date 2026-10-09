# TradeOS Africa Frontend Rebuild Design

**Date:** 2026-10-09  
**Status:** Proposed for implementation planning  
**Related:** GitHub Issue #36 — Z.ai frontend rebuild brief: TradeOS 2 UX/UI architecture

## 1. Purpose

TradeOS Africa needs a frontend architecture that matches the ambition of the product: a modern, intelligent, offline-first business operating system that can serve a one-person informal business and a growing multi-branch SME without feeling like a generic ERP.

The rebuild is not a CSS refresh. It replaces the weak visual foundation, information hierarchy, navigation model, responsive behavior, page composition, and reusable frontend primitives while preserving authoritative business behavior.

The redesigned product must be usable daily on phones, tablets, laptops, and desktops, and it must establish one recognizable TradeOS design language across web/PWA, Windows, macOS, Android, iOS, and the separate system-admin control plane.

## 2. Product Outcomes

The rebuild succeeds when:

1. A small-business owner can understand the most important state of the business at a glance and reach common actions quickly.
2. A cashier or staff member sees a task-focused workspace instead of owner-level analytical clutter.
3. Desktop layouts are information-dense without becoming cramped.
4. Mobile layouts are intentionally designed for touch rather than being compressed desktop screens.
5. Existing backend, accounting, permissions, sync, transaction, and offline invariants remain intact.
6. Reusable page patterns replace one-off layouts.
7. The same design language extends naturally to desktop and native mobile clients without forcing DOM-specific components into React Native.
8. System administration remains visibly and technically separate from tenant/business administration.

## 3. Scope

### In scope

- Web/PWA application shell and navigation
- Shared web/desktop design system
- Mobile-native design-system alignment
- Dashboard and operational overview patterns
- Sell/POS workflow
- Sales history and transaction detail
- Returns/refunds/exchanges UI
- Catalog/products/services/units UI
- Inventory UI
- Purchases/receiving/corrections UI
- Customers, suppliers, credit, and cashbook UI
- Operations and reports UI
- AI insight presentation patterns
- Business-pack adaptation rules
- Responsive behavior and accessibility
- Offline/sync status presentation
- System-admin control-plane UX alignment
- Frontend migration strategy
- Z.ai collaboration and review boundaries

### Out of scope for this frontend rebuild

- Rewriting the financial/accounting domain model
- Changing posted-transaction semantics
- Replacing the offline-sync protocol
- Altering permissions enforcement rules
- Replacing API contracts unless a separate backend proposal is approved
- Reworking database schema solely for presentation preferences
- Building unrelated new business modules during the design-system migration

## 4. Non-Negotiable Domain Invariants

The frontend must preserve these rules even when the presentation changes substantially:

- Posted sales and purchases are immutable business evidence.
- Corrections happen through linked return, refund, exchange, recovery, adjustment, or reversal workflows rather than editing posted history.
- Inventory balances are movement-derived; users do not directly overwrite on-hand stock.
- Returns and refunds remain first-class workflows, including partial returns, refund-only cases, exchanges, damaged/non-restockable returns, and provider-refund state.
- Flexible unit conversion is fundamental to product modeling and selling.
- Services may consume inventory.
- Recipes, yields, transformed stock, and wastage remain valid business concepts where relevant.
- Offline-capable mutations remain durable, idempotent, and replay-safe.
- Permissions are enforced server-side. UI visibility may reflect permissions but is never treated as the security boundary.

## 5. Design Direction

TradeOS should feel premium, calm, efficient, and intelligent. It must not resemble a purchased admin template.

The visual system should emphasize:

- legible typography
- strong hierarchy
- restrained semantic color
- consistent spacing
- obvious interactive states
- meaningful density
- clear task progression
- high touch usability
- helpful empty/loading/error/success states
- business language over technical jargon

Avoid excessive gradients, decorative cards, glassmorphism, tiny text, thin controls, or visual effects that reduce clarity.

Normal body text should generally sit around 15–16px. Touch targets should generally be at least 48px on touch-oriented surfaces.

## 6. Frontend Architecture

### 6.1 Design-system layers

The frontend should use four clear layers:

1. **Tokens** — typography, spacing, radii, elevation, semantic colors, motion, breakpoints, z-index, interaction states.
2. **Primitives** — buttons, inputs, selectors, tabs, badges, cards, sheets, dialogs, tables, list rows, toasts, skeletons, banners.
3. **Patterns** — command bars, master/detail, builders, history/detail, correction workflows, reports, dashboards, setup/wizards.
4. **Feature composition** — Sell, Catalog, Inventory, Sales, Purchases, Cashbook, Reports, etc.

Feature pages should depend on patterns and primitives rather than own disconnected style systems.

### 6.2 Shared package strategy

Use a shared token source for semantic colors, typography scales, spacing, status names, icon references, formatting rules, and responsive constants.

Web and desktop may share DOM-based components where the host technology permits it. React Native should consume the same tokens and semantic definitions but implement native components separately.

The shared layer must not force browser-only assumptions into mobile.

### 6.3 Recommended reusable primitives

The rebuilt interface should converge on reusable components for:

- Button / IconButton / SplitButton
- Input / SearchInput / TextArea
- Select / Combobox
- Date and range controls
- CommandBar / FilterBar
- Tabs / SegmentedControl
- SummaryStrip / KPI
- Card / Section
- Desktop DataTable
- Mobile RecordCard / CompactListRow
- Drawer / Sheet / Dialog
- DetailPanel
- FormSection / FieldGroup
- StatusBadge
- EmptyState
- Skeleton / LoadingState
- Banner / Alert
- Toast
- Pagination / LoadMore
- OfflineSyncIndicator
- ActivityTimeline / AuditTimeline
- ConfirmAction / DestructiveAction

## 7. Application Shell

### 7.1 Desktop and tablet web

The desktop shell should contain:

- brand area
- business and branch context
- grouped left navigation with parent/child hierarchy
- clear active-state treatment
- compact utility area for profile, help, notifications, and global actions where appropriate
- page header with title, explanation, context, and primary action
- optional contextual tabs or secondary navigation

The left navigation must be organized by business tasks rather than implementation modules. It should avoid becoming a long undifferentiated menu.

### 7.2 Mobile

Mobile must not collapse the desktop sidebar into a smaller sidebar.

Use mobile-native information architecture with:

- bottom navigation for highest-frequency destinations
- contextual top bar
- a More area for less-frequent modules
- role-aware prominence for Sell/POS or operational actions
- sheets and drawers for detail/correction flows
- persistent but calm offline/sync indication

Navigation emphasis can vary by role. A cashier and an owner should not receive identical navigation priority.

## 8. Role-Aware Experience

The shell and dashboards should adapt to the current role while keeping the product structurally familiar.

### Owner / manager

Prioritize:

- today’s sales and gross profit
- cash position
- money in vs money out
- outstanding customer credit
- supplier pressure
- low-stock and stock-out risk
- shrinkage/wastage anomalies
- returns/refunds
- branch comparison
- AI-generated explanations and recommended actions

### Cashier / frontline staff

Prioritize:

- sell action
- current shift
- cash drawer or money-account status
- recent transactions
- pending tasks
- operational warnings

### Inventory / purchasing roles

Prioritize:

- low stock
- receiving
- adjustments/corrections
- supplier context
- pending purchase actions
- movement history

## 9. Business-Pack Adaptation

Business packs should adapt workflow emphasis, terminology, shortcuts, and dashboards without creating unrelated applications.

Examples:

- **Retail / Hardware:** inventory, multi-unit selling, purchasing, customer credit, POS
- **Food / Waakye:** recipes, yields, portions, daily production, ingredient usage, wastage
- **Salon / Barber:** services, staff, consumables, appointments/queues where supported, commissions
- **Drinks / Spot:** crate/bottle/glass/shot conversion, tabs/credit, stock, high-speed POS
- **Washing Bay:** vehicle/service queue, service workflow, consumables
- **Car Park:** vehicle entry/exit, tickets/sessions, duration, cash collection

The adaptive model should be configuration-driven rather than implemented as forks.

## 10. Reference Page Patterns

### 10.1 Dashboard

The dashboard becomes an operational command center, not a generic card grid.

Metrics must either explain state, expose risk, or lead to an action/drill-down. Decorative metrics should be removed.

Use a hierarchy such as:

1. primary business state
2. urgent actions and exceptions
3. trends and summaries
4. AI explanations/recommendations
5. recent operational activity

### 10.2 Sell / POS

Sell is a flagship workflow and must optimize speed.

Required qualities:

- instant search
- category shortcuts
- barcode-ready architecture
- large touchable items on touch devices
- clear sellable-unit selection
- obvious quantity/unit editing
- optional customer attachment
- permission-aware discount controls
- clear payment-method selection
- split/multi-payment-ready layout where supported
- uncluttered totals
- editable cart
- visible offline state
- fast completion and receipt/share/print/new-sale actions

### 10.3 Catalog

Catalog must make complex unit and service rules understandable.

Use progressive disclosure for:

- product vs service
- variants
- buying, stocking, and selling units
- conversion chains
- prices and costs
- service consumables
- recipe/yield relationships
- active/archive lifecycle

### 10.4 Inventory

Inventory should focus on current balance, movement evidence, risk, and correction workflows.

Users should see:

- on-hand and available quantities
- unit context
- low-stock state
- latest movements
- source transactions
- adjustment/reclassification actions
- branch/location context where applicable

Never frame inventory as “edit balance.”

### 10.5 Sales, purchases, and corrections

Posted transactions should be presented as evidence pages.

List pages need fast search, meaningful filters, status/payment state, party context, amount/date/operator, and clear drill-down.

Detail pages should emphasize receipt/document evidence and expose correction actions separately in contextual sheets/drawers.

### 10.6 Master data

Customers and suppliers should use a consistent master-data pattern:

- summary
- contact/context
- balance/credit state
- recent activity
- related transactions
- edit lifecycle

## 11. Command Rows and Responsive Behavior

Desktop list/report pages should use a coherent command row containing, where relevant:

- search
- date scope
- filters
- sort
- view options
- primary action

At narrow widths, these controls should reflow into touch-safe grouped controls rather than wrapping randomly.

Tables may remain on wide screens. On narrow screens, dense rows should become mobile record cards, grouped summaries, or drill-down lists.

Target validation widths:

- 360px
- 390px
- 768px
- desktop widths

## 12. Offline and Sync UX

Offline behavior must be visible without making users think about synchronization internals.

The UI should distinguish:

- online and synchronized
- offline with queued work
- syncing
- blocked/conflicted
- failed and retryable

Users should see clear business-language messages such as “3 sales waiting to sync” rather than raw queue or transport terminology.

Offline work should remain usable unless the underlying operation genuinely requires connectivity.

## 13. AI Presentation

AI should be used as an operational assistant, not as decoration.

Preferred uses include:

- explaining cash pressure
- highlighting stock-out risk
- identifying unusual shrinkage or wastage
- surfacing customer-credit risk
- suggesting purchasing or pricing action
- summarizing business performance in plain language

AI recommendations must be visually distinguished from authoritative accounting facts and transaction evidence.

## 14. System-Admin Control Plane Alignment

The system-admin application is a separate product surface for TradeOS platform operators and must not be hidden inside the customer portal.

It should share the TradeOS visual language while using a more operational control-plane information architecture.

Expected areas include:

- tenant/business lifecycle
- subscriptions/plans/trials/renewals
- module entitlements and overrides
- payment/subscription operations
- devices and sync health
- release management for Web/Windows/macOS/Android/iOS
- minimum-supported-version controls
- feature flags
- platform users and roles
- integrations/configuration
- privileged support access with audit controls
- platform audit
- growth/revenue/operational dashboards

## 15. Data Flow and Error Handling

The frontend remains a consumer of authoritative backend contracts.

For mutations:

1. UI validates user input for usability.
2. API remains authoritative for permissions and business invariants.
3. Offline-capable mutations enter the durable queue when required.
4. UI displays optimistic/local state only where existing sync semantics support it.
5. Server rejection is translated into business-language feedback.
6. Conflict or replay state is exposed through structured resolution UI when necessary.

Every feature must define:

- initial loading state
- empty state
- validation state
- permission-denied state
- recoverable network/offline state
- server error state
- success state

Raw stack traces, transport messages, or internal sync terminology must not be surfaced to end users.

## 16. Accessibility and Interaction Standards

- Visible keyboard focus on web/desktop
- Logical tab order
- Proper labels and accessible names
- Sufficient contrast
- Hover, focus, pressed, selected, loading, and disabled states
- Pointer cursor for clickable web controls
- Minimum touch target sizing on touch devices
- No critical workflow that depends only on color
- Motion kept restrained and reduced-motion compatible

## 17. Z.ai Collaboration Boundary

Z.ai owns the frontend architecture and UX implementation within this design, including:

- tokens
- frontend primitives
- application shell
- navigation
- page composition
- responsive behavior
- design-system migration
- visual QA

Z.ai may refactor frontend-only structures when that improves maintainability.

Z.ai must not silently change:

- backend contracts
- database rules
- accounting invariants
- sync semantics
- posted-transaction behavior
- permission enforcement

Any required backend change must be raised as a proposal for review.

All Z.ai work must start from current `main`, live on a dedicated branch, and arrive through a pull request. Direct merges to `main` are not part of this workflow.

## 18. Migration Strategy

The rebuild should not attempt every page at once.

### Phase 1 — Foundation

- tokens
- typography
- spacing
- semantic colors
- primitives
- responsive shell
- desktop/mobile navigation
- states and feedback patterns

### Phase 2 — Reference screens

Rebuild and validate:

- Dashboard
- Sell/POS
- Catalog
- Sales history/detail
- Inventory
- Customers or another representative master-data page

These pages are the proof that the design language works across different interaction types.

### Phase 3 — Transaction and operations migration

Migrate:

- Returns/refunds/exchanges
- Purchases
- Suppliers
- Cashbook
- Operations
- Reports

### Phase 4 — Cross-platform alignment

Apply the design language to:

- desktop shell
- mobile client
- system-admin

Native clients should share tokens and UX semantics, not blindly reuse browser components.

## 19. Testing and Review

The frontend rebuild is not complete based on screenshots alone.

Required validation includes:

- existing unit/component tests where applicable
- route and workflow regression checks
- typecheck
- lint
- production build
- responsive validation at 360, 390, 768, and desktop widths
- keyboard/focus checks on web
- touch-target checks
- loading/empty/error/success-state checks
- offline/sync state checks
- role/permission presentation checks
- visual comparison of reference screens
- verification that transaction/domain behavior remains unchanged

Any changed business behavior requires explicit architectural review rather than being accepted as a frontend side effect.

## 20. Acceptance Criteria

The frontend rebuild is ready for broader migration only when the reference screens demonstrate all of the following:

- visibly modern and coherent TradeOS identity
- clear navigation and active states
- readable typography and appropriately sized controls
- good mobile composition without horizontal overflow
- deliberate desktop density
- reusable primitives and patterns rather than page-specific styling
- fast POS interaction
- clear unit/conversion presentation
- evidence-oriented transaction detail
- calm and understandable offline/sync feedback
- role-aware information priority
- accessible interaction states
- no regression of authoritative business behavior

## 21. Handoff Deliverables

Before the frontend rebuild PR is considered ready for review, Z.ai should provide:

- frontend architecture summary
- token/design-system summary
- desktop navigation architecture
- mobile navigation architecture
- route/page migration map
- reusable-component inventory
- screenshots or equivalent visual evidence for key screens at mobile/tablet/desktop sizes when tooling permits
- responsive and interaction QA notes
- list of any backend/API changes proposed but not silently implemented

## 22. Decision

TradeOS will proceed with a frontend-rebuild model in which Z.ai leads UX/UI architecture and implementation while the core product architecture, domain rules, API contracts, accounting invariants, offline behavior, and integration review remain authoritative constraints.

The current UI is not considered a design baseline that must be preserved. Existing business behavior is the baseline; the presentation layer may be substantially restructured to achieve the intended TradeOS product quality.
