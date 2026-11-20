BEGIN;

-- Exact historical valuation taken from available inventory for each original
-- sale stock movement. This is EVIDENCE, not a reservation-release instruction.
-- A recipe/service line can have multiple distinct component cost allocations.
CREATE TABLE sale_stock_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  sale_line_id uuid NOT NULL REFERENCES sale_lines(id),
  inventory_movement_id uuid NOT NULL UNIQUE REFERENCES inventory_movements(id),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  stock_unit_code text NOT NULL,
  consumed_quantity numeric(24,8) NOT NULL CHECK (consumed_quantity > 0),
  consumed_cost_minor bigint NOT NULL CHECK (consumed_cost_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,inventory_movement_id)
);

CREATE INDEX idx_sale_stock_cost_allocations_line
  ON sale_stock_cost_allocations(business_id,sale_line_id);

-- Every cost entry must match a single negative source movement in the
-- original branch, exact quantity, item, unit, and SALE_LINE reference.
CREATE FUNCTION verify_sale_stock_cost_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM inventory_movements m
    JOIN sale_lines sl ON sl.id=NEW.sale_line_id
    JOIN sales s ON s.id=sl.sale_id
    WHERE m.id=NEW.inventory_movement_id
      AND m.business_id=NEW.business_id
      AND m.branch_id=NEW.branch_id
      AND m.item_id=NEW.item_id
      AND m.stock_unit_code=NEW.stock_unit_code
      AND m.location_type='AVAILABLE'
      AND m.quantity_delta=-NEW.consumed_quantity
      AND m.reference_type='SALE_LINE'
      AND m.reference_id=NEW.sale_line_id
      AND m.reason IN ('SALE','SERVICE_CONSUMPTION','RECIPE_CONSUMPTION')
      AND sl.business_id=NEW.business_id
      AND s.business_id=NEW.business_id
      AND s.branch_id=NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'Sale cost allocation must match the original stock consumption';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sale_stock_cost_allocation_scope
BEFORE INSERT ON sale_stock_cost_allocations
FOR EACH ROW EXECUTE FUNCTION verify_sale_stock_cost_allocation();

-- Immutable cost evidence preserves the historical consumption valuation;
-- later refunds/voids must create separate compensating journals.
CREATE FUNCTION prevent_sale_stock_cost_allocation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Original sale stock cost allocations are append-only';
END;
$$;
CREATE TRIGGER sale_stock_cost_allocation_immutable
BEFORE UPDATE OR DELETE ON sale_stock_cost_allocations
FOR EACH ROW EXECUTE FUNCTION prevent_sale_stock_cost_allocation_mutation();

COMMIT;
