const pool = require('../db/pool');

// A presentation number is stored without leading zeros, so "05" and "5"
// are the same presentation.
function normalizeNumber(value) {
  return value ? String(value).trim().replace(/^0+/, '') || '0' : null;
}

async function findExisting({ category, number, time_slot, room, session }) {
  if (number) {
    return pool.query(
      'SELECT * FROM presentations WHERE presentation_number = $1 AND category = $2',
      [number, category]
    );
  }
  // IS NOT DISTINCT FROM (instead of =) treats NULL as matching NULL, so
  // when room/session aren't used (this event) the lookup still matches
  // other rows with no room/session. When they ARE used (a future event),
  // they're part of the match, so two different rooms sharing the same time
  // slot are correctly treated as different presentations.
  return pool.query(
    `SELECT * FROM presentations
     WHERE time_slot = $1 AND category = $2
     AND room IS NOT DISTINCT FROM $3
     AND session IS NOT DISTINCT FROM $4`,
    [time_slot, category, room || null, session || null]
  );
}

// Finds the presentation if it already exists, or creates it. Used by
// POST /api/presentations (a judge submitting) and by the admin edit that
// moves a score to a different presentation.
// Returns { presentation, created }.
async function findOrCreatePresentation({ category, presentation_number, time_slot, room, session, discipline }) {
  const number = normalizeNumber(presentation_number);
  const lookup = { category, number, time_slot, room, session };

  const existing = await findExisting(lookup);
  if (existing.rows.length > 0) {
    return { presentation: existing.rows[0], created: false };
  }

  try {
    const result = await pool.query(
      `INSERT INTO presentations (presentation_number, category, discipline, time_slot, room, session)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [number, category, discipline || null, time_slot || null, room || null, session || null]
    );
    return { presentation: result.rows[0], created: true };
  } catch (err) {
    // Two requests creating the same new presentation at the same moment:
    // the second insert hits the database's unique rule (code 23505). The
    // presentation exists now, so just use it.
    if (err.code === '23505') {
      const again = await findExisting(lookup);
      if (again.rows.length > 0) {
        return { presentation: again.rows[0], created: false };
      }
    }
    throw err;
  }
}

module.exports = { findOrCreatePresentation };