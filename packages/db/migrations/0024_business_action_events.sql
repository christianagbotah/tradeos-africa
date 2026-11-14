BEGIN;

-- Immutable audit trail for advisory business action items.
-- Event rows cannot reference an action belonging to another business.
CREATE TABLE business_action_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  event_type text NOT NULL CHECK (event_type IN ('CREATED','STATE_CHANGED')),
  from_state text CHECK (from_state IS NULL OR from_state IN ('OPEN','DONE','SNOOZED','CANCELED')),
  to_state text NOT NULL CHECK (to_state IN ('OPEN','DONE','SNOOZED','CANCELED')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_action_event_scope FOREIGN KEY (business_id,action_id)
    REFERENCES business_action_items(business_id,id),
  CONSTRAINT ck_business_action_event_transition CHECK (
    (event_type='CREATED' AND from_state IS NULL AND to_state='OPEN')
    OR
    (event_type='STATE_CHANGED' AND from_state IS NOT NULL AND from_state<>to_state)
  )
);

CREATE INDEX idx_business_action_events_history
  ON business_action_events(business_id,action_id,occurred_at DESC,id);

COMMIT;
