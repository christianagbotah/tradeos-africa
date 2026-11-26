# Voice-recognized payments — reviewed checkout prefill only

Existing speech recognition can identify "paid part" and "paid 200",
but before this change those data were lost when adding the reviewed
voice transaction to the cart.

This implementation allows a **single explicitly reviewed voice draft**
to carry a payment hint to checkout. It is not a payment confirmation.
If the cart already contained items, the hint is dropped to avoid
applying a number to a different sale. Changing cart lines also clears
the hint.

## Cases for manual test

1. Voice: "Comfort Mensah bought two door 058 and paid part of ₵125
   cash." Check the draft. In checkout, verify server price, linked active
   customer, online status, and available credit. Only then click
   "Use spoken amount for cash + credit split" if offered.
2. Confirm cash entered, balance shown as credit, payment method,
   customer identity, credit available, final Charge action and
   resulting accounting entries. No record should be posted by speech.
3. Voice: "walk-in bought a takeaway pack and paid ₵50 cash." After
   review, checkout offers to copy 50 as physical cash received only if
   cash method selected and total <= ₵50. Verify change shown before
   final Charge.
4. With a walk-in, no online verification, inadequate credit, an
   expired price approval or speech amount >= total in a partial
   payment, no automatic split prefill should be offered.
5. Spoken MoMo/Telecel Cash/bank/card never counts as confirmed
   provider receipt, regardless of what the transcript claims.
6. Browser speech with "paid ₵1,250.50", "paid 50.75" and SKU 058:
   verify exact amount in minor units with decimal integrity;
   product codes must not be used as money.
7. Add items manually before applying a voice draft, and edit the cart
   after voice entry: ensure no stale payment hint survives.
8. Credit/part-payments still go through server-side credit-limit,
   customer, stock, pricing, payment and ledger enforcement.
