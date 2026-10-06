// loadtest.js — simulates many judges using the scoring system at once.
//
// Usage:
//   node loadtest.js <mode> [baseUrl]
//
//   mode:    realistic | burst | doubletap
//   baseUrl: defaults to http://localhost:3000
//
// Every judge this script creates has a code starting with "LOADTEST" and
// scores only presentations numbered 9001+, so test data never mixes with
// real data and can be removed with cleanup.sql (no Danger Zone needed).
//
// Plain Node.js 18+ only: uses the built-in fetch, no packages to install.

const MODE = process.argv[2];
const BASE_URL = (process.argv[3] || 'http://localhost:3000').replace(/\/$/, '');

const JUDGE_COUNT = 40;
const SCORES_PER_JUDGE = 5;     // realistic mode only
const TEST_PRESENTATIONS = 10;  // test presentations 9001..9010
const FIRST_TEST_NUMBER = 9001;
const CATEGORY = 'Poster';

// A unique tag per run, so running the script twice never reuses judges.
const RUN_ID = Date.now().toString(36).toUpperCase();

// ---------------------------------------------------------------------------
// Request helper: every API call goes through here, so we can time it and
// record whether it worked, all in one place.
// ---------------------------------------------------------------------------
const results = []; // { label, status, ms, error }

