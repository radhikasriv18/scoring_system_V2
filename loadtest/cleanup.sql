-- cleanup.sql — removes ONLY load test data. Real scores are untouched,
-- so this is safe to run while Shakeel's test data is still in the database.
-- Order matters: scores first, because they point at judges and presentations.
-- Run with:  psql -d <your_db_name> -f cleanup.sql

BEGIN;

DELETE FROM scores
WHERE judge_id IN (SELECT id FROM judges WHERE code LIKE 'LOADTEST-%');

DELETE FROM judges
WHERE code LIKE 'LOADTEST-%';

-- Test presentations (9001+), only if no real score points at them.
DELETE FROM presentations p
WHERE (CASE WHEN p.presentation_number ~ '^\d+$' THEN p.presentation_number::int END) >= 9001
  AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.presentation_id = p.id);

COMMIT;
