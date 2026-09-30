const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

function sumCriteria(criteria) {
  return Object.values(criteria || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

function getRequiredCriteriaIds(config, categoryName, includesAbstract) {
  const category = config.categories.find((c) => c.name === categoryName);
  if (!category) return [];

  const ids = category.rubric.criteria.map((c) => c.id);
  if (includesAbstract && category.abstractCriterion) {
    ids.push(category.abstractCriterion.id);
  }
  return ids;
}

// POST /api/scores — create a new score.
router.post('/', async (req, res) => {
  const { judge_id, presentation_id, criteria, open_ended_answers, includes_abstract } = req.body;

  if (!judge_id || !presentation_id || !criteria || Object.keys(criteria).length === 0) {
    return res.status(400).send('judge_id, presentation_id, and at least one criterion are required.');
  }

  try {
    const judgeCheck = await pool.query('SELECT * FROM judges WHERE id = $1', [judge_id]);
    if (judgeCheck.rows.length === 0) {
      return res.status(404).send('No judge found with that judge_id.');
    }

    const presentationCheck = await pool.query('SELECT * FROM presentations WHERE id = $1', [presentation_id]);
    if (presentationCheck.rows.length === 0) {
      return res.status(404).send('No presentation found with that presentation_id.');
    }
    const presentation = presentationCheck.rows[0];

    const configResult = await pool.query('SELECT * FROM symposium_config LIMIT 1');
    if (configResult.rows.length > 0) {
      const config = configResult.rows[0].config;
      const requiredIds = getRequiredCriteriaIds(config, presentation.category, includes_abstract || false);
      const missingIds = requiredIds.filter((id) => !(id in criteria));
      if (missingIds.length > 0) {
        return res.status(400).send(`Missing required criteria: ${missingIds.join(', ')}`);
      }
    }

    const existingScore = await pool.query(
      'SELECT * FROM scores WHERE judge_id = $1 AND presentation_id = $2',
      [judge_id, presentation_id]
    );
    if (existingScore.rows.length > 0) {
      return res.status(409).send('You have already scored this presentation.');
    }

    const total = sumCriteria(criteria);

    const result = await pool.query(
      `INSERT INTO scores (judge_id, presentation_id, criteria, open_ended_answers, includes_abstract, total)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [judge_id, presentation_id, criteria, open_ended_answers || {}, includes_abstract || false, total]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).send(`Failed to create score: ${err.message}`);
  }
});

// GET /api/scores — list all scores, newest first.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM scores ORDER BY submitted_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(`Failed to fetch scores: ${err.message}`);
  }
});

// PUT /api/scores/:id — admin-only. Corrects an existing score.
router.put('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { criteria, open_ended_answers, includes_abstract } = req.body;

  if (!criteria || Object.keys(criteria).length === 0) {
    return res.status(400).send('criteria is required.');
  }

  try {
    const existing = await pool.query('SELECT * FROM scores WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).send('No score found with that id.');
    }

    const total = sumCriteria(criteria);

    const result = await pool.query(
      `UPDATE scores
       SET criteria = $1, open_ended_answers = $2, includes_abstract = $3, total = $4
       WHERE id = $5
       RETURNING *`,
      [criteria, open_ended_answers || {}, includes_abstract || false, total, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(`Failed to update score: ${err.message}`);
  }
});

// DELETE /api/scores/reset-all — admin-only. Full fresh start: wipes
// scores, judges, AND presentations. Defined BEFORE /:id below, since
// Express matches routes top-to-bottom and /:id would otherwise treat the
// literal text "reset-all" as an id and swallow this request first.
// Order of deletion matters too — scores must go first, since judges and
// presentations are referenced by foreign key from scores.
router.delete('/reset-all', requireAdmin, async (req, res) => {
  try {
    const scoresDeleted = await pool.query('DELETE FROM scores RETURNING *');
    const judgesDeleted = await pool.query('DELETE FROM judges RETURNING *');
    const presentationsDeleted = await pool.query('DELETE FROM presentations RETURNING *');

    res.json({
      scoresDeleted: scoresDeleted.rows.length,
      judgesDeleted: judgesDeleted.rows.length,
      presentationsDeleted: presentationsDeleted.rows.length,
    });
  } catch (err) {
    res.status(500).send(`Failed to reset: ${err.message}`);
  }
});

// DELETE /api/scores/:id — admin-only. Deletes a single score.
router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM scores WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).send('No score found with that id.');
    }
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    res.status(500).send(`Failed to delete score: ${err.message}`);
  }
});

router.get('/', async (req, res) => {
  const { judge_id, category } = req.query;

  try {
    let query = 'SELECT scores.* FROM scores';
    const conditions = [];
    const values = [];

    if (judge_id) {
      values.push(judge_id);
      conditions.push(`scores.judge_id = $${values.length}`);
    }

    if (category) {
      query = 'SELECT scores.* FROM scores JOIN presentations ON scores.presentation_id = presentations.id';
      values.push(category);
      conditions.push(`presentations.category = $${values.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY scores.submitted_at DESC';

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(`Failed to fetch scores: ${err.message}`);
  }
});

module.exports = router;