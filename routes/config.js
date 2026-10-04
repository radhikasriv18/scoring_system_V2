const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

// Checks that the configuration is well-formed. Returns a plain-English
// description of the first problem, or null if it's fine. A malformed config
// would break the judge app for everyone, so this is checked before saving.
function validateConfigShape(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return 'The configuration must be an object.';
  }
  if (!isNonEmptyString(config.conferenceTitle)) {
    return 'The conference title cannot be empty.';
  }
  if (!Array.isArray(config.categories)) {
    return 'The categories must be a list.';
  }

  const disciplines = config.disciplines || [];
  if (!Array.isArray(disciplines)) {
    return 'The disciplines must be a list.';
  }
  if (disciplines.some((d) => !d || !isNonEmptyString(d.id) || !isNonEmptyString(d.label))) {
    return 'Every discipline needs a name.';
  }
  if (hasDuplicates(disciplines.map((d) => d.label.trim()))) {
    return 'Two disciplines have the same name.';
  }

  const categoryNames = [];
  const categoryIds = [];

  for (const category of config.categories) {
    if (!category || typeof category !== 'object') {
      return 'Every category must be an object.';
    }
    if (!isNonEmptyString(category.id)) {
      return 'Every category needs an id.';
    }
    if (!isNonEmptyString(category.name)) {
      return 'Every category needs a name.';
    }
    categoryIds.push(category.id);
    categoryNames.push(category.name.trim());
    const where = `Category "${category.name}"`;

    if (!Number.isInteger(category.maxPresentationNumber) || category.maxPresentationNumber < 1) {
      return `${where}: the highest presentation number must be a whole number of at least 1.`;
    }

    const timeSlots = category.timeSlots || [];
    if (!Array.isArray(timeSlots)) {
      return `${where}: the time slots must be a list.`;
    }
    if (timeSlots.some((s) => !s || !isNonEmptyString(s.id) || !isNonEmptyString(s.label))) {
      return `${where}: every time slot needs a label.`;
    }
    if (hasDuplicates(timeSlots.map((s) => s.label.trim()))) {
      return `${where}: two time slots have the same label.`;
    }
    if (hasDuplicates(timeSlots.map((s) => s.id))) {
      return `${where}: two time slots have the same id.`;
    }
    if (category.usesTimeSlots && timeSlots.length === 0) {
      return `${where}: it uses time slots, so it needs at least one.`;
    }

    const rubric = category.rubric;
    if (!rubric || typeof rubric !== 'object') {
      return `${where}: it is missing its rubric.`;
    }
    if (!Number.isInteger(rubric.scaleMin) || !Number.isInteger(rubric.scaleMax) || rubric.scaleMin >= rubric.scaleMax) {
      return `${where}: the lowest rating must be a whole number below the highest rating.`;
    }
    const criteria = rubric.criteria || [];
    if (!Array.isArray(criteria) || criteria.some((c) => !c || !isNonEmptyString(c.id) || !isNonEmptyString(c.label))) {
      return `${where}: every criterion needs a name.`;
    }
    if (hasDuplicates(criteria.map((c) => c.id))) {
      return `${where}: two criteria have the same id.`;
    }

    const questions = category.openEndedQuestions || [];
    if (!Array.isArray(questions) || questions.some((q) => !q || !isNonEmptyString(q.id) || !isNonEmptyString(q.label))) {
      return `${where}: every open-ended question needs some text.`;
    }
    if (hasDuplicates(questions.map((q) => q.id))) {
      return `${where}: two open-ended questions have the same id.`;
    }
  }

  if (hasDuplicates(categoryNames)) {
    return 'Two categories have the same name.';
  }
  if (hasDuplicates(categoryIds)) {
    return 'Two categories have the same id.';
  }

  return null;
}

