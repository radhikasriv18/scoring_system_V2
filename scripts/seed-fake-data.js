// scripts/seed-fake-data.js
// Fills your LOCAL database with fake judges, presentations and scores
// by calling your own API, so totals and validation run exactly as in real use.
//
// Run (with the server already running in another terminal):
//   node scripts/seed-fake-data.js

const API = process.env.API_URL || "http://localhost:3000";

const JUDGES = [
  { code: "TEST01", first_name: "Priya",   last_name: "Sharma" },
  { code: "TEST02", first_name: "Michael", last_name: "Chen" },
  { code: "TEST03", first_name: "Sarah",   last_name: "Okafor" },
  { code: "TEST04", first_name: "David",   last_name: "Miller" },
];
const DISCIPLINES = ["Biology", "Computer Science", "Education", "Psychology", "History"];
const COMMENTS = [
  "Clear and well organized.",
  "Strong global connection.",
  "Could slow down a little.",
  "Great visuals.",
  "Needed more on methodology.",
];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

// Sends a POST to our API and throws a readable error if it fails
async function post(path, body) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

// Finds the abstract criterion's id, wherever the config keeps it
function findAbstractId(rubric) {
  if (rubric.abstractCriterion && rubric.abstractCriterion.id) return rubric.abstractCriterion.id;
  const c = (rubric.criteria || []).find(
    (c) => c.isAbstract || c.conditional || /abstract/i.test(c.id)
  );
  return c ? c.id : null;
}

async function main() {
  // 1. Read the real config, so fake scores use the real criteria ids
  const configRes = await fetch(API + "/api/config");
  const row = await configRes.json();
  const config = row && row.config ? row.config : row;
  if (!config || !config.categories) {
    throw new Error("No config found. Run db/seed-config.sql first.");
  }

  // 2. Create the fake judges (safe to re-run: existing codes are reused)
  const judges = [];
  for (const j of JUDGES) judges.push(await post("/api/judges", j));

  // 3. For each category: create presentations, then score them
  for (const cat of config.categories) {
    const rubric = cat.rubric;
    const abstractId = findAbstractId(rubric);
    const normalIds = rubric.criteria.map((c) => c.id).filter((id) => id !== abstractId);
    const min = rubric.scaleMin ?? 1;
    const max = rubric.scaleMax ?? 5;

    // Poster uses numbers 1..8; Oral/Video use their first 6 time slots
    const idents = cat.usesTimeSlots
      ? (cat.timeSlots || []).slice(0, 6).map((s) => ({
          time_slot: typeof s === "string" ? s : s.label || s.time,
        }))
      : Array.from({ length: Math.min(cat.maxPresentationNumber || 8, 8) }, (_, i) => ({
          presentation_number: String(i + 1),
        }));

    let scored = 0;
    for (const [i, ident] of idents.entries()) {
      const pres = await post("/api/presentations", {
        category: cat.name,
        discipline: pick(DISCIPLINES),
        ...ident,
      });

      // First presentation gets only ONE judge (edge case worth seeing in the sheet),
      // the rest get 2 or 3 judges
      const howMany = i === 0 ? 1 : randInt(2, 3);
      const chosen = [...judges].sort(() => Math.random() - 0.5).slice(0, howMany);

      for (const judge of chosen) {
        const criteria = {};
        for (const id of normalIds) criteria[id] = randInt(min, max);

        // About half the scores include the abstract criterion,
        // so the fairness scaling actually shows up
        const includesAbstract = abstractId !== null && Math.random() < 0.5;
        if (includesAbstract) criteria[abstractId] = randInt(min, max);

        try {
          await post("/api/scores", {
            judge_id: judge.id,
            presentation_id: pres.id,
            criteria,
            open_ended_answers: { q1: pick(COMMENTS) },
            includes_abstract: includesAbstract,
          });
          scored++;
        } catch (e) {
          if (e.message.includes("409")) continue; // already scored on a previous run
          throw e;
        }
      }
    }
    console.log(`${cat.name}: ${idents.length} presentations, ${scored} new scores`);
    if (abstractId === null) console.log(`  (no abstract criterion found for ${cat.name})`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error("Seeding failed:", e.message);
  process.exit(1);
});