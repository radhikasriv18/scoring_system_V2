const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

// POST /api/judges — create a new judge, or return the existing one if the
// code already exists.
router.post('/', async (req, res) => {
  const { first_name, last_name } = req.body;

  // Codes are matched exactly, so normalize them first: "j001 " and "J001"
  // must resolve to the same judge.
  const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';

  if (!code || !first_name || !last_name) {
    return res.status(400).send('code, first_name, and last_name are all required.');
  }

  try {
    const existing = await pool.query('SELECT * FROM judges WHERE code = $1', [code]);
    if (existing.rows.length > 0) {
      return res.json(existing.rows[0]);
    }

    const result = await pool.query(
      'INSERT INTO judges (code, first_name, last_name) VALUES ($1, $2, $3) RETURNING *',
      [code, first_name, last_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).send(`Error creating judge: ${err.message}`);
  }
});

// GET /api/judges — list every judge, newest first.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM judges ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(`Failed to fetch judges: ${err.message}`);
  }
});

// PUT /api/judges/:id — admin-only. Fixes a judge's name (for example a
// typo from their first sign-in, since the name saved first is the one
// that stays). The code never changes: it's what identifies the judge.
router.put('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const firstName = typeof req.body.first_name === 'string' ? req.body.first_name.trim() : '';
  const lastName = typeof req.body.last_name === 'string' ? req.body.last_name.trim() : '';

  if (!Number.isInteger(id)) {
    return res.status(400).send('Invalid judge id.');
  }
  if (!firstName || !lastName) {
    return res.status(400).send('first_name and last_name are required.');
  }

  try {
    const result = await pool.query(
      'UPDATE judges SET first_name = $1, last_name = $2 WHERE id = $3 RETURNING *',
      [firstName, lastName, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).send('No judge found with that id.');
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(`Failed to update judge: ${err.message}`);
  }
});

// PUT /api/judges/:id/finished — body { finished: true | false }.
// true  = the judge tapped "I've Finished ALL My Presentations": records when.
// false = they went back to keep scoring: clears it.
router.put('/:id/finished', async (req, res) => {
  const id = Number(req.params.id);
  const { finished } = req.body;

  if (!Number.isInteger(id)) {
    return res.status(400).send('Invalid judge id.');
  }
  if (typeof finished !== 'boolean') {
    return res.status(400).send('finished must be true or false.');
  }

  try {
    const result = await pool.query(
      'UPDATE judges SET finished_at = CASE WHEN $1::boolean THEN now() ELSE NULL END WHERE id = $2 RETURNING *',
      [finished, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).send('No judge found with that id.');
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(`Failed to update judge: ${err.message}`);
  }
});

module.exports = router;