# TradeOS Africa — Ghana Market Pilot UAT Checklist

## Purpose

Use this checklist before allowing a real Ghanaian merchant pilot on TradeOS Africa. The automated Ghana market readiness gate proves ledger arithmetic, replay safety, role boundaries and AI mutation safety. This checklist confirms the deployed staging experience exposes those capabilities coherently through the actual Web UI and deployed API.

**Environment:** TradeOS staging only. Do not use real merchant/customer/payment-provider data during this checklist.

**Result convention:** Record each item as `PASS`, `FAIL`, or `BLOCKED`, with a short observation and screenshot/reference where useful. A single financial reconciliation, tenant-isolation, permission, sync-idempotency, or data-loss failure is a release blocker.

## 1. Access and phone-first identity

- [ ] Open the tenant Web portal over HTTPS with no mixed-content or localhost API requests.
- [ ] Register a test owner using a Ghana phone number and no email address.
- [ ] Confirm the phone number is normalized to E.164 and can be used to log in again.
- [ ] Confirm invalid/duplicate identity attempts produce a clear, non-destructive error.
- [ ] Log out and log back in; confirm the same tenant context is restored.

**Evidence/result:**

## 2. Ghana business onboarding

- [ ] Create a test business with country `GH`, currency `GHS`, timezone `Africa/Accra`, and a Ghana branch.
- [ ] Confirm business name, branch name, currency and timezone display correctly after refresh.
- [ ] Confirm onboarding creates an Owner membership linked to an active staff actor.
- [ ] Confirm no email address is required where phone-only identity is supported.

**Evidence/result:**

## 3. Catalog and Ghana-style unit conversion

Create a tracked product equivalent to the automated pilot example: buy Roofing Nails by **box**, stock/sell by **lb**, with `1 box = 50 lb`.

- [ ] Configure stock unit `lb` and purchase unit `box`.
- [ ] Configure the box-to-pound conversion and a sale price per pound.
- [ ] Save and reopen the item; confirm unit code, label, conversion and sale price persist.
- [ ] Confirm numeric price entry does not clear while typing multiple digits.
- [ ] Confirm catalog edit/delete/bulk-action affordances behave as designed and do not overflow on mobile width.

**Evidence/result:**

## 4. Supplier purchase and inventory receipt

- [ ] Create a test supplier with Ghana phone details and payment terms.
- [ ] Receive `2 boxes` on supplier credit.
- [ ] Confirm inventory increases by exactly `100 lb`.
- [ ] Confirm inventory valuation equals the server-calculated purchase cost.
- [ ] Refresh/reopen the purchase and confirm supplier, lines, totals, settlement method and receipt history are retained.
- [ ] Confirm a user without purchase-receive permission cannot receive the purchase.

**Evidence/result:**

## 5. Sales and payment methods

Using the same item, complete representative Ghana trading flows.

- [ ] Cash sale.
- [ ] MoMo sale.
- [ ] Customer-credit sale tied to a named customer.
- [ ] Confirm stock decreases in the configured stock unit for each sale.
- [ ] Confirm cash/MoMo receipts appear in the cashbook using the correct method.
- [ ] Confirm customer-credit sale does not create a fake cash receipt.
- [ ] Confirm Walk-in/immediate-payment sales do not create customer debt.

**Evidence/result:**

## 6. Customer credit and collections

- [ ] Create a customer with a test credit limit and payment terms.
- [ ] Confirm a credit sale increases the customer balance and decreases available credit.
- [ ] Record a partial customer payment and confirm balance/obligation allocation updates exactly once.
- [ ] Attempt a sale above the available credit limit; confirm it is rejected with no stock, sale, receivable or cash partial write.
- [ ] Confirm customer account history clearly distinguishes credit sale, payment and refund/reversal entries.

**Evidence/result:**

## 7. Returns, refunds and exchanges

- [ ] Partially return a sold stock item and choose a restockable disposition.
- [ ] Confirm returned quantity is restored to available stock in the historical stock quantity.
- [ ] Confirm revenue and COGS reversals are correct and the original sale reflects its refund state.
- [ ] Confirm a cash refund changes cash immediately only when appropriate.
- [ ] Confirm an electronic/provider refund remains pending until provider reversal is actually confirmed; TradeOS must not pretend it succeeded.
- [ ] Exercise an exchange and confirm replacement sale/return accounting reconciles without duplicate stock or money movement.

**Evidence/result:**

## 8. Supplier payable and payment

- [ ] Confirm a supplier-credit purchase creates the expected payable.
- [ ] Record a partial supplier payment using a supported method such as MoMo.
- [ ] Confirm supplier balance decreases by exactly the payment amount.
- [ ] Confirm the corresponding cashbook outflow is recorded once.
- [ ] Confirm users without supplier-payment permission cannot post one.

**Evidence/result:**

## 9. Expenses, cashbook and treasury

- [ ] Record a normal operating expense with category, description and payment method.
- [ ] Confirm cashbook method totals reconcile to the underlying money movements.
- [ ] Confirm cash and MoMo balances can be explained from their inflows/outflows.
- [ ] Confirm cashier access is branch-scoped and management-only adjustments/transfers remain permission-gated.
- [ ] Confirm no duplicated cashbook entries appear after refresh/retry.

