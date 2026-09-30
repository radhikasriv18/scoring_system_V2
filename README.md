# Embracing Global Engagement — Scoring System

A judge-scoring web app for the BGSU research symposium. Self-hosted backend
(Postgres + Express), replacing an earlier Supabase/Netlify version.

This document is written for whoever maintains this system next — it explains
not just *how* things work, but *why* they were built this way, so future
changes can be made with the same reasoning intact.

---

## Architecture overview

```
Judge / Admin browser
        │
        ▼
   Express server (Node.js) ── routes/, services/, middleware/
        │
        ▼
   PostgreSQL database ── judges, presentations, scores, symposium_config
```

- **Frontend**: plain HTML/JS (no build step), lives in `frontend/`
- **Backend**: Node.js + Express, in `server.js` and `routes/`
- **Database**: PostgreSQL, schema in `db/schema.sql`
- **Deployment target**: a university-provided VM (Ubuntu, BGSU CS
  department), replacing Supabase Cloud + Netlify. Nothing in the code is
  hardcoded to a specific host — all connection details come from
  environment variables (`.env`), so moving to the VM is a configuration
  change, not a code change.
- **Deployment method**: direct install on the VM (PostgreSQL, Node.js,
  Caddy installed straight onto Ubuntu via sudo access) — **not** Docker.
  An earlier local Docker proof-of-concept was built to estimate resource
  usage for the initial VM request, but the actual application has been
  built and tested entirely without Docker, and direct install was chosen
  for the real deployment to keep the VM setup consistent with local
  development and avoid the extra container-networking configuration
  Docker would introduce (mapping ports so the public subdomain correctly
  reaches the app) under a tight event deadline. The team (Radhika,
  Shubham, Mohammed Shakeel) has sudo access on the VM.

---

## Local setup

1. Install PostgreSQL and Node.js.
2. Create a database: `scoring_system_dev` (or your own name).
3. Copy `.env.example` to `.env` and fill in real values:
   ```
   DB_USER=postgres
   DB_PASSWORD=your_actual_password
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=scoring_system_dev
   ```
4. Install dependencies: `npm install`
5. Create the tables: `psql -U postgres -d scoring_system_dev -f db/schema.sql`
6. Start the server: `node server.js`
7. Server runs at `http://localhost:3000`

---

## Database schema

```sql
CREATE TABLE judges (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE presentations (
    id SERIAL PRIMARY KEY,
    presentation_number TEXT,
    category TEXT NOT NULL,
    discipline TEXT,
    time_slot TEXT,
    room TEXT,
    session TEXT,
    UNIQUE (presentation_number, category),
    UNIQUE (time_slot, category)
);

CREATE TABLE scores (
    id SERIAL PRIMARY KEY,
    judge_id INTEGER NOT NULL REFERENCES judges(id),
    presentation_id INTEGER NOT NULL REFERENCES presentations(id),
    criteria JSONB NOT NULL,
    open_ended_answers JSONB NOT NULL,
    includes_abstract BOOLEAN NOT NULL DEFAULT false,
    total INTEGER NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (judge_id, presentation_id)
);

CREATE TABLE symposium_config (
    id SERIAL PRIMARY KEY,
    config JSONB NOT NULL
);
```

### Design decisions and why

**Judges are identified by a unique `code`, not by name.**
Free-typed names created unsolvable ambiguity: capitalization, whitespace,
titles ("Dr. Priya" vs "Priya"), two people sharing a name, and a person
writing their own name differently on different days. A unique code sidesteps
all of it — the code *is* the identity; the name is just a display label.
The first time a code is submitted, a `judges` row is created for it
automatically; every later submission with that code reuses the existing row
(see `routes/judges.js`). If the same code is later submitted with a
*different* name, the original stored name wins — the mismatch is not
flagged (a deliberate simplification; revisit if this causes real confusion).

