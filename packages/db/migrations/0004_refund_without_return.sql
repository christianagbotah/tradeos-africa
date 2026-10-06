BEGIN;

ALTER TABLE return_lines
  DROP CONSTRAINT IF EXISTS return_lines_disposition_check;

ALTER TABLE return_lines
  ADD CONSTRAINT return_lines_disposition_check
  CHECK (disposition IN ('RESTOCK', 'QUARANTINE', 'DISCARD', 'NOT_RETURNED', 'NOT_APPLICABLE'));

COMMIT;
