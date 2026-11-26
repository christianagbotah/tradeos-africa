BEGIN;

-- The original POS scope guard accepted only MoMo. A hosted Hubtel checkout
-- also supports bank cards. Reject other methods and cross-tenant attempts.
-- Historical migration 0030 remains immutable.
CREATE OR REPLACE FUNCTION validate_hubtel_sale_checkout_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM payments p JOIN sales s ON s.id=p.sale_id
    WHERE p.id=NEW.payment_id AND p.sale_id=NEW.sale_id
      AND p.business_id=NEW.business_id AND s.business_id=NEW.business_id
      AND p.branch_id=NEW.branch_id AND s.branch_id=NEW.branch_id
      AND p.method IN ('MOMO','CARD') AND p.currency_code='GHS'
      AND s.currency_code='GHS' AND p.amount_minor=NEW.expected_amount_minor
  ) THEN
    RAISE EXCEPTION 'Hubtel checkout must match the owning sale and pending payment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_hubtel_sales_accounts a
    WHERE a.business_id=NEW.business_id
      AND a.collection_account=NEW.merchant_collection_account
  ) THEN
    RAISE EXCEPTION 'Hubtel merchant account does not match the sale owner';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