**Presentations have two different identifying schemes, by category.**
Poster presentations are identified by `(presentation_number, category)`.
Oral and Video presentations, for the event this system was originally built
for, do **not** use presentation numbers — they're identified by
`(time_slot, category)` instead, because the university assigns them by
session/room/time rather than a number. Both identifying schemes are
enforced as separate `UNIQUE` constraints on the same table, since a
presentation can be missing one identifier but never both (enforced in
application code in `routes/presentations.js`, not by a database constraint,
since "at least one of two fields" isn't expressible as a simple `NOT NULL`).

`room` and `session` columns exist but go unused for the originating event —
they were added preemptively because a future event is expected to assign
Oral/Video presentations by room + session + time slot together, not time
slot alone. Whether a judge sees room/session input fields at all is
controlled by `symposium_config` (per-category flags, matching the existing
`usesTimeSlots` pattern), not by the database — the database simply has the
columns available whenever an event needs them.

**`total` in `scores` is always recalculated server-side from `criteria`,
never trusted from client input.** This is a deliberate security/integrity
principle: any value the server can derive from other data it already has
should be derived, not accepted at face value from a request, since request
data could be wrong (bug) or tampered with. See `sumCriteria()` in
`routes/scores.js`.

**A judge can submit a score for a given presentation exactly once.**
`UNIQUE(judge_id, presentation_id)` enforces this at the database level.
Application logic checks for an existing score first and rejects a duplicate
submission with `409 Conflict` before ever attempting an insert; the
database constraint is a backstop, not the primary mechanism. Corrections to
an already-submitted score are expected to happen through an admin-only
`UPDATE` path (not yet built as of this writing — see Open Items below),
never through the judge resubmitting.

**`symposium_config` is a single row, overwritten each year — not
versioned.** Preserving each year's exact rubric/config history was
considered and deliberately rejected: the Excel export already captures
each event's actual results and the criteria they were scored against, so
duplicating that historical record inside the database would solve a
problem that's already solved elsewhere. If this assumption changes (e.g.,
the export stops capturing enough detail to reconstruct history), this
decision should be revisited.

---

## API endpoints (implemented so far)

### `POST /api/judges`
Body: `{ code, first_name, last_name }`
Creates a judge if `code` doesn't exist yet; returns the existing judge if it
does. Never creates a duplicate for the same code.

### `POST /api/presentations`
Body: `{ category, presentation_number? , time_slot?, discipline?, room?, session? }`
Requires `category` and *either* `presentation_number` or `time_slot`.
`presentation_number` is normalized (trimmed, leading zeros stripped) before
lookup/insert, to prevent formatting-only duplicates (e.g. "5" vs "05").
Creates a presentation if the identifying combination doesn't exist yet;
returns the existing one if it does.

### `POST /api/scores`
Body: `{ judge_id, presentation_id, criteria, open_ended_answers?, includes_abstract? }`
1. Validates `judge_id`, `presentation_id`, and at least one criterion are present.
2. Confirms the judge exists (`404` if not).
3. Confirms the presentation exists (`404` if not).
4. Validates that *all* required criteria for the presentation's category
   are present in `criteria` — the category's normal rubric criteria, plus
   the abstract criterion only when `includes_abstract` is true. Looks up
   the category's rubric from `symposium_config`. Rejects with `400` and
   names the specific missing criterion/criteria if any are absent.
5. Rejects with `409` if this judge has already scored this presentation.
6. Recalculates `total` from `criteria` server-side.
7. Inserts and returns the new score row.

### `GET /api/judges`, `GET /api/presentations`, `GET /api/scores`
Return every row in the respective table, newest first.

### `GET /api/config`
Returns the current `symposium_config` row, or `null` if none exists yet
(first-run state — not treated as an error).

### `GET /api/leaderboard`
Returns the top 5 presentations per category, ranked by average
fairness-scaled score. For each score, computes
`total × (category's normal criteria count ÷ criteria actually rated)` to
account for judges who rated an extra (abstract) criterion, then averages
that scaled score across every judge who scored a given presentation, then
sorts descending and takes the top 5 per category. Response shape:
`{ [categoryName]: [{ presentationNumber, timeSlot, discipline, averageScaledScore, judgeCount }] }`.

