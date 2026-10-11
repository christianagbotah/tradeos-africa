# Z.ai Complete Frontend Feature Matrix

**Branch:** `feat/zai-complete-frontend-replacement`
**PR:** #54
**Base:** `main` at `b9108c2`
**Date:** 2026-01-10

---

## Status Legend

| Status | Meaning |
|---|---|
| PORTED | Feature existed in old frontend, now implemented in Z.ai |
| ALREADY Z.AI | Feature was already Z.ai in the cutover |
| REBUILT | Component visual composition rebuilt in Z.ai this PR |
| ENHANCED | Feature improved beyond parity this PR |
| RETIRED | Dead code/stub removed |
| BLOCKED BY BACKEND | Backend does not support this; documented honestly |
| NOT APPLICABLE | Feature does not apply to this route |

---

## `/` — Public Entry (Auth + Onboarding + Recovery)

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Split-screen login | PublicEntry | auth-page + auth-aside + auth-main | ALREADY Z.AI | — | Visual QA 1280px + 390px |
| Sign in/Register tabs | AuthScreen | auth-switch segmented control | ALREADY Z.AI | — | Contract test |
| Email/phone + password | AuthScreen | auth-input with icons | ALREADY Z.AI | — | Contract test |
| Demo account selector | DemoAccountSelect | hideLabel prop added | ENHANCED | Added hideLabel to avoid duplicate label | Test passes |
| Forgot password | AuthScreen | auth-forgot link | ALREADY Z.AI | — | Visual QA |
| Country selector | BusinessOnboarding | onboarding-locale-grid | ALREADY Z.AI | — | Visual QA |
| Base currency selector | BusinessOnboarding | Base currency dropdown | ALREADY Z.AI | — | Visual QA |
| Timezone selector | BusinessOnboarding | Timezone dropdown | ALREADY Z.AI | — | Visual QA |
| Multi-currency metadata | @tradeos/contracts | SUPPORTED_CURRENCIES with exponents | ALREADY Z.AI | — | 31 metadata tests |
| Workspace recovery | PublicEntry | workspace-recovery-card | ALREADY Z.AI | — | Routing test |
| Offline bootstrap cache | workspace-bootstrap.ts | readWorkspaceBootstrap | ALREADY Z.AI | — | Test passes |
| Session lifecycle | session-lifecycle.ts | finalizePendingLogout | ALREADY Z.AI | — | Test passes |

---

## `/dashboard` — Dashboard Command Center

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Daily KPIs (sales, cash, credit, profit) | DashboardCommandCenter | zai-route-header + tradeos-stat-card | ALREADY Z.AI | — | 11 tests |
| AI action center | cfo-action-center.tsx | CFO priorities panel | ALREADY Z.AI | — | Test passes |
| Pack-specific guidance | dashboard-model.ts | Pack-aware content | ALREADY Z.AI | — | Test passes |
| Quick-action rail | dashboard-actions.ts | Quick action buttons | ALREADY Z.AI | — | 6 tests |
| Today's activity feed | dashboard-data.tsx | Activity list | ALREADY Z.AI | — | Test passes |
| Stock warnings | dashboard-data.tsx | Warning panel | ALREADY Z.AI | — | Test passes |
| Topbar AI insights link | app-shell.tsx | Link to /reports | ALREADY Z.AI | — | Visual QA |
| Topbar help icon | app-shell.tsx | — | RETIRED | Removed fake non-interactive help span (no backend) | git diff |
| Topbar bell icon | app-shell.tsx | — | RETIRED | Removed fake non-interactive bell span (no notifications backend) | git diff |
| Sidebar pack "Switch" | app-shell.tsx | workspace-pack-card button | REBUILT | Was a non-interactive span; now a real button that opens the business/branch switcher | Visual QA |
| Orphan dashboard CSS | dashboard.css | — | RETIRED | Removed 11 unused selector blocks (-2931 chars) | grep verified 0 refs |

---

