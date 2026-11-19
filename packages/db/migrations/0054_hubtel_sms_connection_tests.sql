BEGIN;

-- A single password-confirmed test message is possible without opening
-- tenant-wide SMS campaigns. Record the external intent BEFORE the send and
-- never repeat a failed, lost or ambiguous provider request automatically.
CREATE TABLE hubtel_sms_connection_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  credential_revision integer NOT NULL CHECK(credential_revision > 0),
  recipient_suffix text NOT NULL CHECK(recipient_suffix ~ '^[0-9]{4}$'),
  state text NOT NULL DEFAULT 'INITIATING'
    CHECK (state IN ('INITIATING','ACCEPTED','OUTCOME_UNKNOWN')),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,client_request_id),
  CHECK((state='ACCEPTED' AND provider_message_id IS NOT NULL) OR
        (state<>'ACCEPTED' AND provider_message_id IS NULL))
);
CREATE INDEX hubtel_sms_test_by_business ON hubtel_sms_connection_tests
  (business_id,created_at DESC);
CREATE OR REPLACE FUNCTION prevent_hubtel_sms_test_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.business_id<>OLD.business_id OR
     NEW.client_request_id<>OLD.client_request_id OR
     NEW.actor_user_id<>OLD.actor_user_id OR
     NEW.credential_revision<>OLD.credential_revision OR
     NEW.recipient_suffix<>OLD.recipient_suffix OR
     NEW.created_at<>OLD.created_at OR
     OLD.state<>'INITIATING' OR
     NEW.state NOT IN ('ACCEPTED','OUTCOME_UNKNOWN') THEN
    RAISE EXCEPTION 'Hubtel test SMS intent and final result are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_hubtel_sms_test
BEFORE UPDATE ON hubtel_sms_connection_tests
FOR EACH ROW EXECUTE FUNCTION prevent_hubtel_sms_test_rewrite();
CREATE OR REPLACE FUNCTION prevent_hubtel_sms_test_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hubtel test SMS audit entries cannot be removed';
END $$;
CREATE TRIGGER protect_hubtel_sms_test_delete
BEFORE DELETE ON hubtel_sms_connection_tests
FOR EACH ROW EXECUTE FUNCTION prevent_hubtel_sms_test_delete();

COMMIT;