### `GET /api/workload`
Returns, per judge, how many presentations they've scored, broken down by
category, plus a total. Response: a list of
`{ judgeId, judgeName, counts: { [categoryName]: count }, total }`.
Note: the old app's duplicate-detection in this feature was deliberately
dropped — the `UNIQUE(judge_id, presentation_id)` constraint already
prevents the scenario it used to flag.

### `GET /api/scores?judge_id=X` / `GET /api/scores?category=Y`
The scores GET route now supports optional query-string filters — by
judge, by category (joins to `presentations` for category, since that
column isn't on `scores` itself), or both together. Built to support a
judge-facing "you're done scoring" summary (what has this judge scored so
far). Marked for later revisit in the concepts reference doc — the
dynamic query-building and the `JOIN` weren't slowed down on given the
deadline.

### `POST /api/admin/login`
Body: `{ username, password }`. Checks the password against a bcrypt hash
in the `admins` table; on success, returns `{ token }` — a JWT, valid 8
hours, to be sent as `Authorization: Bearer <token>` on every subsequent
admin-only request. No public signup route exists by design — admin
accounts are seeded directly (see "Seeding an admin account" below), since
only a small, known set of people (Radhika, and whoever she adds) need
admin access.

### `PUT /api/config` — **admin-only**
Body: `{ config }` — the entire config object (replaces whatever's
currently stored; there is no partial-update). Used for editing the
conference title, any category's rubric/criteria, disciplines, time slots,
etc. Gated by `middleware/requireAdmin.js`.

### `PUT /api/scores/:id` — **admin-only**
Body: `{ criteria, open_ended_answers?, includes_abstract? }`. Corrects an
already-submitted score — recalculates `total` server-side, same as
creation. This is the only way a submitted score can change; judges cannot
edit their own submissions once made (see design decision above).

### `DELETE /api/scores/:id` — **admin-only**
Deletes a single score.

### `DELETE /api/scores/reset-all` — **admin-only**
Full event reset: deletes every score, judge, AND presentation — a
deliberate decision (a "fresh start" for a new event means all three, not
just scores). Deletes in foreign-key-safe order (scores first). **Route
ordering matters here**: this route is defined *before*
`DELETE /api/scores/:id` in the file, because Express matches routes
top-to-bottom and a `/:id` wildcard would otherwise treat the literal text
"reset-all" as an id and swallow this request first. Any future route
mixing a wildcard param with a specific named path needs the same care.

### `GET /api/export/excel` — **admin-only**
Builds and downloads an `.xlsx` workbook with one sheet per category
(PosterPresentations, OralPresentations, VideoPresentations), matching the
university's template — one column per judge, one row per presentation,
each cell the judge's fairness-scaled score, plus TOTAL SCORE / NumberOf
Judges / MEAN SCORE per row. Ported from the old `admin.js`
`buildTemplateSheetData`, reading from Postgres instead of localStorage.
Poster's row label is the presentation number; Oral/Video's is the time
slot, since this event doesn't assign them numbers (column headers say
"POSTER#" vs "TIME SLOT" accordingly — update if a future event gives
Oral/Video real numbers again).

---

## Open items / not yet built

- **Admin: merge duplicate score entries** — ported from the old
  `admin.js` MergePanel, if still needed (the new schema's
  `UNIQUE(judge_id, presentation_id)` prevents the exact scenario the old
  merge tool handled, so this may not be necessary — evaluate before building).
- **Danger Zone frontend safeguard** — the backend reset-all route exists
  and is tested; the typed "DELETE ALL SCORES" confirmation UI from the old
  app is a frontend concern, not yet built.
