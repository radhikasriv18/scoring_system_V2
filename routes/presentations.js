const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// POST /api/presentations — create a new presentation, or return the
// existing one. Poster is identified by (presentation_number, category);
// Oral/Video by (time_slot, room, session, category).
router.post('/', async (req, res) => {
  const { presentation_number, category, discipline, time_slot, room, session } = req.body;

  if (!category) {
    return res.status(400).send('category is required.');
  }
  if (!presentation_number && !time_slot) {
    return res.status(400).send('Either presentation_number or time_slot is required.');
  }

  const normalizedNumber = presentation_number
    ? String(presentation_number).trim().replace(/^0+/, '') || '0'
    : null;

  try {
    let existing;
    if (normalizedNumber) {
      existing = await pool.query(
        'SELECT * FROM presentations WHERE presentation_number = $1 AND category = $2',
        [normalizedNumber, category]
      );
    } else {
      // IS NOT DISTINCT FROM (instead of =) treats NULL as matching NULL, so
      // when room/session aren't used (this event) the lookup still matches
      // other rows with no room/session. When they ARE used (a future
      // event), they're part of the match, so two different rooms sharing
      // the same time slot are correctly treated as different presentations.
      existing = await pool.query(
        `SELECT * FROM presentations
         WHERE time_slot = $1 AND category = $2
         AND room IS NOT DISTINCT FROM $3
         AND session IS NOT DISTINCT FROM $4`,
        [time_slot, category, room || null, session || null]
      );
    }

    if (existing.rows.length > 0) {
      return res.json(existing.rows[0]);
    }

    const result = await pool.query(
      `INSERT INTO presentations (presentation_number, category, discipline, time_slot, room, session)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [normalizedNumber, category, discipline || null, time_slot || null, room || null, session || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).send(`Failed to create presentation: ${err.message}`);
  }
});

// GET /api/presentations — list every presentation, newest first.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM presentations ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(`Failed to fetch presentations: ${err.message}`);
  }
});

module.exports = router;