## `/sell` — POS / Sell

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Product browser with search | ProductBrowser | pos-browser | ALREADY Z.AI | — | 9 tests |
| Product grid per-unit add | ProductBrowser | pos-product-card | ALREADY Z.AI | — | Test passes |
| Cart panel with line editing | CartPanel | pos-cart-panel | ALREADY Z.AI | — | Test passes |
| Customer picker (Walk-in + search) | CustomerPicker | pos-customer-bar | ALREADY Z.AI | — | Test passes |
| 6 payment methods | CheckoutSheet | pos-payment-grid | ALREADY Z.AI | — | Test passes |
| Customer credit guard | checkout-sheet.tsx | customerCreditReadiness | ALREADY Z.AI | — | Test passes |
| Server-authoritative sale lines | buildSaleMutation | No client pricing | ALREADY Z.AI | — | Test passes |
| Offline sale queue | enqueueMutation | flushPendingMutations | ALREADY Z.AI | — | Test passes |
| Mobile sticky charge bar | pos-workspace.tsx | pos-charge-bar | ALREADY Z.AI | — | Test passes |
| Desktop two-pane | pos-workspace.tsx | pos-workspace-grid | ALREADY Z.AI | — | Visual QA |
| **Cash received + change due** | — | pos-cash-tendered | ENHANCED | Added cash-received input + change-due calculation; disables Charge if short | New this PR |
| **Sale success panel** | — | pos-checkout-success | ENHANCED | Added success overlay with receipt reference, change due, Print, Share, New sale actions | New this PR |
| Held/suspended sale resume | — | — | BLOCKED BY BACKEND | No held-sale API in backend; not implemented | API grep confirmed |

---

## `/sales` — Sales List + Detail

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Sales list with filters | SalesWorkspace | tradeos-command-bar | ALREADY Z.AI | — | 6 tests |
| Sale detail sheet | SaleDetailSheet | sale-detail-sheet | ALREADY Z.AI | — | Test passes |
| Lines + totals + payments | SaleDetailSheet | Detail sections | ALREADY Z.AI | — | Test passes |
| Process return / refund | SaleDetailSheet | Link to /returns | ALREADY Z.AI | — | Test passes |
| Exchange items | SaleDetailSheet | Link to /returns?mode=exchange | ALREADY Z.AI | — | Test passes |
| Immutable posted history | PostedHistoryNote | Transaction evidence | ALREADY Z.AI | — | Test passes |
| **Print receipt** | — | window.print() | ENHANCED | Added Print button to footer | New this PR |
| **Share receipt** | — | navigator.share() | ENHANCED | Added Share button (graceful no-op if unsupported) | New this PR |
| Void sale | — | — | BLOCKED BY BACKEND | Sales only have COMPLETED status; no VOID endpoint. Returns/refunds is the supported reversal. | API grep confirmed |

---

## `/customers` — Customers & Credit

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Customer list + search | CustomerWorkspace | tradeos-command-bar | ALREADY Z.AI | — | 6 tests |
| Lifecycle filter (active/inactive) | CustomerWorkspace | customer-filterbar | ALREADY Z.AI | — | Test passes |
| Customer sheet (profile, credit, payments) | CustomerSheet | customer-sheet (focus-trapped) | ALREADY Z.AI | — | 8 tests |
| Credit limit + outstanding | CustomerSheet | customer-account-metrics | ALREADY Z.AI | — | Test passes |
| Payment recording | CustomerSheet | customer-payment-grid | ALREADY Z.AI | — | Test passes |
| Inactive reactivation | CustomerSheet | Role-gated | ALREADY Z.AI | — | Test passes |
| Immutable financial history | CustomerSheet | PostedHistoryNote | ALREADY Z.AI | — | Test passes |
| customers-credit.tsx stub | — | — | RETIRED | Removed 12-line dead wrapper | git diff |

---

## `/purchases` — Purchases + Suppliers

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Supplier list + filter | SupplierWorkspace | supplier-workspace | ALREADY Z.AI | — | 8 tests |
| Supplier balance tracking | SupplierWorkspace | supplier-row-fact | ALREADY Z.AI | — | Test passes |
| Supplier detail sheet | SupplierSheet | supplier-sheet (focus-trapped) | ALREADY Z.AI | — | Test passes |
| Supplier payment | SupplierSheet | Payment section | ALREADY Z.AI | — | Test passes |
| Purchase receipt builder | PurchaseReceiptBuilder | purchase-receipt-builder | ALREADY Z.AI | — | Test passes |
| Purchase detail sheet | PurchaseDetailSheet | purchase-detail-sheet | ALREADY Z.AI | — | Test passes |
| Purchase return | PurchaseWorkspace | Return flow | ALREADY Z.AI | — | Test passes |