- **Frontend integration** — pointing the existing `index.html`/`app.js`
  (judge-facing) and `admin.html`/`admin.js` (admin dashboard) at this API
  instead of Supabase. Currently, the entire API has been built and tested
  via Postman/curl only — no real page has called any of it yet. This
  includes building the "Score Another / I'm Done" judge-facing flow (using
  the new `GET /api/scores?judge_id=X` filter for the summary).
- **Deployment to the university VM** — see "Deploying to the VM" below for
  the concrete checklist once resources are available.

---

## Deploying to the VM — what to configure once resources are available

The university (Lisa Weihl, BGSU CS) is provisioning an Ubuntu VM with
sudo access for the team (Radhika, Shubham, Mohammed Shakeel) and a
subdomain (`https://csvmXX.cs.bgsu.edu`). Everything below is installed
**directly** on the VM — no Docker (see Architecture overview above for why).

### 1. Install the stack
```
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo apt install nodejs npm
sudo apt install caddy
```
(Exact package names/commands may need adjusting depending on the Ubuntu
version — verify against current Ubuntu/PostgreSQL/Node docs at the time.)

### 2. Get the project onto the VM
Either `git clone` a repository (recommended — set one up before deployment
if it doesn't exist yet) or transfer the project files directly. Do **not**
copy `node_modules/` or `.env` — those are excluded by `.gitignore` and
should never be committed or transferred as-is.

### 3. Install dependencies fresh on the VM
```
npm install
```
This reads `package.json` and reinstalls every package used so far:
`express`, `pg`, `dotenv`, `bcrypt`, `jsonwebtoken`, `xlsx`.

### 4. Create the database and real `.env`
```
sudo -u postgres createdb scoring_system_prod
```
Copy `.env.example` to `.env` and fill in the VM's real values — **not**
`localhost` for `DB_HOST` unless Postgres and the app run on the same
machine (they likely will here). Generate a genuinely random, long
`JWT_SECRET` for production — do not reuse the local development one.

### 5. Run the schema and seed the real config
```
psql -U postgres -d scoring_system_prod -f db/schema.sql
psql -U postgres -d scoring_system_prod -f db/seed-config.sql
```

### 6. Seed the real admin account(s)
No signup route exists by design. Generate a bcrypt hash for each real
admin's chosen password:
```
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('CHOOSE_A_REAL_PASSWORD', 10, (err, hash) => console.log(hash));"
```
Then insert each admin directly:
```
psql -U postgres -d scoring_system_prod -c "INSERT INTO admins (username, password_hash) VALUES ('real_username', 'paste_the_hash_here');"
```
**Use a genuinely strong password for production** — the local dev
account's password was chosen for convenience during testing, not security.

### 7. Run the server persistently
`node server.js` run directly will stop the moment the SSH session
disconnects. For a real deployment, use a process manager — **PM2** is the
common choice — so the server keeps running and restarts automatically if
it crashes. (Not yet set up or decided on; a specific `pm2` install/config
step should be worked out before the live event, not improvised on the day.)

### 8. Configure Caddy for HTTPS
Point Caddy at the Express server (port 3000) so
`https://csvmXX.cs.bgsu.edu` correctly reaches it, and so Caddy handles
HTTPS automatically. (Specific Caddyfile configuration not yet written —
do this once the VM and subdomain are confirmed active.)

### 9. Test everything end-to-end on the VM before the live event
At minimum: judge submits a score, admin logs in, admin edits a score,
leaderboard/workload/export all return correct data, and — critically —
test this on the VM itself, not just locally, since the whole point of
this checklist is catching anything that behaves differently in a fresh
environment.

---

## A note on how this was built

This backend was built and reasoned through step by step, one table and one
route at a time, deliberately working through edge cases (see the design
decisions above) before writing code, rather than translating the old
Supabase schema directly. Some decisions changed mid-build as real
constraints emerged (e.g., the presentations table was redesigned once it
became clear Oral/Video categories don't use presentation numbers) — this is
reflected in the schema and reasoning above rather than hidden.