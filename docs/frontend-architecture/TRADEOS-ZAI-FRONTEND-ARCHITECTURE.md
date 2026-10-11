# TradeOS Africa — Z.ai Frontend Architecture

**Owner:** Z.ai Frontend
**Branch:** `feat/zai-all-frontends-greenfield`
**Date:** 2026-01-11

---

## 1. Frontend Ownership Boundaries

### Z.ai Owns (Frontend)
```
apps/web/**           — Web application (Next.js 16)
apps/system-admin/**  — Platform operator console (Next.js 16)
apps/desktop/**       — Desktop application (React + Vite + Tauri 2)
apps/mobile/**        — Mobile application (Expo + React Native)
```

### Z.ai May Create (Frontend-Owned Shared Packages)
```
packages/ui/              — Shared React primitives (web + system-admin + desktop)
packages/design-system/   — Design tokens, type definitions, icon registry
```

### Backend Team Owns (Do NOT Modify)
```
apps/api/**            — Fastify API server
packages/contracts/**  — Shared TypeScript contracts + currency metadata
packages/domain/**     — Domain logic (money, returns, cash forecast)
packages/client-core/** — Client platform profiles, sync infrastructure
packages/db/**         — PostgreSQL migrations
```

---

## 2. Monorepo Structure

```
tradeos-africa/
├── apps/
│   ├── api/              BACKEND
│   ├── web/              Z.AI — Next.js 16 (App Router)
│   ├── system-admin/     Z.AI — Next.js 16 (App Router)
│   ├── desktop/          Z.AI — Vite + Tauri 2
│   └── mobile/           Z.AI — Expo + React Native
├── packages/
│   ├── contracts/        BACKEND — types + currency metadata
│   ├── domain/           BACKEND — money, returns, forecast
│   ├── client-core/      BACKEND — platform profiles, sync
│   ├── db/               BACKEND — migrations
│   ├── ui/               Z.AI — shared React primitives (planned)
│   └── design-system/    Z.AI — tokens, types, icons (planned)
├── docs/
│   ├── frontend-architecture/
│   │   ├── TRADEOS-ZAI-FRONTEND-ARCHITECTURE.md  (this file)
│   │   ├── SCREEN-INVENTORY.md
│   │   └── API-GAP-REGISTER.md
│   ├── frontend-api-requirements/   (per-feature backend gaps)
│   └── qa/                          (evidence, matrices)
└── pnpm-workspace.yaml
```

---

## 3. Web Architecture (`apps/web`)

