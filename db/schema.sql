-- Judges: one raw per judge. Identified by a unique code
-- assigned by the judge themselves the first time they submit a score.

CREATE TABLE judges (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    finished_at TIMESTAMPTZ
);
-- Presentations: one row per presention. A (number, category) pair must be unique.

CREATE TABLE presentations(
    id SERIAL PRIMARY KEY,
    presentation_number TEXT,
    category TEXT NOT NULL,
    discipline TEXT,
    time_slot TEXT,
    room TEXT,
    session TEXT,
    UNIQUE (presentation_number, category),
    UNIQUE(time_slot, category)
);

-- scores: one row per judge scoring one presentation. judge_id and presentation id are forign keys.
CREATE TABLE scores (
    id SERIAL PRIMARY KEY,
    judge_id INTEGER NOT NULL REFERENCES judges(id),
    presentation_id INTEGER NOT NULL REFERENCES presentations(id),
    criteria JSONB NOT NULL,
    open_ended_answers JSONB NOT NULL,
    includes_abstract BOOLEAN NOT NULL DEFAULT false,
    total INTEGER NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (judge_id, presentation_id)
);

-- symposium config: single row, holds the current event's rubric/category

CREATE TABLE symposium_config (
    id SERIAL PRIMARY KEY,
    config JSONB NOT NULL
);

CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);