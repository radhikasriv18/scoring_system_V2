const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

// Fairness scaling: a judge who rated one extra criterion (the abstract)
// would otherwise get a higher raw total than judges who didn't, so their
// total is scaled back to the category's normal number of criteria:
//   total x (normal criteria count / criteria actually rated)
function computeScaledScore(scoreRow, categoryConfig) {
  const ratedCount = Object.keys(scoreRow.criteria || {}).length;
  if (ratedCount === 0) return 0;
  const normalCount = categoryConfig ? categoryConfig.rubric.criteria.length : ratedCount;
  return scoreRow.total * (normalCount / ratedCount);
}

// GET /api/leaderboard — admin-only. Every scored presentation, grouped by
// category and ranked by its average scaled score across the judges who
// scored it (highest first). Not cut off at 5: the dashboard decides how
// many to show, so a tie at the boundary isn't lost.
// Shape: { "Poster": [ { presentationId, presentationNumber, timeSlot,
//   room, session, discipline, averageScaledScore, judgeCount }, ... ] }
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT scores.presentation_id,
             scores.criteria,
             scores.total,
             presentations.category,
             presentations.presentation_number,
             presentations.time_slot,
             presentations.room,
             presentations.session,
             presentations.discipline
      FROM scores
      JOIN presentations ON scores.presentation_id = presentations.id`);

    const configResult = await pool.query('SELECT * FROM symposium_config LIMIT 1');
    const config = configResult.rows.length > 0 ? configResult.rows[0].config : { categories: [] };

    // Collect every judge's scaled score for each presentation.
    const groups = new Map();
    result.rows.forEach((row) => {
      const categoryConfig = config.categories.find((c) => c.name === row.category);
      const scaled = computeScaledScore(row, categoryConfig);

      if (!groups.has(row.presentation_id)) {
        groups.set(row.presentation_id, {
          presentationId: row.presentation_id,
          category: row.category,
          presentationNumber: row.presentation_number,
          timeSlot: row.time_slot,
          room: row.room,
          session: row.session,
          discipline: row.discipline,
          scaledScores: [],
        });
      }
      groups.get(row.presentation_id).scaledScores.push(scaled);
    });

    // Average per presentation, then bucket by category.
    const leaderboard = {};
    groups.forEach((group) => {
      const average = group.scaledScores.reduce((a, b) => a + b, 0) / group.scaledScores.length;
      if (!leaderboard[group.category]) leaderboard[group.category] = [];
      leaderboard[group.category].push({
        presentationId: group.presentationId,
        presentationNumber: group.presentationNumber,
        timeSlot: group.timeSlot,
        room: group.room,
        session: group.session,
        discipline: group.discipline,
        averageScaledScore: average,
        judgeCount: group.scaledScores.length,
      });
    });

    Object.keys(leaderboard).forEach((category) => {
      leaderboard[category].sort((a, b) => b.averageScaledScore - a.averageScaledScore);
    });

    res.json(leaderboard);
  } catch (err) {
    res.status(500).send(`Failed to build leaderboard: ${err.message}`);
  }
});

module.exports = router;