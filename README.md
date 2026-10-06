# Embracing Global Engagement — Scoring System

A judge-scoring web app for the BGSU research symposium. Self-hosted backend
(Postgres + Express), replacing an earlier Supabase/Netlify version.

This document is written for whoever maintains this system next — it explains
not just *how* things work, but *why* they were built this way, so future
changes can be made with the same reasoning intact.

---

## Architecture overview
# Embracing Global Engagement: Judge Scoring System

A web app for the BGSU *Embracing Global Engagement* research symposium.
Judges score Poster, Oral and Video presentations on a rubric, mostly from
their phones. Organizers use an admin dashboard to watch progress, fix
mistakes, see rankings, and download the results as an Excel file.

It is self-hosted on a BGSU Computer Science virtual machine and replaces an
earlier Supabase/Netlify version.

**Live (as of October 2026)**

| What | Address |
|---|---|
| Judge app | `https://csvm16.cs.bgsu.edu` |
| Admin dashboard | `https://csvm16.cs.bgsu.edu/admin.html` |

The university limits traffic to this VM to US addresses.

This document is for whoever maintains the system next. It explains how the
pieces fit together and, just as important, *why* they were built this way,
so a future change can keep the same reasoning intact.

---

## Documentation map

| Read this | If you want to |
|---|---|
| **README.md** (this file) | understand the system, run it locally, see the design decisions |
| **API.md** | look up an endpoint: what it takes, what it returns, who may call it |
| **ADMIN_GUIDE.md** | run the event as an organizer (no technical knowledge needed) |
| **BEFORE_THE_EVENT.md** | work through the launch checklist: tests still to do, cleanup, security |
| **TROUBLESHOOTING.md** | fix something that has gone wrong (symptom, cause, fix) |
| **deployment-pm2-caddy-steps.md** | deploy a change, manage admin accounts, understand the server setup |
| **scoring-frontend-README.md** | work on the frontend (this becomes the README of the `scoring-frontend` repo) |
| **concepts-reference.md** | learn the ideas behind the code (written as study notes) |
| **CHECKLIST.md**, **FRONTEND_CHECKLIST.md** | see what was built, what is deployed, and the build history |

---

## Architecture

```
Judge phone ──┐                       ┌── /var/www/scoring   built judge app + admin dashboard
              ├── HTTPS ──▶ Caddy ────┤   (static files)
Admin laptop ─┘                       └── /api/*  ──▶ Express (Node, port 3000, kept alive by PM2)
                                                          │
                                                          ▼
                                                     PostgreSQL
```

- **Caddy** terminates HTTPS (certificates are automatic), serves the website
  files, and forwards anything under `/api/` to Express.
- **Express** is the backend. It holds all the rules and is the only thing
  that talks to the database.
- **PostgreSQL** stores judges, presentations, scores, the event settings and
  the admin accounts.
- **PM2** keeps the backend running after a crash, a closed terminal or a VM
  reboot.
- No Docker: PostgreSQL, Node.js and Caddy are installed directly on the VM.

There are **two repositories**:

| Repo | Contains |
|---|---|
| `scoring_system_V2` (this one) | the backend: Express routes, database files, docs |
| `scoring-frontend` (`github.com/radhikasriv18/scoring-frontend`) | the React app: the judge app and the admin dashboard |

### Technology

| Layer | Choice |
|---|---|
| Backend | Node.js, Express, `pg`, `bcrypt`, `jsonwebtoken`, `xlsx`, `dotenv` |
| Database | PostgreSQL |
| Frontend | React, built with Vite (two pages: `index.html`, `admin.html`) |
| Web server | Caddy |
| Process manager | PM2 |

### Backend layout

```
scoring_system_V2/
├── server.js                  starts Express and mounts the routes
├── db/
│   ├── pool.js                the Postgres connection (reads .env)
│   ├── schema.sql             all tables, for a brand-new database
│   ├── seed-config.sql        the event settings (rubrics, time slots, ...)
│   └── migrations/            one-off changes for a database that already has data
├── routes/                    one file per resource
│   ├── judges.js  presentations.js  scores.js  config.js
│   ├── adminAuth.js  workload.js  leaderboard.js  export.js
├── services/
│   └── presentations.js       find-or-create a presentation (used by two routes)
├── middleware/
│   └── requireAdmin.js        checks the admin login token
├── .env                       secrets (never committed)
└── .env.example               the template for .env
```

`routes/` handles web requests, `services/` holds logic that more than one
route needs, `middleware/` holds checks that run before a route, and `db/`
holds everything about the database. That separation is why a change in one
place rarely breaks another.

---

## Run it locally

You need Node.js and PostgreSQL installed.

**Backend** (in `scoring_system_V2`):

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in:

   | Variable | Meaning |
   |---|---|
   | `DB_USER`, `DB_PASSWORD` | the Postgres login |
   | `DB_HOST`, `DB_PORT` | where Postgres is (`localhost`, `5432`) |
   | `DB_NAME` | the database, for example `scoring_system_dev` |
   | `JWT_SECRET` | a long random string that signs admin login tokens |

