# Voice purchase-order drafting — acceptance review

The Purchase Orders page includes "Speak an order" for staff with
purchasing write permission (Owner, Admin, Manager or Inventory).

The browser may use its vendor speech-recognition service for audio
transcription. The text is matched locally against the current active
catalog with stock-tracked, purchasable product units. No AI-generated
supplier, SKU, item, purchasing price or accounting entry is created.

Review and verification flow:
- Dictate: "Create purchase order from Comfort Supplies: two door number
  zero five eight and three door number three two six".
- Confirm products, actual supplier, purchase unit and quantities.
- Enter supplier **purchase** unit costs (selling prices are not reused).
- Preview estimated amounts and tick review acknowledgment.
- Click "Use reviewed details in order form" only; this copies values.
- The operator must still click "Create draft order". Manager issues
  later as a separate explicit action.
- Existing manually entered supplier/items are not overwritten without
  confirmation. Date and notes stay editable.
- If browser speech is unavailable, type the order.
- On mobile, check scroll and item inputs in both portrait/landscape.
- Unknown SKU and inactive/non-purchasable products must not be invented.
- No receiving, stock, supplier debt or payment is created by speech.
