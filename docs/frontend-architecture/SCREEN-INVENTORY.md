# TradeOS Africa — Screen Inventory

**Branch:** `feat/zai-all-frontends-greenfield`
**Date:** 2026-01-11

---

## Web Application (`apps/web`)

| Route | Screen | Status |
|---|---|---|
| `/` | PublicEntry (auth + onboarding + recovery) | DONE |
| `/dashboard` | DashboardCommandCenter | DONE |
| `/sell` | PosWorkspace | DONE |
| `/sales` | SalesWorkspace + SaleDetailSheet | DONE |
| `/customers` | CustomerWorkspace + CustomerSheet | DONE |
| `/purchases` | SupplierWorkspace + PurchaseReceiptBuilder + PurchaseWorkspace | DONE |
| `/inventory` | InventoryWorkspace + AdjustmentSheet | DONE |
| `/catalog` | CatalogWorkspace + CatalogItemSheet | DONE |
| `/returns` | ReturnRefundWorkspace + ReturnRefundSheet + ExchangeSheet | DONE |
| `/cashbook` | CashbookExpenses + Treasury | DONE |
| `/operations` | OperationsReconciliation | DONE |
| `/reports` | FinancialReports | DONE |

---

## System Admin Application (`apps/system-admin`)

| Route | Screen | Status |
|---|---|---|
| `/` | Overview dashboard (platform metrics) | BUILD |
| `/tenants` | Tenant/business management | BUILD |
| `/subscriptions` | Plans, trials, billing | BUILD |
| `/devices` | Device + sync health | BUILD |
| `/audit` | Platform audit log | BUILD |
| `/releases` | Client version management | BUILD |
| `/flags` | Feature flags | BUILD |

---

## Desktop Application (`apps/desktop`)

| Screen | Status |
|---|---|
| Login / auth gate | BUILD |
| Dashboard | BUILD |
| POS (full workspace) | BUILD |
| Sales list + detail | BUILD |
| Inventory | BUILD |
| Customers | BUILD |
| Reports | BUILD |
| Settings (printer, scanner, cash drawer) | BUILD |

---

## Mobile Application (`apps/mobile`)

| Screen | Status |
|---|---|
| Login | EXISTS (needs design system) |
| Dashboard | BUILD (owner briefing) |
| POS | EXISTS (needs design system) |
| Sales | BUILD |
| Customers | BUILD |
| Reports | BUILD |
| More (settings, sync, branch switch) | BUILD |

---

## Sheets / Dialogs (cross-app)

| Sheet | Web | Desktop | Mobile |
|---|---|---|---|
| Checkout | DONE | BUILD | BUILD |
| Customer detail | DONE | BUILD | BUILD |
| Sale detail | DONE | BUILD | — |
| Catalog item | DONE | — | — |
| Inventory adjustment | DONE | BUILD | — |
| Return/refund | DONE | — | — |
| Exchange | DONE | — | — |
| Supplier detail | DONE | — | — |
| Purchase receipt | DONE | — | — |
| Money account | DONE | — | — |