3. Create the database, then the tables and the settings:
   ```
   psql -U postgres -c "CREATE DATABASE scoring_system_dev;"
   psql -U postgres -d scoring_system_dev -f db/schema.sql
   psql -U postgres -d scoring_system_dev -f db/seed-config.sql
   ```
4. Create an admin account. Hash a password, then insert it:
   ```
   node -e "require('bcrypt').hash('choose-a-password', 10).then(console.log)"
   psql -U postgres -d scoring_system_dev -c "INSERT INTO admins (username, password_hash) VALUES ('admin', 'PASTE_THE_HASH_HERE');"
   ```
   (On the Linux server, use the safer method in `deployment-pm2-caddy-steps.md`, Part 4.)
5. `node server.js`. The backend runs at `http://localhost:3000` and the
   terminal stays busy while it runs.

**Frontend** (in `scoring-frontend`): `npm install`, then `npm run dev`. Open
`http://localhost:5173` for the judge app and `http://localhost:5173/admin.html`
for the dashboard. The dev server forwards `/api` requests to
`localhost:3000`, so run the backend too.

Two things that have caused real confusion:
- **Only one backend can use port 3000.** If you edit a route and get "Cannot
  PUT/GET ...", an older copy of the backend is probably still running. See
  TROUBLESHOOTING.md.
- After editing `vite.config.js` you must restart `npm run dev`.

---

## Data model

```
judges             id, code (unique), first_name, last_name, created_at, finished_at
presentations      id, presentation_number, category, discipline, time_slot, room, session
scores             id, judge_id, presentation_id, criteria (JSON), open_ended_answers (JSON),
                   includes_abstract, total, submitted_at
symposium_config   id, config (JSON)      one row: the event's settings
admins             id, username (unique), password_hash, created_at
```

Important rules built into the tables:

- `scores` has `UNIQUE(judge_id, presentation_id)`: a judge scores a
  presentation once.
- `presentations` has `UNIQUE(presentation_number, category)` and
  `UNIQUE(time_slot, category)`.
- Scores store **text, not ids**, for a few things: a presentation's
  `category` is the category's *name*, `time_slot` is the slot's *label*, and
  `criteria` is keyed by each criterion's *id*. This is why some settings lock
  once data exists (see below).
- `finished_at` on a judge is empty while they are judging and holds a time once
  they tap "I've Finished ALL My Presentations".

`db/schema.sql` creates a **new** database. A database that already holds data
is changed with a file from `db/migrations/` instead, because `schema.sql`
would fail on tables that exist (or, worse, tempt someone to drop them).

---

## The event settings (`symposium_config`)

All event-specific content lives in one JSON document, edited from the
dashboard's Config tab. Nothing about a specific event is hard-coded.

```
conferenceTitle
disciplines[]                    { id, label }
categories[]
   id, name
   maxPresentationNumber         highest number a judge may enter
   usesTimeSlots, timeSlots[]    { id, label, rangeHint }: identify by slot instead of number
   usesRoom, usesSession         also ask for room / session
   usesDiscipline                ask which discipline
   hasAbstractOption             ask "does it include an abstract?" (adds one criterion)
   abstractCriterion             { id, label, bullets }
   requireOpenEnded              default true: every open-ended question must be answered
   openEndedQuestions[]          { id, label }
   rubric
      scaleMin, scaleMax, scaleLabels
      criteria[]                 { id, label, bullets[] }
```

The server checks every save (`routes/config.js`). It refuses a malformed
config, and it **refuses a change that would orphan existing data**: renaming
or removing a category, time slot or discipline that is in use; changing how
presentations are identified or the rating scale once scores exist; and adding
or removing criteria once scores exist. Wording changes are always allowed.

---

## How scoring works

1. A judge signs in with a **code** and their name. A code seen for the first
   time creates the judge; the name saved first is the one that stays.
2. They choose a category, then identify the presentation: a **number** for
   Poster, a **time slot** for Oral and Video at this event.
3. They rate every criterion and answer the open-ended questions. Progress is
   saved on their own device, so a refresh loses nothing.
4. After a review screen they confirm. The server then:
   - rejects the score if any required criterion is missing (it knows the
     rubric from the settings; the abstract criterion is required only when the
     judge said the presentation has an abstract),
   - rejects it with `409` if this judge already scored this presentation,
   - **calculates the total itself** (the sum of the ratings),
   - saves it.
5. After a submit the judge chooses "Score Another Presentation" or "I've
   Finished ALL My Presentations". The second records `finished_at` so the
   organizers can see who has left. Scoring again clears it automatically.
