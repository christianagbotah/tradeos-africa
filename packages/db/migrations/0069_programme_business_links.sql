BEGIN;
-- Optional link is not a merchant membership and never grants merchant access.
CREATE TABLE programme_business_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 participant_id uuid NOT NULL,
 business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 consent_version text NOT NULL CHECK(consent_version='v1'),
 linked_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 FOREIGN KEY(organisation_id,participant_id) REFERENCES programme_participants(organisation_id,id) ON DELETE RESTRICT,
 CHECK(revoked_at IS NULL OR revoked_at>=linked_at)
);
CREATE UNIQUE INDEX programme_business_links_active_business ON programme_business_links(organisation_id,business_id) WHERE revoked_at IS NULL;
CREATE INDEX programme_business_links_participant ON programme_business_links(organisation_id,participant_id,linked_at);
COMMIT;