// Scores store a category's NAME, a time slot's LABEL and a discipline's
// LABEL as plain text, and store ratings under each criterion's ID. So a
// change that would leave existing data pointing at something that no longer
// exists, or that would change how existing totals compare, is refused.
// Returns a plain-English reason, or null if the change is safe.
async function checkAgainstExistingData(newConfig) {
  const used = await pool.query('SELECT DISTINCT category, time_slot, discipline FROM presentations');
  const currentResult = await pool.query('SELECT config FROM symposium_config LIMIT 1');
  const currentConfig = currentResult.rows.length > 0 ? currentResult.rows[0].config : null;

  const usedCategories = [...new Set(used.rows.map((row) => row.category))];

  for (const name of usedCategories) {
    const category = newConfig.categories.find((c) => c.name.trim() === name);
    if (!category) {
      return `The category "${name}" already has presentations, so it cannot be renamed or removed.`;
    }

    // Time slots already in use must still exist, under the same label.
    const slotsInUse = used.rows.filter((row) => row.category === name && row.time_slot).map((row) => row.time_slot.trim());
    for (const slot of new Set(slotsInUse)) {
      if (!(category.timeSlots || []).some((s) => s.label.trim() === slot)) {
        return `The time slot "${slot}" in ${name} is already in use, so it cannot be renamed or removed.`;
      }
    }

    // How presentations are identified, the rating scale, and the set of
    // criteria can't change once scores exist for the category.
    const before = currentConfig && currentConfig.categories.find((c) => c.name === name);
    if (before) {
      const identificationChanged =
        Boolean(before.usesTimeSlots) !== Boolean(category.usesTimeSlots) ||
        Boolean(before.usesRoom) !== Boolean(category.usesRoom) ||
        Boolean(before.usesSession) !== Boolean(category.usesSession);
      if (identificationChanged) {
        return `${name} already has presentations, so whether it uses time slots, rooms or sessions cannot be changed.`;
      }

      if (before.rubric.scaleMin !== category.rubric.scaleMin || before.rubric.scaleMax !== category.rubric.scaleMax) {
        return `${name} already has scores, so its rating scale cannot be changed.`;
      }

      // Adding or removing a criterion would change how existing totals
      // compare (the fairness scaling divides by the number of criteria).
      // Reading/editing their wording is fine: only the set of ids matters.
      const beforeIds = before.rubric.criteria.map((c) => c.id).sort().join('|');
      const afterIds = category.rubric.criteria.map((c) => c.id).sort().join('|');
      if (beforeIds !== afterIds) {
        return `${name} already has scores, so criteria cannot be added or removed. Their wording can still be edited.`;
      }
    }
  }

  // Disciplines already in use must still exist, under the same name.
  const disciplinesInUse = [...new Set(used.rows.filter((row) => row.discipline).map((row) => row.discipline.trim()))];
  for (const discipline of disciplinesInUse) {
    if (!(newConfig.disciplines || []).some((d) => d.label.trim() === discipline)) {
      return `The discipline "${discipline}" is already in use, so it cannot be renamed or removed.`;
    }
  }

  return null;
}

// GET /api/config — return the current config. If no config row exists yet
// (first run), returns null rather than erroring — the caller decides what
// to do (e.g. show defaults, or trigger seeding).
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM symposium_config LIMIT 1');
    if (result.rows.length === 0) {
      return res.json(null);
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(`Failed to fetch config: ${err.message}`);
  }
});

// PUT /api/config — admin-only. Replaces the current config, after checking
// that it is well-formed and that it doesn't orphan existing data.
router.put('/', requireAdmin, async (req, res) => {
  const { config } = req.body;

  const shapeProblem = validateConfigShape(config);
  if (shapeProblem) {
    return res.status(400).send(shapeProblem);
  }

  try {
    const dataProblem = await checkAgainstExistingData(config);
    if (dataProblem) {
      return res.status(409).send(dataProblem);
    }

    const existing = await pool.query('SELECT id FROM symposium_config LIMIT 1');

    if (existing.rows.length === 0) {
      const result = await pool.query('INSERT INTO symposium_config (config) VALUES ($1) RETURNING *', [config]);
      return res.status(201).json(result.rows[0]);
    }

    const result = await pool.query('UPDATE symposium_config SET config = $1 WHERE id = $2 RETURNING *', [
      config,
      existing.rows[0].id,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(`Failed to update config: ${err.message}`);
  }
});

module.exports = router;