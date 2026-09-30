const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const scoresResult = await pool.query('SELECT * FROM scores');
    const judgesResult = await pool.query('SELECT * FROM judges');
    const presentationsResult = await pool.query('SELECT * FROM presentations');

    const judgesById = {};
    judgesResult.rows.forEach((j) => {
      judgesById[j.id] = j;
    });

    const presentationsById = {};
    presentationsResult.rows.forEach((p) => {
      presentationsById[p.id] = p;
    });

    const workloadByJudge = {};

    scoresResult.rows.forEach((score) => {
      const judge = judgesById[score.judge_id];
      const presentation = presentationsById[score.presentation_id];
      if (!judge || !presentation) return;

      if (!workloadByJudge[judge.id]) {
        workloadByJudge[judge.id] = {
          judgeId: judge.id,
          judgeName: `${judge.first_name} ${judge.last_name}`,
          counts: {},
          total: 0,
        };
      }

      const entry = workloadByJudge[judge.id];
      entry.counts[presentation.category] = (entry.counts[presentation.category] || 0) + 1;
      entry.total += 1;
    });

    res.json(Object.values(workloadByJudge));
  } catch (err) {
    res.status(500).send(`Failed to build workload: ${err.message}`);
  }
});

module.exports = router;