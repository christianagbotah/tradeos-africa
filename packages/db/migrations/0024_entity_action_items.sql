ALTER TABLE business_action_items
  ADD COLUMN IF NOT EXISTS source_entity_type text,
  ADD COLUMN IF NOT EXISTS source_entity_id uuid,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES app_users(id);

ALTER TABLE business_action_items
  DROP CONSTRAINT IF EXISTS ck_business_action_entity_provenance,
  ADD CONSTRAINT ck_business_action_entity_provenance CHECK (
    (source_entity_type IS NULL AND source_entity_id IS NULL)
    OR
    (source_entity_type IN ('CATALOG_ITEM','CUSTOMER','SUPPLIER','PURCHASE') AND source_entity_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_action_active_entity
  ON business_action_items(
    business_id,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source_entity_type,
    source_entity_id,
    action_type
  )
  WHERE source_entity_type IS NOT NULL
    AND source_entity_id IS NOT NULL
    AND action_type IS NOT NULL
    AND status IN ('OPEN','SNOOZED');

CREATE INDEX IF NOT EXISTS idx_business_action_entity_history
  ON business_action_items(business_id, source_entity_type, source_entity_id, created_at DESC)
  WHERE source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL;
