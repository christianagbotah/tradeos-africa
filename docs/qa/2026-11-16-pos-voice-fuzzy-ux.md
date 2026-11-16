# Spoken product resolution and tight POS search layout

Issue: product tiles were pushed below the search input on some screen sizes
because the search flex container grew vertically to fill a fixed-height POS.
The Speak button was in the page heading, away from search. Original matching
was mostly exact string/SKU equality, so real Ghanaian spoken SKU names and
similar pronunciations often returned no results.

Remedies:
- Search input and Speak a sale are adjacent in a shared action row. Search
  does not flex-grow vertically, chips and grid follow immediately; mobile
  controls remain touch-friendly and do not overlap the sticky charge bar.
- In-browser catalog ranking handles spoken digit sequences (zero five eight),
  zero-padded numeric SKU transcriptions (0 5 8 or 58 with extra verification),
  alphanumeric codes spoken letter-by-letter, and number words.
- Token normalization and name similarity support plural words, word order,
  common compound names (take away / takeaway, sand paper / sandpaper), small
  transcription errors and phonetic resemblance.
- Strong matches enter the review draft; uncertain similar items appear in a
  ranked Possible matching products panel, never silently posted. Merchant
  can add candidates or search the entire currently sellable catalog.
- Customer names are excluded from product matching. Spoken quantities reject
  a preceding product SKU, including the 058 -> quantity 58 regression.
- Selection always uses existing tenant/branch sellable catalog IDs and unit
  prices. No made-up products, uncontrolled price overrides, payment posting,
  direct inventory adjustments or microphone upload to TradeOS API.

Acceptance:
- '2 door number zero five eight, 1 door number three twenty six, 1 number
  five one three' resolves matching SKUs and quantities without confusion.
- 'SKU DR-102' and 'D R one oh two' find the same catalog item.
- 'bag of sement' suggests or recognizes Cement Bag.
- 'pack of takeaway' and 'three take away packs' recognize Takeaway Pack.
- 'SKU 58' tentatively suggests 058 and requires explicit selection.
- Unknown codes do not invent a product, but show a catalog search fallback.
- Search, Speak button and first product tile remain visible together on
  mobile and desktop; selecting a similar item does not post until checkout.
