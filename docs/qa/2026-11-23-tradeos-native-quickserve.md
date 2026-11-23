# Native mobile Quick Serve for busy food vendors

This adds an opt-in Quick Serve layout to the React Native POS screen for
Android/iOS users serving long queues. The Standard POS remains available.

The native model groups cached catalog sellable units by immutable catalog
item ID, rather than display name, with one tap per configured price/portion.
For example Waakye Small, Standard and Large can have 5, 10 and 15 cedi
buttons. Prepared food is prioritized. Products with known exhausted stock
are disabled, and staff without sale permission cannot post a transaction.

Quick Serve has a fixed estimated-total and cash action on the phone. Entering
the mode explicitly selects cash, and the operator taps Cash received only
after physical money changes hands. The existing native createSale runtime
is used, including local durability and server synchronization. Result
warnings distinguish a synced sale from pending/review; the screen must not
claim an offline mutation is server-confirmed. Native final server prices
can differ from cached estimates.

For MoMo/card/other tender, return to Standard POS, retaining the cart.
Native Quick Serve currently does not persist favourite tiles on the device
and is not yet a complete mirror of the PWA feature in that dimension.

Regression tests cover grouped portion prices, different item identities,
prepared food priority, permission and stock gates, fixed cash button and
pending sync visibility. This is source-only native development. It does not
constitute a published Android/iOS binary or a production rollout.
