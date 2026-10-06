-- verify.sql — checks the database after a load test run.
-- Run with:  psql -d <your_db_name> -f verify.sql

-- 1. How many test scores were saved, per run.
--    Compare each run's count to the script's "expected" number.
SELECT split_part(j.code, '-', 2) AS run_id,
       COUNT(*)                   AS scores_saved
FROM scores s
JOIN judges j ON j.id = s.judge_id
WHERE j.code LIKE 'LOADTEST-%'
GROUP BY run_id
ORDER BY run_id;

-- 2. Duplicates: the same judge scoring the same presentation twice.
--    Should return ZERO rows. Any row here is a real bug.
SELECT s.judge_id, s.presentation_id, COUNT(*) AS copies
FROM scores s
JOIN judges j ON j.id = s.judge_id
WHERE j.code LIKE 'LOADTEST-%'
GROUP BY s.judge_id, s.presentation_id
HAVING COUNT(*) > 1;

-- 3. Duplicate presentations: the same test number created twice.
--    Should return ZERO rows.
SELECT presentation_number, category, COUNT(*) AS copies
FROM presentations
WHERE (CASE WHEN presentation_number ~ '^\d+$' THEN presentation_number::int END) >= 9001
GROUP BY presentation_number, category
HAVING COUNT(*) > 1;

-- 4. Totals are correct: the stored total must equal the sum of criteria.
--    Should return ZERO rows.
SELECT s.id, s.total,
       (SELECT SUM(value::int) FROM jsonb_each_text(s.criteria)) AS recomputed
FROM scores s
JOIN judges j ON j.id = s.judge_id
WHERE j.code LIKE 'LOADTEST-%'
  AND s.total <> (SELECT SUM(value::int) FROM jsonb_each_text(s.criteria));