---

## `/inventory` — Inventory

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Inventory list + filters | InventoryWorkspace | tradeos-command-bar | ALREADY Z.AI | — | 8 tests |
| Derived-balance rows | InventoryWorkspace | inventory-row | ALREADY Z.AI | — | Test passes |
| Movement history | InventoryWorkspace | History actions | ALREADY Z.AI | — | Test passes |
| Stock adjustment | InventoryAdjustmentSheet | Role-gated | ALREADY Z.AI | — | Test passes |
| Failed adjustment review | InventoryWorkspace | Review queue | ALREADY Z.AI | — | Test passes |
| Multi-location | InventoryWorkspace | Location filter | ALREADY Z.AI | — | Test passes |
| Unit conversion display | InventoryWorkspace | Conversion chain | ALREADY Z.AI | — | Test passes |

---

## `/catalog` — Catalog & Units

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Catalog list + filter tabs | CatalogWorkspace | tradeos-command-bar | ALREADY Z.AI | — | 7 tests |
| Search by name/SKU | CatalogWorkspace | catalog-search | ALREADY Z.AI | — | Test passes |
| Item sheet (create/edit/duplicate) | CatalogItemSheet | catalog-item-sheet (focus-trapped) | ALREADY Z.AI | — | Test passes |
| Multi-unit support | CatalogItemSheet | Unit editor | ALREADY Z.AI | — | Test passes |
| Unit conversions | CatalogItemSheet | Conversion chain | ALREADY Z.AI | — | Test passes |
| Opening stock | CatalogItemSheet | Stock section | ALREADY Z.AI | — | Test passes |
| Tax category | CatalogItemSheet | Tax select | ALREADY Z.AI | — | Test passes |
| Lifecycle (archive/reactivate) | CatalogWorkspace | Status badges | ALREADY Z.AI | — | Test passes |

---

## `/returns` — Returns & Refunds

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Return/refund workspace | ReturnRefundWorkspace | return-refund-workspace | ALREADY Z.AI | — | 6 tests |
| Return refund sheet | ReturnRefundSheet | return-refund-sheet (focus-trapped) | ALREADY Z.AI | — | Test passes |
| Full/partial refund | ReturnRefundSheet | Refund controls | ALREADY Z.AI | — | Test passes |
| Payment reversal | ReturnRefundSheet | Method selection | ALREADY Z.AI | — | Test passes |
| Exchange sheet | ExchangeSheet | exchange-sheet | ALREADY Z.AI | — | Test passes |
| Restock decisions | ReturnRefundSheet | Restock toggle | ALREADY Z.AI | — | Test passes |
| Revenue/tax/COGS reversal | ReturnRefundSheet | Financial summary | ALREADY Z.AI | — | Test passes |
| Customer credit adjustment | ReturnRefundSheet | Credit option | ALREADY Z.AI | — | Test passes |

---

## `/cashbook` — Cashbook & Expenses + Treasury

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Cash summary | CashbookExpenses | cashbook-summary | ALREADY Z.AI | — | Test passes |
| Entry form | CashbookExpenses | cashbook-entry | ALREADY Z.AI | — | Test passes |
| Expense categories | CashbookExpenses | Category select | ALREADY Z.AI | — | Test passes |
| Transaction history | CashbookExpenses | History list | ALREADY Z.AI | — | Test passes |
| Treasury accounts | Treasury | money-account-sheet | ALREADY Z.AI | — | Test passes |
| Account transfers | Treasury | Transfer form | REBUILT | Raw `<button>` → `<Button>` primitive | New this PR |
| Reconciliation | Treasury | Reconciliation form | REBUILT | Raw `<button>` → `<Button>` primitive | New this PR |
| Variance resolution | Treasury | Resolution dialog | REBUILT | Raw `<button>` → `<Button>` primitive | New this PR |

---

