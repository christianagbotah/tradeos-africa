# TradeOS POS Cash / Electronic via Hubtel — 17 November 2026

## Delivered in branch
- Two primary payment choices: Cash and Electronic.
- Electronic choices: Mobile money (MTN, Telecel, AirtelTigo) and Bank card. Card is stored as CARD, not incorrectly as MOMO.
- Electronic sale is left pending and only server-side authenticated verification may finalize it. Hubtel authenticated status must report the actual mobilemoney or card payment method; if it differs from the POS option or is absent/unknown, the sale is held for review without posting money. Provider redirect and unsigned callback never settle it. No manual electronic payment posting is exposed in this interface.
- Hubtel checkout collects phone number/network and authorization or bank card information securely. TradeOS never collects or stores card PAN, expiry, CVV, wallet PIN or OTP.
- Customer credit (pay later) remains a distinct option and cash plus customer-credit split remains supported.
- Live merchant Hubtel flag stays OFF pending status permission 403 resolution, finality/stock expiry and authorization gates tracked in #134. Avoid credential reuse across merchants, platform subscription billing or Variety Groceries.
- Direct wallet prompt API requires verified registered wallet number or customer OTP before request: implement only when Receive Money credentials/IP permissions and status verification are approved. No unsolicited prompts.
- Hubtel MoMo refund API (45-day eligibility), SMS and OTP are later audited integrations, with provider account permissions and separate messaging credentials.

## Verification
- Focused POS UI checks and isolated database card-payment test.
- Complete domain CI, Visual QA, native client checks, production staging smoke and rollback readiness before deployment.
- Never run integration tests that TRUNCATE business tables against production or staging.

## Integration migration follow-up
- New additive migration 0040_hubtel_pos_card_scope.sql permits card and MoMo payments while preserving historical 0030 migration checksums, merchant ownership, amount, branch and sale scope.
- CI applies all migrations to isolated PostgreSQL before destructive tests. Pending-card checkout, provider-method mismatch and late MoMo verification are tested.
- The provided Hubtel Transaction Status sample includes paymentMethod in the authoritative paid response. A missing method cannot establish a safely classified receipt.
