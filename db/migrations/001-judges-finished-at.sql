-- Records when a judge tapped "I've Finished ALL My Presentations".
-- NULL means still judging. Cleared again automatically when they submit
-- another score. IF NOT EXISTS makes this safe to run more than once.
ALTER TABLE judges ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;