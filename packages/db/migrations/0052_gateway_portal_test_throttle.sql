BEGIN;
-- An external TEST status probe must never be an unbounded request-amplifier.
-- This is a throttle audit only; it has no payment/receipt/stock effects.
ALTER TABLE gateway_collection_attempts
  ADD COLUMN last_portal_verification_at timestamptz,
  ADD COLUMN portal_verification_count integer NOT NULL DEFAULT 0
    CHECK(portal_verification_count >= 0);
COMMIT;