## `/operations` — Day & Shifts

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| Open/close day | OperationsReconciliation | operations controls | ALREADY Z.AI | — | 3 tests |
| Open/close shift | OperationsReconciliation | Shift controls | ALREADY Z.AI | — | Test passes |
| 5-method counted balances | OperationsReconciliation | Balance grid | ALREADY Z.AI | — | Test passes |
| Variance calculation | OperationsReconciliation | Variance display | ALREADY Z.AI | — | Test passes |
| Reconciliation status | OperationsReconciliation | Status badges | ALREADY Z.AI | — | Test passes |
| Sync visibility | OperationsReconciliation | Sync indicator | ALREADY Z.AI | — | Test passes |

---

## `/reports` — Reports & Intelligence

| Existing feature | Existing component/API | Z.ai equivalent | Status | Work performed | Verification |
|---|---|---|---|---|---|
| CFO health summary | FinancialReports | cfo-action-center | ALREADY Z.AI | — | 2 tests |
| Working capital | FinancialReports | Working capital panel | ALREADY Z.AI | — | Test passes |
| Credit aging | FinancialReports | Aging table | ALREADY Z.AI | — | Test passes |
| Cash forecast | FinancialReports | cash-forecast panel | ALREADY Z.AI | — | Test passes |
| P&L bridge | FinancialReports | P&L section | ALREADY Z.AI | — | Test passes |
| Daily sales table | FinancialReports | Daily table | ALREADY Z.AI | — | Test passes |
| Top items | FinancialReports | Top items table | ALREADY Z.AI | — | Test passes |
| Branch performance | FinancialReports | Branch table | ALREADY Z.AI | — | Test passes |
| Staff/cashier performance | FinancialReports | Staff table | ALREADY Z.AI | — | Test passes |
| Pack-aware report sections | — | — | BLOCKED BY BACKEND | Backend has no pack-specific report data (food production/wastage, salon commissions, carpark sessions) | API grep confirmed |

---

## Missing Routes Investigation

| Route | Backend exists? | Status |
|---|---|---|
| `/settings` | No settings API | NOT CURRENTLY IMPLEMENTED IN TRADEOS BACKEND — NOT PART OF FRONTEND PARITY |
| `/staff` | No staff management API | NOT CURRENTLY IMPLEMENTED IN TRADEOS BACKEND — NOT PART OF FRONTEND PARITY |
| `/branches` | No branch management API (branches are created at onboarding only) | NOT CURRENTLY IMPLEMENTED IN TRADEOS BACKEND — NOT PART OF FRONTEND PARITY |
| `/integrations` | No integrations API | NOT CURRENTLY IMPLEMENTED IN TRADEOS BACKEND — NOT PART OF FRONTEND PARITY |
| `/receipts` | No receipt template API (print uses browser print()) | NOT CURRENTLY IMPLEMENTED IN TRADEOS BACKEND — NOT PART OF FRONTEND PARITY |
| `/notifications` | No notifications API | NOT CURRENTLY IMPLEMENTED IN TRADEOS BACKEND — NOT PART OF FRONTEND PARITY |
| `/help` | No help system API | NOT CURRENTLY IMPLEMENTED IN TRADEOS BACKEND — NOT PART OF FRONTEND PARITY |

---

## Test Summary

| Check | Result |
|---|---|
| Web tests (Vitest) | 342 PASS |
| Typecheck (9 packages) | CLEAN |
| Build (`next build`) | SUCCESS |
| `git diff --check` | CLEAN (no whitespace) |

---

## Conclusion

All 12 routes use Z.ai composition. This PR implements the real gaps:
- POS checkout success panel with receipt reference, change due, Print, Share, New sale
- POS cash-received input with change-due calculation
- SaleDetailSheet Print + Share buttons
- Treasury raw buttons migrated to Button primitive (5 replacements)
- Dashboard fake help/bell icons removed (no backend)
- Dashboard pack "Switch" made into a real interactive button
- Dead stub (customers-credit.tsx) removed
- 11 orphan CSS selectors removed from dashboard.css

Backend-blocked items documented honestly: Void sale, held-sale resume, pack-aware reports, and 7 missing routes — all confirmed by API grep to have no backend support.