**Evidence/result:**

## 10. Reports and reconciliation

For the test trading window, compare Sales, Returns, Inventory, Customer, Supplier and Cashbook views with Financial Reports.

- [ ] Gross revenue equals completed sales before returns.
- [ ] Return revenue reversal is shown separately and net revenue is correct.
- [ ] Gross COGS, COGS reversal and net COGS reconcile.
- [ ] Gross profit and operating profit reconcile after expenses.
- [ ] Cash inflow, cash outflow and net cash movement reconcile to cashbook movements.
- [ ] Receivables equal open customer obligations.
- [ ] Payables equal open supplier obligations.
- [ ] Inventory value equals the authoritative valuation/read model.
- [ ] Top-item quantity sold/returned and margin agree with underlying sale/return lines.

**Evidence/result:**

## 11. Offline/replay safety

- [ ] Perform a supported mutation through the normal offline/sync flow, reconnect and sync it.
- [ ] Retry/replay the same client mutation ID.
- [ ] Confirm the API returns the prior accepted result rather than creating a duplicate.
- [ ] Verify row counts and ledger totals for sale/payment/purchase/inventory/cashbook/obligation effects remain exactly once.
- [ ] Confirm a client-supplied/spoofed actor or device identity is replaced by the authenticated session identity.
- [ ] Confirm a rejected/forbidden offline mutation leaves no partial write.

**Evidence/result:**

## 12. Team and access

- [ ] Create a CASHIER (or equivalent lower-role) staff record through Team & Access.
- [ ] Send/accept the invitation through the supported flow and sign in as that staff user.
- [ ] Confirm role, branch/staff linkage and active membership are correct.
- [ ] Confirm CASHIER can perform allowed sales/customer-payment work.
- [ ] Confirm CASHIER cannot receive purchases, mutate catalog/inventory management data, change roles/access or perform other management-only operations.
- [ ] Suspend the test staff account and confirm access is revoked as expected.

**Evidence/result:**

## 13. TradeOS Intelligence and AI safety

- [ ] As Owner/Admin/Manager/Accountant, open the business briefing and confirm tenant/branch scope is correct.
- [ ] Open an inventory item, customer, supplier and purchase detail; confirm entity intelligence refers only to the selected record.
- [ ] Confirm GHS monetary evidence is formatted as currency rather than raw minor units.
- [ ] As CASHIER/lower role, confirm restricted briefing/financial intelligence is unavailable or filtered according to role.
- [ ] Use `Ask TradeOS` from a record and confirm the exact record context carries into the assistant.
- [ ] Create a server-owned entity review task from an eligible record.
- [ ] Click/retry the same action and confirm one active task only.
- [ ] Confirm the action queue shows the task only to users allowed to see it.
- [ ] Confirm creating/completing/snoozing an AI review task does **not** create or change sales, purchases, payments, refunds, inventory movements, cashbook entries, obligations, staff, membership or access records.
- [ ] Confirm TradeOS never auto-submits an economic/access mutation from an AI recommendation.

**Evidence/result:**

## 14. Settings, profile and tenant context

- [ ] Business and branch edit forms expose the required fields consistently and do not leave Add/Edit forms open together.
- [ ] Account/profile tabs switch correctly.
- [ ] Avatar/file fields use file pickers rather than URL-only entry.
- [ ] Team & Access controls work end-to-end for authorized roles.
- [ ] Switch branch/business context and confirm data and AI scope update without leaking the previous tenant/branch.

**Evidence/result:**

## 15. Responsive and operational quality

- [ ] Validate the core flows at desktop and narrow mobile widths.
- [ ] Confirm tables/cards do not horizontally overflow in ordinary use.
- [ ] Confirm loading, empty, offline and error states remain actionable and do not block unrelated core workflows.
- [ ] Confirm browser refresh does not lose committed business data.
- [ ] Confirm no console/network errors indicate missing migrations, 500 loops, localhost calls or expired deployment assets.

**Evidence/result:**

## Release-blocking stop conditions

Stop the pilot and mark the build **NOT READY** if any of these occur:

- financial totals cannot be reconciled to their source ledgers;
- a duplicate/replayed mutation creates duplicate money, stock, obligation or sale/purchase records;
- tenant or branch data crosses scope;
- a lower role can perform a forbidden management/economic action or read forbidden financial evidence;
- an AI action directly mutates an economic/access ledger;
- a return/refund produces incorrect revenue, COGS, stock or cash effects;
- offline reconciliation loses, duplicates or silently rewrites accepted work;
- required schema migrations are not applied before the release becomes active;
- the deployed Web/API cannot complete the critical sell → payment → stock → cashbook → report path.

## Pilot sign-off

**Build / commit:**  
**Environment:**  
**Tester:**  
**Date:**  
**Overall result:** PASS / FAIL / BLOCKED  
**Blocking issues:**  
**Observed final reconciliation:**  
**Notes / evidence references:**
