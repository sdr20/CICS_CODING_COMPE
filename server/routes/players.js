const express = require('express');
const router = express.Router();
const db = require('../database');
const svc = require('../services/competitionService');
const { isAnswerCorrect } = require('../services/answerCheck');
const { broadcast } = require('../services/sse');

/* POST /api/players  { username } -> create or resume a player */
router.post('/players', (req, res) => {
  const raw = (req.body && req.body.username) || '';
  const username = String(raw).trim();

  if (!username) {
    return res.status(400).json({ error: 'Username is required.' });
  }
  if (username.length > 30) {
    return res.status(400).json({ error: 'Username must be 30 characters or fewer.' });
  }

  const existing = db.prepare('SELECT * FROM players WHERE username = ? COLLATE NOCASE').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken. Please choose another username.' });
  }

  const info = db
    .prepare('INSERT INTO players (username, status) VALUES (?, ?)')
    .run(username, 'ACTIVE');

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid);
  broadcast('leaderboard', svc.computeLeaderboard());
  broadcast('admin', { type: 'player_joined', username });

  res.status(201).json({ player });
});

/* GET /api/players/:id -> raw player record */
router.get('/players/:id', (req, res) => {
  const player = svc.getPlayerById(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found.' });
  res.json({ player });
});

/* GET /api/players/:id/dashboard -> everything the player UI needs to render */
router.get('/players/:id/dashboard', (req, res) => {
  const player = svc.getPlayerById(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found.' });

  const competition = svc.getCompetition();
  const levelStates = svc.getPlayerLevelStates(player.id);

  // Attach the (answer-free) question for whatever level is currently playable.
  const activeState = levelStates.find((l) => l.status === 'AVAILABLE' || l.status === 'IN_PROGRESS');
  let activeQuestion = null;
  if (activeState) {
    const q = svc.getQuestionForLevel(activeState.level_id);
    if (q) {
      activeQuestion = {
        id: q.id,
        title: q.title,
        description: q.description,
        code: q.code,
        language: q.language
      };
    }
  }

  const completedCount = levelStates.filter((l) => l.status === 'COMPLETED').length;

  res.json({
    player,
    competition_status: competition.status,
    levels: levelStates,
    active_level_id: activeState ? activeState.level_id : null,
    active_question: activeQuestion,
    completed_count: completedCount,
    total_levels: levelStates.length
  });
});

/* POST /api/players/:id/levels/:levelId/start -> idempotent; returns authoritative started_at */
router.post('/players/:id/levels/:levelId/start', (req, res) => {
  const player = svc.getPlayerById(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found.' });

  if (!svc.isCompetitionRunning()) {
    return res.status(423).json({ error: 'Competition is not currently running.', competition_status: svc.getCompetition().status });
  }

  const levelId = Number(req.params.levelId);
  const states = svc.getPlayerLevelStates(player.id);
  const target = states.find((s) => s.level_id === levelId);

  if (!target) return res.status(404).json({ error: 'Level not found.' });
  if (target.status === 'LOCKED') {
    return res.status(403).json({ error: 'This level is locked. Complete previous levels first.' });
  }
  if (target.status === 'COMPLETED') {
    return res.status(400).json({ error: 'This level is already completed.' });
  }

  let row = db.prepare('SELECT * FROM player_levels WHERE player_id = ? AND level_id = ?').get(player.id, levelId);

  if (row.status === 'AVAILABLE') {
    const startedAt = svc.nowIso();
    db.prepare(`UPDATE player_levels SET status = 'IN_PROGRESS', started_at = ? WHERE id = ?`).run(startedAt, row.id);
    row = db.prepare('SELECT * FROM player_levels WHERE id = ?').get(row.id);

    // First-ever level start marks the player's overall competition clock.
    if (!player.competition_started_at) {
      db.prepare('UPDATE players SET competition_started_at = ? WHERE id = ?').run(startedAt, player.id);
    }
    broadcast('admin', { type: 'level_started', username: player.username, levelId });
  }

  const question = svc.getQuestionForLevel(levelId);

  res.json({
    status: row.status,
    started_at: row.started_at,
    elapsed_seconds: svc.secondsBetween(row.started_at, svc.nowIso()),
    question: question
      ? { id: question.id, title: question.title, description: question.description, code: question.code, language: question.language }
      : null
  });
});

/* POST /api/players/:id/levels/:levelId/submit  { answer } */
router.post('/players/:id/levels/:levelId/submit', (req, res) => {
  const player = svc.getPlayerById(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found.' });

  const competition = svc.getCompetition();
  if (competition.status === 'PAUSED') {
    return res.status(423).json({ error: 'COMPETITION PAUSED. Please wait for the administrator.', competition_status: 'PAUSED' });
  }
  if (competition.status !== 'RUNNING') {
    return res.status(423).json({ error: 'Competition is not currently running.', competition_status: competition.status });
  }

  const levelId = Number(req.params.levelId);
  const row = db.prepare('SELECT * FROM player_levels WHERE player_id = ? AND level_id = ?').get(player.id, levelId);

  if (!row || row.status === 'LOCKED') {
    return res.status(403).json({ error: 'This level is locked.' });
  }
  if (row.status === 'AVAILABLE') {
    return res.status(400).json({ error: 'Start the level before submitting an answer.' });
  }
  if (row.status === 'COMPLETED') {
    return res.status(400).json({ error: 'This level is already completed.' });
  }

  const question = svc.getQuestionForLevel(levelId);
  if (!question) return res.status(500).json({ error: 'No question configured for this level.' });

  const submitted = req.body && req.body.answer;
  const correct = isAnswerCorrect(submitted, question.correct_answer, !!question.case_sensitive);

  db.prepare(
    `INSERT INTO attempts (player_id, level_id, question_id, submitted_answer, is_correct) VALUES (?, ?, ?, ?, ?)`
  ).run(player.id, levelId, question.id, String(submitted ?? ''), correct ? 1 : 0);

  if (!correct) {
    return res.json({ correct: false });
  }

  const completedAt = svc.nowIso();
  const elapsed = svc.secondsBetween(row.started_at, completedAt);

  db.prepare(
    `UPDATE player_levels SET status = 'COMPLETED', completed_at = ?, elapsed_seconds = ? WHERE id = ?`
  ).run(completedAt, elapsed, row.id);

  // Unlock the next level (if any) so the dashboard reflects it immediately.
  const levels = svc.getActiveLevels();
  const idx = levels.findIndex((l) => l.id === levelId);
  const nextLevel = levels[idx + 1];
  if (nextLevel) {
    svc.ensurePlayerLevel(player.id, nextLevel.id, 'AVAILABLE');
  }

  let competitionCompleted = false;
  let totalTimeSeconds = null;

  if (!nextLevel) {
    // That was the final level.
    const sumRow = db
      .prepare(`SELECT COALESCE(SUM(elapsed_seconds),0) AS s FROM player_levels WHERE player_id = ? AND status = 'COMPLETED'`)
      .get(player.id);
    totalTimeSeconds = sumRow.s;
    db.prepare(
      `UPDATE players SET status = 'COMPLETED', competition_completed_at = ?, total_time_seconds = ? WHERE id = ?`
    ).run(completedAt, totalTimeSeconds, player.id);
    competitionCompleted = true;
  }

  broadcast('leaderboard', svc.computeLeaderboard());
  broadcast('admin', {
    type: competitionCompleted ? 'player_finished' : 'level_completed',
    username: player.username,
    levelId
  });

  const completedCount = db
    .prepare(`SELECT COUNT(*) AS c FROM player_levels WHERE player_id = ? AND status = 'COMPLETED'`)
    .get(player.id).c;

  res.json({
    correct: true,
    elapsed_seconds: elapsed,
    next_level_id: nextLevel ? nextLevel.id : null,
    competition_completed: competitionCompleted,
    total_time_seconds: totalTimeSeconds,
    levels_completed: completedCount,
    total_levels: levels.length
  });
});

module.exports = router;
