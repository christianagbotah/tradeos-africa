# Voice-assisted POS — review-first sales

## Purpose
Owner/staff can click **Speak a sale** in POS, grant microphone permission, speak in supported browser English, correct the transcript, and select **Prepare draft for review**. It reads the existing sellable catalog and named customers in the current business workspace. It never writes an order, stock movement, price override or payment on its own.

## Safety / privacy
- Audio is managed by the browser's SpeechRecognition implementation, which may contact a browser speech vendor; TradeOS neither records nor sends microphone audio from this feature.
- Voice can be unavailable on some browsers. Text entry and ordinary POS remain accessible and functional.
- Only recognized catalog items or SKUs become proposed line selections. Unmatched names produce warnings, not invented SKUs or prices.
- Matching prices are display-only catalog values; the existing server recalculates prices, inventory, tax and credit before posting.
- Merchant must explicitly review line identity, quantity, customer and payment preference. They then add to cart, open normal checkout, and confirm payment.
- User can edit every selected item and quantity before applying, or close without saving.
- Speech about price discounts does **not** modify prices. A manager approval workflow is required for one-off price changes.
- Do not use the microphone to capture card PAN, PIN, OTP or secret credentials.
- Split payments: existing server already supports a real cash/MoMo/card/bank + customer-credit combination. Checkout now offers it with online validation of the customer's credit limit. No automatic Hubtel split prompt is supported. Customer credit is not booked as money received.
- A supplier Purchase Order phrase can be recognized, but is never auto-created; supplier, purchasing prices and approvals require a separate reviewed workflow.

## Limitations
This first increment is deterministic catalog-grounded voice *drafting*; it is not a general multimodal LLM agent and does not interpret every conversational correction. Web Speech supports browsers unevenly and does not guarantee Twi/Ewe or offline recognition. Future structured AI augmentation must remain behind feature, budget and permission controls and always revalidate proposed IDs against tenant data.

## Test cases
- 'Comfort Mensah bought two door number 058 and one door number 326, paid by MoMo' -> correct product matches, unit/quantities, linked customer, preselected MoMo.
- 'One pack of takeaway' -> expected matching catalog item where the product is 'Takeaway pack'.
- 'Door number 058, door number 326 and door number 513' -> each a quantity of ONE, never mistake SKU 058 for quantity 58.
- Unknown items, unrecognized customer, different unit, partial payments, price concession -> warnings and human edits, never invented catalog or discount.
- No available voice API -> text fallback and no sale posted.
- No credit customer -> credit button disabled, no offline bypass.
