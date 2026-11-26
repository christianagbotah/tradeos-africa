# Voice POS — customer and payment review corrections

Built on the existing staging voice POS. All spoken corrections only prepare
changes to the unposted, browser-side draft. Sale settlement, customer credit,
tax, inventory, special pricing and manager approvals remain in the normal
server-verified checkout flow.

## UAT scenarios
1. Prepare a sale for Comfort Mensah, select a product and quantity, then
   say "change customer to Michael Dapaah". Require selecting the existing
   active customer from the matching list and pressing Confirm. Verify the
   displayed customer changed, while product and price are untouched.
2. Say "use walk-in customer", preview and confirm the removal of the linked
   account. Credit sales must not be applied without a linked customer.
3. Say "change payment method to MoMo", "set payment to bank transfer",
   and "payment is cash" in separate drafts. Verify the proposed method,
   require confirmation, and require the final checkout confirmation.
4. Say "set payment to half cash and half MoMo"; verify no automatic split is
   applied. The cashier must manually configure the split in checkout.
5. Attempt an unknown customer; verify no new account is invented or silently
   chosen. Try two similar customers; user must select which one.
6. Start correction and then manually change a product or customer before
   confirming; verify the previous correction cannot apply to the new state.
7. Speak the item, customer and payment in a single original sale. The browser
   still handles product matching; staff can correct any individual field.
8. Test Chrome Android microphone permission/no service. Text correction must
   still work without sending audio to TradeOS servers.
9. Check credit limits, part payments, customer-specific prices and audit
   records through normal checkout; no additional posting routes are added.
