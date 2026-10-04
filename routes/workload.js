const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

// GET /api/workload — admin-only. Every judge who has signed in, with how
// many presentations they've scored in each category, when they last
// scored, and whether they've tapped "I've Finished ALL My Presentations".
// A judge who signed in but hasn't scored anything is still listed (with a
// total of 0), so the admin can see who is here but stuck.
router.get('/', requireAdmin, async (req, res) => {
  try {
    // LEFT JOIN keeps judges that have no scores at all; for them the
    // category comes back empty, so they get no counts and a total of 0.
    const result = await pool.query(`
      SELECT judges.id,
             judges.code,
             judges.first_name,
             judges.last_name,
             judges.finished_at,
             presentations.category,
             COUNT(scores.id)::int AS score_count,
             MAX(scores.submitted_at) AS last_scored_at
      FROM judges
      LEFT JOIN scores ON scores.judge_id = judges.id
      LEFT JOIN presentations ON scores.presentation_id = presentations.id
      GROUP BY judges.id, presentations.category
      ORDER BY judges.id`);

    // The query returns one row per judge per category. Fold those into one
    // object per judge.
    const byJudge = new Map();
    result.rows.forEach((row) => {
      if (!byJudge.has(row.id)) {
        byJudge.set(row.id, {
          judgeId: row.id,
          code: row.code,
          firstName: row.first_name,
          lastName: row.last_name,
          finishedAt: row.finished_at,
          lastScoredAt: null,
          counts: {},
          total: 0,
        });
      }
      const judge = byJudge.get(row.id);
      if (row.category) {
        judge.counts[row.category] = row.score_count;
        judge.total += row.score_count;
        if (row.last_scored_at && (!judge.lastScoredAt || row.last_scored_at > judge.lastScoredAt)) {
          judge.lastScoredAt = row.last_scored_at;
        }
      }
    });

    res.json([...byJudge.values()]);
  } catch (err) {
    res.status(500).send(`Failed to build workload: ${err.message}`);
  }
});

module.exports = router;