async function call(label, method, path, body) {
  const start = performance.now();
  try {
    const res = await fetch(BASE_URL + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ms = performance.now() - start;
    const text = await res.text();
    const ok = res.status >= 200 && res.status < 300;
    results.push({ label, status: res.status, ms, error: ok ? null : text });
    return { status: res.status, data: ok ? JSON.parse(text) : null, text };
  } catch (err) {
    // Network-level failure: server down, connection refused, timeout.
    const ms = performance.now() - start;
    results.push({ label, status: 'NETWORK', ms, error: err.message });
    return { status: 'NETWORK', data: null, text: err.message };
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// Pick `count` different presentation numbers, so a judge never scores the
// same presentation twice (the real app wouldn't let them either).
function pickPresentations(count) {
  const all = Array.from({ length: TEST_PRESENTATIONS }, (_, i) => FIRST_TEST_NUMBER + i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}

// Build a valid criteria object from the live config: one random score per
// criterion, within the rubric's scale (e.g. 1–5).
function randomCriteria(category) {
  const { scaleMin, scaleMax, criteria } = category.rubric;
  const out = {};
  for (const c of criteria) out[c.id] = randInt(scaleMin, scaleMax);
  return out;
}

// ---------------------------------------------------------------------------
// The steps a real judge goes through, as API calls.
// ---------------------------------------------------------------------------
async function signIn(n) {
  const res = await call('POST /api/judges', 'POST', '/api/judges', {
    code: `LOADTEST-${RUN_ID}-${n}`,
    first_name: 'LOADTEST',
    last_name: `Judge${n}`,
  });
  return res.data; // the judge row, or null if it failed
}

async function getPresentation(number) {
  const res = await call('POST /api/presentations', 'POST', '/api/presentations', {
    category: CATEGORY,
    presentation_number: String(number),
  });
  return res.data;
}

async function submitScore(judge, presentation, category) {
  return call('POST /api/scores', 'POST', '/api/scores', {
    judge_id: judge.id,
    presentation_id: presentation.id,
    criteria: randomCriteria(category),
    open_ended_answers: { q1: 'Load test', q2: 'Load test' },
    includes_abstract: false,
  });
}

// ---------------------------------------------------------------------------
// The three modes
// ---------------------------------------------------------------------------

// REALISTIC: 40 judges work in parallel, each scoring 5 presentations with a
// 5–15 second pause in between (a sped-up version of a real session).
async function realistic(category) {
  console.log(`${JUDGE_COUNT} judges × ${SCORES_PER_JUDGE} scores, 5–15s pauses (takes ~1–2 min)...`);
  const judges = Array.from({ length: JUDGE_COUNT }, (_, i) => i + 1);

  await Promise.all(
    judges.map(async (n) => {
      await sleep(randInt(0, 5000)); // judges don't all arrive at the same second
      await call('GET /api/config', 'GET', '/api/config'); // page load
      const judge = await signIn(n);
      if (!judge) return;

      for (const number of pickPresentations(SCORES_PER_JUDGE)) {
        await sleep(randInt(5000, 15000)); // "watching the presentation"
        const presentation = await getPresentation(number);
        if (presentation) await submitScore(judge, presentation, category);
      }
    })
  );
  return JUDGE_COUNT * SCORES_PER_JUDGE;
}

// BURST: everyone signs in first, then all 40 hit Submit at the same instant,
// like the end of a session.
async function burst(category) {
  console.log(`Signing in ${JUDGE_COUNT} judges, then all submit at the same instant...`);
  const judges = await Promise.all(Array.from({ length: JUDGE_COUNT }, (_, i) => signIn(i + 1)));
  const presentations = await Promise.all(
    judges.map((_, i) => getPresentation(FIRST_TEST_NUMBER + (i % TEST_PRESENTATIONS)))
  );

  await Promise.all(
    judges.map((judge, i) => judge && presentations[i] && submitScore(judge, presentations[i], category))
  );
  return JUDGE_COUNT;
}

// DOUBLETAP: each of 10 judges sends the exact same score twice at the same
// moment — what happens with a double-tap, or when the offline retry sync
// fires while the original request is still in flight. Correct behaviour:
// one 201 (saved) and one 409 (already scored) per judge, never a 500, and
// never two rows in the database. Also signs one judge in twice at once.
async function doubletap(category) {
  console.log('10 judges each submit the same score twice at the same moment...');
  const judges = await Promise.all(Array.from({ length: 10 }, (_, i) => signIn(i + 1)));
  const presentation = await getPresentation(FIRST_TEST_NUMBER);

  await Promise.all(
    judges.flatMap((judge) => {
      const body = {
        judge_id: judge.id,
        presentation_id: presentation.id,
        criteria: randomCriteria(category),
        open_ended_answers: {},
        includes_abstract: false,
      };
      return [
        call('POST /api/scores (double-tap)', 'POST', '/api/scores', body),
        call('POST /api/scores (double-tap)', 'POST', '/api/scores', body),
      ];
    })
  );

  console.log('Same judge code signing in on two devices at the same moment...');
  const twin = { code: `LOADTEST-${RUN_ID}-TWIN`, first_name: 'LOADTEST', last_name: 'Twin' };
  await Promise.all([
    call('POST /api/judges (same code twice)', 'POST', '/api/judges', twin),
    call('POST /api/judges (same code twice)', 'POST', '/api/judges', twin),
  ]);
  return 10;
}

// ---------------------------------------------------------------------------
// Report: per request type, how many succeeded, how fast, what failed.
// ---------------------------------------------------------------------------
function report(expectedScores) {
  const byLabel = {};
  for (const r of results) (byLabel[r.label] ||= []).push(r);

  console.log('\n=== Results ===');
  for (const [label, rows] of Object.entries(byLabel)) {
    const times = rows.map((r) => r.ms).sort((a, b) => a - b);
    const avg = times.reduce((s, t) => s + t, 0) / times.length;
    const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
    const statuses = {};
    for (const r of rows) statuses[r.status] = (statuses[r.status] || 0) + 1;

    console.log(`\n${label}`);
    console.log(`  requests: ${rows.length}   statuses: ${JSON.stringify(statuses)}`);
    console.log(`  avg ${avg.toFixed(0)} ms   95% under ${p95.toFixed(0)} ms   slowest ${times.at(-1).toFixed(0)} ms`);

    const errors = [...new Set(rows.filter((r) => r.error).map((r) => `${r.status}: ${r.error}`))];
    for (const e of errors.slice(0, 5)) console.log(`  ! ${e.slice(0, 150)}`);
  }

  const saved = results.filter((r) => r.label.startsWith('POST /api/scores') && r.status === 201).length;
  console.log(`\nScores saved (201): ${saved}   expected: ${expectedScores}`);
  console.log(`Run ID: ${RUN_ID}  — check the database with verify.sql\n`);
}

// ---------------------------------------------------------------------------
async function main() {
  const modes = { realistic, burst, doubletap };
  if (!modes[MODE]) {
    console.log('Usage: node loadtest.js <realistic|burst|doubletap> [baseUrl]');
    process.exit(1);
  }

  // Read the live rubric first, so scores always match the current config.
  const cfg = await call('GET /api/config', 'GET', '/api/config');
  const category = cfg.data?.config?.categories?.find((c) => c.name === CATEGORY);
  if (!category) {
    console.log(`Could not load the "${CATEGORY}" category from ${BASE_URL}/api/config — is the server up?`);
    process.exit(1);
  }
  results.length = 0; // don't count the setup call in the report

  console.log(`Target: ${BASE_URL}   Mode: ${MODE}   Run: ${RUN_ID}`);
  const started = performance.now();
  const expected = await modes[MODE](category);
  console.log(`Finished in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  report(expected);
}

main();
