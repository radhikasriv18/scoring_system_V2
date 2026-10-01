const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');
const XLSX = require('xlsx');

// Same fairness formula used by the leaderboard route: total scaled to the
// category's normal criteria count, accounting for judges who rated an
// extra (abstract) criterion.
function computeScaledScore(scoreRow, categoryConfig) {
  const ratedCount = Object.keys(scoreRow.criteria || {}).length;
  if (ratedCount === 0) return 0;
  const normalCount = categoryConfig ? categoryConfig.rubric.criteria.length : ratedCount;
  return scoreRow.total * (normalCount / ratedCount);
}

// Splits "First Middle Last" style names is not needed here since judges
// already have separate first_name/last_name columns (unlike the old app,
// which had to split a single combined name string).

const EXPORT_SHEETS = [
  { categoryName: 'Poster', sheetName: 'PosterPresentations' },
  { categoryName: 'Oral', sheetName: 'OralPresentations' },
  { categoryName: 'Video', sheetName: 'VideoPresentations' },
];

// Figures out which identifying columns a category actually uses, driven
// entirely by its config flags (usesRoom/usesSession/usesTimeSlots) — not
// hardcoded per category. This event's Oral/Video only have usesTimeSlots
// on, so they get one "TIME SLOT" column. A future event that also turns
// on usesRoom/usesSession would get three separate columns (ROOM, SESSION,
// TIME) instead, matching the university's original template — same code,
// no changes needed, since it just reads whatever the config says.
// Falls back to a presentation-number column when a category uses none of
// these flags (e.g. Poster).
function getIdentifyingColumns(categoryConfig) {
  const columns = [];
  if (categoryConfig && categoryConfig.usesRoom) columns.push({ label: 'ROOM', field: 'room' });
  if (categoryConfig && categoryConfig.usesSession) columns.push({ label: 'SESSION', field: 'session' });
  if (categoryConfig && categoryConfig.usesTimeSlots) columns.push({ label: 'TIME', field: 'time_slot' });

  if (columns.length === 0) {
    columns.push({ label: `${(categoryConfig ? categoryConfig.name : '').toUpperCase()}#`, field: 'presentation_number' });
  }

  return columns;
}

// Builds one sheet's rows: one or more leading columns identifying each
// presentation (driven by the category's config flags — see
// getIdentifyingColumns), one column per judge who scored anything in this
// category (first-appearance order), each cell that judge's scaled score
// (blank if they didn't score it), plus TOTAL SCORE / NumberOf Judges /
// MEAN SCORE.
function buildSheetData(scores, presentationsById, judgesById, categoryConfig, categoryName) {
  const identifyingColumns = getIdentifyingColumns(categoryConfig);
  const categoryScores = scores.filter((s) => {
    const presentation = presentationsById[s.presentation_id];
    return presentation && presentation.category === categoryName;
  });

  // Judge columns, in first-appearance order.
  const judgeOrder = [];
  const seenJudges = new Set();
  categoryScores.forEach((s) => {
    if (!seenJudges.has(s.judge_id)) {
      seenJudges.add(s.judge_id);
      judgeOrder.push(judgesById[s.judge_id]);
    }
  });

  // Presentation rows — identified by number if the category uses one,
  // otherwise by time_slot (matches the dual identification scheme in
  // routes/presentations.js).
  const presentationIds = [];
  const seenPresentations = new Set();
  categoryScores.forEach((s) => {
    if (!seenPresentations.has(s.presentation_id)) {
      seenPresentations.add(s.presentation_id);
      presentationIds.push(s.presentation_id);
    }
  });

  const rows = presentationIds.map((presId) => {
    const presentation = presentationsById[presId];
    const identifyingValues = identifyingColumns.map((col) => presentation[col.field] || '');

    const cellScores = judgeOrder.map((judge) => {
      const scoreRow = categoryScores.find((s) => s.judge_id === judge.id && s.presentation_id === presId);
      return scoreRow ? computeScaledScore(scoreRow, categoryConfig) : undefined;
    });

    const nonBlank = cellScores.filter((v) => v !== undefined);
    const total = nonBlank.reduce((a, b) => a + b, 0);
    const numberOf = nonBlank.length;
    const mean = numberOf > 0 ? total / numberOf : 0;

    return { identifyingValues, cellScores, total, numberOf, mean };
  });

  // One blank placeholder per identifying column on the header rows that
  // don't carry its label, so the two-row header and the data rows below
  // always line up — e.g. with 3 identifying columns (ROOM/SESSION/TIME),
  // headerRowA gets 2 blanks before "Judge'sName" lines up over the first
  // judge column, not over ROOM.
  const blankPad = (n) => Array(n).fill('');

  const headerRowA = [
    ...blankPad(identifyingColumns.length - 1),
    "Judge'sName",
    ...judgeOrder.map((j) => j.first_name),
    'TOTAL',
    'NumberOf',
    'MEAN',
  ];
  const headerRowB = [
    ...identifyingColumns.map((col) => col.label),
    ...judgeOrder.map((j) => j.last_name),
    'SCORE',
    'Judges',
    'SCORE',
  ];

  const dataRows = rows.map((r) => [
    ...r.identifyingValues,
    ...r.cellScores.map((v) => (v === undefined ? '' : v)),
    r.total,
    r.numberOf,
    r.mean,
  ]);

  return [headerRowA, headerRowB, ...dataRows];
}