6. A submitted score cannot be changed by the judge. An admin can edit it,
   move it to a different presentation (to fix a typo'd number or time slot),
   or delete it.

**The fairness adjustment.** A judge who rated one extra criterion (the
abstract) would otherwise get a higher raw total than judges who did not. For
rankings and the Excel layout sheets each score is scaled to the category's
normal size: `total × (criteria in the rubric ÷ criteria actually rated)`.
A presentation's score is the average of those across its judges.

---

## Design decisions and why

**Judges are identified by a unique code, not by name.** Names caused
unsolvable ambiguity: capitalization, spacing, titles ("Dr."), two people with
the same name, and someone writing their name differently on different days.
The code is the identity; the name is only a label. Codes are normalized
(trimmed and upper-cased) on the server so `j001 ` and `J001` are one judge.

**A presentation is identified by number (Poster) or by time slot (Oral and
Video), and room and session are ready for a future event.** For a later event
several rooms may run at the same time, so the same time label can repeat; room
and session then become part of the identity. The columns exist and the app
already matches on them. The database-level protection for that case is still
to do (see Known limitations).

**The server never trusts the browser.** Anything it can calculate it
calculates: the total, whether all required criteria are present, whether a
judge already scored, whether a config change is safe. Checks on the screen are
for friendliness; checks on the server are the real ones.

**One score per judge per presentation, and judges cannot edit afterwards.**
The app asks them to review before confirming. Corrections go through an admin,
so there is a single place where scores change.

**Settings are one row, overwritten each year, with no version history.** The
Excel export is the permanent record of an event, including criteria and
comments, so keeping old settings in the database as well would duplicate a
solved problem. **Download the export before clearing data.**

**Some settings lock once data exists.** Because scores store the category name
and time-slot label as text, renaming them would silently disconnect old
scores, and adding a criterion would distort the fairness scaling for scores
already submitted. So those changes are refused (by the screen and, firmly, by
the server) until the data is cleared.

**The open-ended answers rule lives only in the judge app.** It is a setting
(`requireOpenEnded`) the admin can turn off. The server does not enforce it, a
conscious trade: the only realistic way to submit is through the judge app.

**Admin accounts are managed from the server, with no sign-up page.** Only a
few trusted people need admin access, and "can log into the server" is a
stronger proof than any web form. See `deployment-pm2-caddy-steps.md`, Part 4.

**No Docker.** One VM, direct sudo access, and an install process that was
already proven locally. Docker's networking layer would have added risk and no
benefit at this scale.

**The admin dashboard is a separate page**, so judges never download admin
code, and nothing in the judge app links to it.

**Two small helper ideas used throughout the backend.** Database queries always
use placeholders (`$1`, `$2`) so user text can never be run as SQL. Routes that
mix a wildcard (`/:id`) with a fixed word (`/reset-all`) define the fixed one
first, or the wildcard swallows it.

---

## Who can do what

**No login needed** (this is how judges use the app):
read the settings, sign in (create or find a judge), mark themselves finished,
create or find a presentation, submit a score, and read score and presentation
lists.

**Admin login required** (a token from `POST /api/admin/login`, valid 8 hours):
save settings, rename a judge, edit or delete a score, reset all data, and read
the workload, the leaderboard and the Excel export.

Full detail is in API.md.

---

## Known limitations and open decisions

These are known and deliberate, not forgotten. The action list is in
BEFORE_THE_EVENT.md.

1. **Some reads are public.** `GET /api/scores`, `/api/judges` and
   `/api/presentations` need no login, so anyone who knew the address (and a
   judge's id) could read scores and judges' written comments. The previous
   Supabase version behaved the same way. Closing it properly needs judges to
   get a session at sign-in. Decide before real data is in the system.
2. **Admin password and login limits.** The live admin account still has its
   testing password, and login attempts are not rate-limited. Change the
   password (commands in the deployment guide, Part 4) before the event.
3. **The Excel export has fixed sheets for Poster, Oral and Video.** A category
   added later would have scores that appear in no sheet. Make the export build
   its sheets from the settings before adding categories.
4. **The dashboard cannot add or delete a whole category yet** (rubrics,
   criteria, time slots and everything else can be edited).
5. **`UNIQUE(time_slot, category)` would block the same time slot in two rooms.**
   Fine now; a room-and-session event needs a smarter constraint (a partial
   index) designed with real data.
6. **Finished scores are not queued offline.** A failed submit shows an error and
   the judge taps Confirm again (safe to repeat). Drafts are saved on the device.
7. **The `xlsx` package has a known vulnerability** that only matters when
   *reading* untrusted spreadsheets. This project only writes them, so it is
   accepted. Revisit if uploads are ever added.
8. **No automated tests.** Everything was checked by hand; the lists are in
   BEFORE_THE_EVENT.md and FRONTEND_CHECKLIST.md.

---

## Production setup in one paragraph

The VM runs Ubuntu. The backend lives in `~/scoring_system_V2` and runs as the
PM2 process `scoring-system` (restored on reboot). The frontend lives in
`~/scoring-frontend`; `npm run build` produces `dist/`, which is copied to
`/var/www/scoring`, the folder Caddy serves. The database is `scoring_system`,
owned by a dedicated login `scoring_app` (not the Postgres superuser). Caddy's
settings are in `/etc/caddy/Caddyfile`. Every command, and how to release a
change, is in `deployment-pm2-caddy-steps.md`.

---

## How this was built

The backend was designed one table and one route at a time, working through
edge cases before writing code instead of copying the old Supabase schema.
Several decisions changed along the way when real constraints appeared (for
example, Oral and Video turned out not to use presentation numbers), and the
reasoning above reflects what was actually decided, not the first guess.

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