**Stack:** Next.js 16, React 19, TypeScript 5.9, App Router
**Status:** Complete (PR #53 + #54)

### Structure
```
apps/web/app/
├── layout.tsx              — Root layout, CSS imports
├── page.tsx                — PublicEntry (auth + onboarding + recovery)
├── globals.css             — Reset + base
├── tradeos-tokens.css      — Design tokens (colors, spacing, typography)
├── ui-primitives.css       — Shared primitive styles
├── zai-reference.css       — Z.ai reference presentation
├── zai-correctness.css     — Interaction safeguards
├── (workspace)/
│   ├── layout.tsx          — WorkspaceProvider + Boundary + AppShell
│   ├── dashboard/page.tsx
│   ├── sell/page.tsx       — POS
│   ├── sales/page.tsx
│   ├── customers/page.tsx
│   ├── purchases/page.tsx
│   ├── inventory/page.tsx
│   ├── catalog/page.tsx
│   ├── returns/page.tsx
│   ├── cashbook/page.tsx
│   ├── operations/page.tsx
│   └── reports/page.tsx
└── components/
    ├── workspace/          — Shell, navigation, boundary, provider
    ├── pos/                — POS workspace, browser, cart, checkout
    ├── sales/              — Sales workspace + detail sheet
    ├── customers/          — Customer workspace + sheet
    ├── catalog/            — Catalog workspace + item sheet
    ├── inventory/          — Inventory workspace + adjustment
    ├── returns/            — Return/refund workspace + sheets
    ├── purchases/          — Supplier + purchase workspaces
    ├── cashbook/           — Cashbook expenses
    ├── treasury/           — Money account sheet
    ├── dashboard/          — Dashboard command center
    ├── business/           — MoneyValue, transaction evidence
    └── ui/                 — Button, MoneyInput, etc.
```

### CSS Architecture
Modular — one CSS file per route/module:
- `tradeos-tokens.css` — design tokens (single source of truth)
- `ui-primitives.css` — shared primitives
- Per-route CSS (`dashboard.css`, `pos.css`, `catalog.css`, etc.)
- `zai-reference.css` + `zai-correctness.css` — Z.ai presentation + safeguards
- NO monolithic stylesheet, NO Tailwind

### State Management
- React `useState` / `useReducer` for local component state
- `WorkspaceProvider` (React Context) for session + business context
- `@tradeos/contracts` for currency metadata + types
- `@tradeos/client-core` for platform profiles
- Offline queue via `lib/offline-sync.ts` (localStorage-backed)

---

## 4. System Admin Architecture (`apps/system-admin`)

**Stack:** Next.js 16, React 19, TypeScript 5.9, App Router
**Status:** Greenfield rebuild (current is a placeholder)

### Purpose
TradeOS platform operator console — separate from tenant/business administration. For super admins, support, compliance, billing.

### Structure
```
apps/system-admin/app/
├── layout.tsx              — Root layout, admin CSS
├── page.tsx                — Overview dashboard
├── globals.css
├── admin-tokens.css        — Admin design tokens (darker, denser)
├── admin-shell.css         — Admin shell + navigation
├── (console)/
│   ├── layout.tsx          — AdminShell (sidebar + topbar)
│   ├── tenants/page.tsx    — Business/tenant management
│   ├── subscriptions/page.tsx
│   ├── devices/page.tsx    — Device + sync health
│   ├── audit/page.tsx      — Platform audit log
│   ├── releases/page.tsx   — Client version management
│   └── flags/page.tsx      — Feature flags
└── components/
    ├── admin-shell.tsx     — Sidebar + topbar + responsive
    ├── admin-sidebar.tsx
    ├── admin-topbar.tsx
    ├── tenant-table.tsx
    ├── tenant-detail.tsx
    └── stat-card.tsx
```

### Design Language
- Same TradeOS tokens but a denser, more "operator" feel
- Darker sidebar (midnight), lighter content area
- Higher information density than merchant app
- Clear "privileged access" visual cues

### Auth
- Separate from merchant auth — uses platform-admin session
- Backend blocker: platform-admin auth API needed (see API-GAP-REGISTER.md)

---

## 5. Desktop Architecture (`apps/desktop`)

**Stack:** React 19, Vite 8, Tauri 2, TypeScript 5.9
**Status:** Greenfield rebuild (current is a placeholder shell)

### Purpose
Counter/office POS workstation. Optimized for keyboard, barcode scanner, receipt printer, cash drawer.

### Structure
```
apps/desktop/src/
├── main.tsx                — React root
├── App.tsx                 — App shell + routing
├── styles.css              — Global + tokens (shared with web)
├── screens/
│   ├── Dashboard.tsx
│   ├── Pos.tsx             — Full-screen POS mode
│   ├── Sales.tsx
│   ├── Inventory.tsx
│   ├── Customers.tsx
│   └── Reports.tsx
├── components/
│   ├── Sidebar.tsx
│   ├── Topbar.tsx
│   ├── PosCart.tsx
│   ├── PosBrowser.tsx
│   └── CheckoutDialog.tsx
├── hooks/
│   ├── useNativeCapabilities.ts  — Tauri capability detection
│   ├── useBarcodeScanner.ts      — Barcode input handling
│   └── useReceiptPrinter.ts      — Tauri print integration
└── lib/
    ├── tauri-api.ts        — Tauri IPC bridge
    └── desktop-sync.ts     — Background sync state
```

### Tauri Integration
- `src-tauri/` contains Rust config + capabilities
- Desktop app consumes `@tradeos/client-core` for platform profiles
- Native capabilities (barcode, printer, cash drawer) via Tauri plugins
- Offline-first: local sync queue + background flush

### Design Language
- Shares TradeOS tokens with web
- Larger touch targets (counter POS context)
- Keyboard shortcuts visible in UI
- Native window controls (titlebar, minimize, maximize)

---

## 6. Mobile Architecture (`apps/mobile`)

**Stack:** Expo 57, React Native 0.86, React 19.2, TypeScript 5.9
**Status:** Has real infrastructure, needs design system layer

### Purpose
Business owner's phone — daily command center, quick actions, POS for tablet cashiers.

### Structure
```
apps/mobile/
├── App.tsx                 — Root, auth gate, navigation
├── app.json                — Expo config
├── src/
│   ├── api-client.ts       — MobileApiClient (exists, real)
│   ├── runtime.ts          — MobileRuntime (exists, real)
│   ├── app-model.ts        — App state model (exists, real)
│   ├── pos-model.ts        — POS cart/sale logic (exists, real)
│   ├── native-storage.ts   — AsyncStorage + SecureStore (exists, real)
│   ├── storage.ts          — Queue storage (exists, real)
│   ├── theme.ts            — Design tokens (NEW — RN StyleSheet)
│   ├── components/
│   │   ├── Button.tsx      — RN Button primitive
│   │   ├── Card.tsx        — RN Card primitive
│   │   ├── Input.tsx       — RN TextInput wrapper
│   │   ├── StatCard.tsx    — KPI card
│   │   ├── EmptyState.tsx  — Empty/loading/error states
│   │   ├── SyncBadge.tsx   — Offline/sync status
│   │   └── BottomNav.tsx   — Tab bar navigation
│   └── screens/
│       ├── LoginScreen.tsx
│       ├── DashboardScreen.tsx
│       ├── PosScreen.tsx
│       ├── SalesScreen.tsx
│       ├── CustomersScreen.tsx
│       └── ReportsScreen.tsx
```

### Design Language
- Same TradeOS tokens, expressed as RN StyleSheet values
- Bottom tab navigation (native iOS/Android pattern)
- SafeAreaView for notch/home indicator
- Touch-first: 48px minimum touch targets
- Native-feeling sheets (react-native Modal or @gorhom/bottom-sheet)

### Offline
- Uses existing `MobileRuntime` + `MobileApiClient`
- NetInfo for connectivity detection
- AsyncStorage for local queue
- Sync status visible in UI

---

## 7. Shared Design System

### Design Tokens (single source of truth)
Defined in `packages/contracts` or `packages/design-system`:
- **Colors:** canvas, surface, text, border, midnight, gold, positive, warning, danger, info
- **Typography:** font families, sizes (body 16px, supporting 14px, meta 12px), weights
- **Spacing:** 4/8/12/16/20/24/32px scale
- **Radius:** sm 12px, md 16px, lg 20px
- **Touch:** mobile 48px, icon 44px
- **Shadows:** 3 levels
- **Motion:** fast 150ms, medium 220ms
- **Breakpoints:** compact 480px, phone 768px, desktop 1100px

### Token Consumption
- **Web/System-Admin:** CSS custom properties (`var(--tos-gold)`)
- **Desktop:** CSS custom properties (same as web)
- **Mobile:** RN StyleSheet values imported from `theme.ts`

### Shared React Primitives (`packages/ui/` — planned)
For web + system-admin + desktop (all React DOM):
- `Button` — variant: primary | secondary | ghost | danger
- `Input` / `Select` / `Textarea`
- `MoneyInput` — currency-aware input
- `Card` / `StatCard`
- `Badge` / `StatusBadge`
- `Dialog` / `Sheet`
- `CommandBar` — filter + search + actions toolbar
- `MobileRecordCard` — responsive record card
- `StatePanel` — empty/loading/error states

Mobile uses native RN equivalents implementing the same tokens.

---

## 8. Frontend State Management

### Web
- `WorkspaceProvider` (Context) — session, business context, catalog
- `useState` / `useReducer` for local state
- Offline queue: `lib/offline-sync.ts` (localStorage)
- No Redux/Zustand — Context is sufficient

### System Admin
- `AdminProvider` (Context) — admin session, tenant list
- Same pattern as web

### Desktop
- `useState` / `useReducer`
- Tauri store for persistent local state
- `@tradeos/client-core` for platform profile

### Mobile
- `MobileAppModel` (exists) — central state model
- `MobileRuntime` (exists) — sync + API orchestration
- React `useState` for screen-level state

---

## 9. API Client Architecture

### Web / System Admin
- `fetch()` to relative paths (Caddy gateway forwards to API on port 4000)
- `lib/client-api.ts` — typed wrapper with `ClientApiError`
- `lib/offline-sync.ts` — mutation queue + flush

### Desktop
- Same `fetch()` pattern, but API base URL configurable (Tauri settings)
- `lib/desktop-sync.ts` — background sync with Tauri timer

### Mobile
- `MobileApiClient` (exists) — configured with API base URL
- `MobileRuntime` (exists) — orchestrates sync + retry
- Handles auth tokens via SecureStore

---

## 10. Offline-State Architecture

### Visual States (all apps)
| State | Visual |
|---|---|
| Online | Green wifi icon |
| Offline | Gray wifi-off icon |
| Locally queued | Pending badge on record |
| Syncing | Spinner + "syncing" text |
| Sync failed | Red badge + retry action |
| Conflict/review | Warning badge + review queue |
| Synced | Green checkmark (brief) |

### Infrastructure
- `packages/client-core` — platform profiles + capability detection
- Web: `lib/offline-sync.ts` (localStorage queue)
- Desktop: same + Tauri persistent storage
- Mobile: `MobileRuntime` + AsyncStorage

---

## 11. Routing / Navigation

### Web
- App Router: `/(workspace)/*` routes
- Sidebar (desktop) + bottom nav (mobile) + more sheet
- Global search in topbar

### System Admin
- App Router: `/(console)/*` routes
- Sidebar only (desktop-first, no mobile bottom nav)
- Tenant switcher in topbar

### Desktop
- Client-side routing (React state, no router lib)
- Sidebar navigation
- POS can go full-screen

### Mobile
- Bottom tab bar (Dashboard, Sell, Sales, More)
- Stack navigation for detail screens
- Modal for sheets/dialogs

---

## 12. Authentication Frontend Flows

### Web
- `PublicEntry` — loading → auth → onboarding → redirect
- Session via `/api/session/me`
- Logout pending finalization (offline-aware)

### System Admin
- Separate admin auth (platform-admin session)
- Backend blocker: admin auth API needed

### Desktop
- Same as web — opens to login if no session
- Session persisted in Tauri store

### Mobile
- `MobileRuntime` handles auth
- Login screen → session stored in SecureStore
- Biometric unlock (future, if backend supports)

---

## 13. Authorization Presentation

### RBAC
- Roles: OWNER, ADMIN, MANAGER, CASHIER, SALES, INVENTORY, ACCOUNTANT, STAFF, VIEWER
- `workspace-navigation.ts` — role-based nav visibility
- Action-level: role checks before rendering write controls
- Server-authoritative: backend enforces, frontend only hides

### System Admin
- Platform-admin roles (separate from tenant roles)
- Backend blocker: platform-admin RBAC API needed

---

## 14. Responsive Strategy

### Web
- Desktop (≥1100px): sidebar + wide tables + two-pane POS
- Tablet (768–1100px): collapsible sidebar + card layouts
- Phone (<768px): bottom nav + mobile record cards + sticky charge bar

### System Admin
- Desktop-first (≥1024px): sidebar + dense tables
- Tablet (≤1024px): collapsible sidebar
- Not optimized for phone (operator console is desktop-only)

### Desktop
- Resizable window (min 1024×768)
- POS full-screen mode
- No mobile responsive needed (native window)

### Mobile
- Phone-first (375–430px width)
- Tablet: adaptive layouts (split views where sensible)
- SafeAreaView for notch/home indicator

---

## 15. Accessibility

### All Apps
- Semantic HTML / native RN components
- Keyboard navigation (web + desktop)
- Visible focus states
- ARIA labels on interactive elements
- 48px minimum touch targets
- Sufficient contrast (WCAG AA)
- Screen reader support (aria-live for status, role for dialogs)

### Mobile-Specific
- `accessibilityLabel` / `accessibilityRole` on all RN components
- `accessibilityHint` for non-obvious actions
- Large content support (`accessibilityIgnoresInvertColors` where needed)

---

## 16. Testing Strategy

### Web
- Vitest — unit + component tests
- `public-entry-contract.test.ts` — class contract regression
- Per-module tests (dashboard, pos, catalog, etc.)
- 342 tests currently passing

### System Admin
- Vitest — to be set up
- Contract tests for admin shell

### Desktop
- Vitest — to be set up
- Tauri mock for IPC tests

### Mobile
- Vitest (exists) — `runtime.test.ts`, `app-model.test.ts`, `pos-model.test.ts`
- React Native Testing Library (to add)

---

## 17. Visual QA Strategy

### Breakpoints
- Web: 1440px, 1280px, 768px, 390px, 360px
- System Admin: 1440px, 1280px, 1024px
- Desktop: 1440×900, 1280×800, full-screen POS
- Mobile: iPhone 14 (390×844), Android Pixel (412×915), iPhone SE (375×667)

### Evidence
- Screenshots in `docs/qa/evidence/<phase>/`
- VLM analysis for visual quality verification
- Computed-style verification (not just "CSS exists")

---

## 18. Build / Deployment Strategy

### Web
- `pnpm --filter @tradeos/web build` → `.next/`
- Deploy: copy `.next/` to VPS, restart Next.js process
- Contracts must be built first: `pnpm --filter @tradeos/contracts build`

### System Admin
- Same as web: `pnpm --filter @tradeos/system-admin build`
- Deploy: separate Next.js process on different port/subdomain

### Desktop
- `pnpm --filter @tradeos/desktop build` → Vite build
- `pnpm --filter @tradeos/desktop desktop:build` → Tauri installer
- Outputs: `.msi` (Windows), `.dmg` (macOS)

### Mobile
- `expo export` → web bundle (for OTA)
- `eas build` → native APK/AAB (Android) / IPA (iOS)
- OTA updates via EAS Update

---

## 19. No-Fake-Features Rule

If the backend does not support a feature:
1. Render an honest unavailable state (disabled button with tooltip)
2. OR build behind a typed adapter that throws "not implemented"
3. Document in `docs/frontend-architecture/API-GAP-REGISTER.md`

**Never** simulate financial or operational success.

---

## 20. Implementation Order

| Phase | Scope | Status |
|---|---|---|
| 1 — Foundation | Design tokens, shared packages, navigation | Tokens exist in web; shared packages planned |
| 2 — Web | Complete web app | DONE (PR #53 + #54) |
| 3 — System Admin | Platform operator console | IN PROGRESS |
| 4 — Desktop | Tauri desktop app | IN PROGRESS |
| 5 — Mobile | Expo mobile app | IN PROGRESS (has infrastructure) |