// Builds one category's raw data sheet: one row per score (for that
// category only), every criterion value, every open-ended answer, judge
// and presentation details, and the timestamp. This is the real
// historical record — since symposium_config is a single row overwritten
// each year (not versioned), these sheets are what actually preserve
// "what happened, exactly" before a reset-all wipes the live database for
// the next event. Split by category (RawData-Poster, RawData-Oral,
// RawData-Video), mirroring the summary sheets' structure.
function buildRawDataSheet(scores, presentationsById, judgesById, categoryName) {
  const categoryScores = scores.filter((s) => {
    const presentation = presentationsById[s.presentation_id];
    return presentation && presentation.category === categoryName;
  });
  // Gather every criterion id and every open-ended question id that
  // appears anywhere in the data, since different categories use
  // different criteria/questions and a score's shape isn't fixed.
  const criterionIds = [];
  const seenCriteria = new Set();
  const questionIds = [];
  const seenQuestions = new Set();

  categoryScores.forEach((s) => {
    Object.keys(s.criteria || {}).forEach((id) => {
      if (!seenCriteria.has(id)) {
        seenCriteria.add(id);
        criterionIds.push(id);
      }
    });
    Object.keys(s.open_ended_answers || {}).forEach((id) => {
      if (!seenQuestions.has(id)) {
        seenQuestions.add(id);
        questionIds.push(id);
      }
    });
  });

  const header = [
    'Judge Code',
    'Judge First Name',
    'Judge Last Name',
    'Presentation Number',
    'Time Slot',
    'Room',
    'Session',
    'Discipline',
    ...criterionIds,
    'Includes Abstract',
    'Total',
    ...questionIds,
    'Submitted At',
  ];

  const dataRows = categoryScores.map((s) => {
    const judge = judgesById[s.judge_id] || {};
    const presentation = presentationsById[s.presentation_id] || {};

    return [
      judge.code || '',
      judge.first_name || '',
      judge.last_name || '',
      presentation.presentation_number || '',
      presentation.time_slot || '',
      presentation.room || '',
      presentation.session || '',
      presentation.discipline || '',
      ...criterionIds.map((id) => (s.criteria && s.criteria[id] !== undefined ? s.criteria[id] : '')),
      s.includes_abstract,
      s.total,
      ...questionIds.map((id) => (s.open_ended_answers && s.open_ended_answers[id]) || ''),
      s.submitted_at,
    ];
  });

  return [header, ...dataRows];
}

// GET /api/export/excel — admin-only. Builds and downloads the results
// workbook: one sheet per category, matching the university's template,
// plus a RawData sheet (every score, every criterion, every comment) that
// serves as the permanent historical record before a reset-all.
router.get('/excel', requireAdmin, async (req, res) => {
  try {
    const scoresResult = await pool.query('SELECT * FROM scores');
    const presentationsResult = await pool.query('SELECT * FROM presentations');
    const judgesResult = await pool.query('SELECT * FROM judges');
    const configResult = await pool.query('SELECT * FROM symposium_config LIMIT 1');

    const scores = scoresResult.rows;

    const presentationsById = {};
    presentationsResult.rows.forEach((p) => {
      presentationsById[p.id] = p;
    });

    const judgesById = {};
    judgesResult.rows.forEach((j) => {
      judgesById[j.id] = j;
    });

    const config = configResult.rows.length > 0 ? configResult.rows[0].config : { categories: [] };

    const workbook = XLSX.utils.book_new();

    EXPORT_SHEETS.forEach(({ categoryName, sheetName }) => {
      const categoryConfig = config.categories.find((c) => c.name === categoryName);
      const sheetData = buildSheetData(scores, presentationsById, judgesById, categoryConfig, categoryName);
      const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });

    EXPORT_SHEETS.forEach(({ categoryName }) => {
      const rawSheetData = buildRawDataSheet(scores, presentationsById, judgesById, categoryName);
      const rawWorksheet = XLSX.utils.aoa_to_sheet(rawSheetData);
      XLSX.utils.book_append_sheet(workbook, rawWorksheet, `RawData-${categoryName}`);
    });

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename=symposium_scores_${stamp}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).send(`Failed to build export: ${err.message}`);
  }
});

module.exports = router;