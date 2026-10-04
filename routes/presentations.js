const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { findOrCreatePresentation } = require('../services/presentations');

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

  try {
    const { presentation, created } = await findOrCreatePresentation({
      category,
      presentation_number,
      time_slot,
      room,
      session,
      discipline,
    });
    res.status(created ? 201 : 200).json(presentation);
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