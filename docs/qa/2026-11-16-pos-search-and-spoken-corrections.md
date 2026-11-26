# POS fuzzy fallback and voice draft correction — UAT

* Confirm that ordinary substring searches and valid numeric SKUs remain fast and unchanged.
* Search for a misspelling such as `cemnt` and verify the similar-result notice, original catalog names, unit, SKU and price. The cashier must tap a product; suggestions are not cart entries.
* Search for `zero five eight` and verify SKU `058` appears with the corresponding catalog unit. `77777` must not invent a product.
* Change a category chip, then search another product; the filter should reset so results remain visible immediately beneath search.
* Speak or type `change item two to SKU 326` in an existing voice draft. Inspect the proposed replacement; explicitly select the correct item before confirming. Confirm that the draft's second line changes, the first line is intact, and review acknowledgement resets.
* Test `change quantity of item one to three`, `remove item two`, unknown item numbers and invalid quantities. A draft correction must never change a price, create sales, adjust stock or charge a customer.
* Test microphone availability/permission denial. The typed correction remains available, and both initial and correction transcripts can be edited before confirmation.
* Test mobile screen height: the correction panel scrolls inside the dialogue, search remains adjacent to Speak, and the product grid sits directly below the controls.
* Test ordinary offline catalog matches; no remote AI or third-party speech dependency is required for typed corrections. Speech recognition availability remains browser dependent.
