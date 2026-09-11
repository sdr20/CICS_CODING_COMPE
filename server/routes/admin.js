const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../database');
const svc = require('../services/competitionService');
const sse = require('../services/sse');
const { ADMIN_PASSWORD } = require('../config');

/* ------------------------------------------------------------------ *
 *  Very lightweight admin auth. This is a LAN competition tool, not a
 *  public service - a single shared password + in-memory bearer token
 *  is enough to keep random players on the network out of /admin.
 * ------------------------------------------------------------------ */
const validTokens = new Set();

router.post('/admin/login', (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  validTokens.add(token);
  res.json({ token });
});

function requireAdmin(req, res, next) {
  // EventSource (used for the live admin stream) can't set custom headers,
  // so that one route is also allowed to authenticate via a query string token.
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !validTokens.has(token)) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }
  next();
}

router.use('/admin', (req, res, next) => {
  if (req.path === '/login') return next();
  return requireAdmin(req, res, next);
});

/* ------------------------------------------------------------------ *
 *  Overview / statistics / monitoring
 * ------------------------------------------------------------------ */

router.get('/admin/state', (req, res) => {
  const competition = svc.getCompetition();
  const totalPlayers = db.prepare('SELECT COUNT(*) AS c FROM players').get().c;
  const totalLevels = svc.getActiveLevels().length;
  const completedPlayers = db.prepare(`SELECT COUNT(*) AS c FROM players WHERE status = 'COMPLETED'`).get().c;
  const activePlayers = db.prepare(`SELECT COUNT(*) AS c FROM players WHERE status = 'ACTIVE'`).get().c;

  res.json({ competition, players: totalPlayers, levels: totalLevels, completed: completedPlayers, active: activePlayers });
});

router.get('/admin/statistics', (req, res) => {
  res.json(svc.computeStatistics());
});

router.get('/admin/players', (req, res) => {
  const players = db.prepare('SELECT * FROM players ORDER BY id ASC').all();
  const rows = players.map((p) => {
    const current = db
      .prepare(
        `SELECT l.level_number, pl.started_at FROM player_levels pl
         JOIN levels l ON l.id = pl.level_id
         WHERE pl.player_id = ? AND pl.status = 'IN_PROGRESS' LIMIT 1`
      )
      .get(p.id);

    const completedCount = db
      .prepare(`SELECT COUNT(*) AS c FROM player_levels WHERE player_id = ? AND status = 'COMPLETED'`)
      .get(p.id).c;

    return {
      id: p.id,
      username: p.username,
      status: p.status,
      current_level: current ? current.level_number : null,
      current_level_elapsed_seconds: current ? svc.secondsBetween(current.started_at, svc.nowIso()) : null,
      completed_levels: completedCount,
      total_time_seconds: p.total_time_seconds
    };
  });
  res.json({ players: rows });
});

router.get('/admin/leaderboard', (req, res) => {
  res.json({ leaderboard: svc.computeLeaderboard() });
});

/* Live admin event stream (player joins, level completions, etc.) */
router.get('/admin/stream', (req, res) => {
  sse.subscribe('admin', res);
});

/* ------------------------------------------------------------------ *
 *  Level management
 * ------------------------------------------------------------------ */

router.get('/admin/levels', (req, res) => {
  const levels = db.prepare('SELECT * FROM levels ORDER BY sort_order ASC, level_number ASC').all();
  res.json({ levels });
});

router.post('/admin/levels', (req, res) => {
  const { level_number, title, description } = req.body || {};
  if (!level_number || !title) {
    return res.status(400).json({ error: 'level_number and title are required.' });
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM levels').get().m;
  try {
    const info = db
      .prepare('INSERT INTO levels (level_number, title, description, sort_order) VALUES (?, ?, ?, ?)')
      .run(level_number, title, description || '', maxOrder + 1);
    const level = db.prepare('SELECT * FROM levels WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ level });
  } catch (e) {
    res.status(409).json({ error: 'A level with that number already exists.' });
  }
});

router.put('/admin/levels/:id', (req, res) => {
  const level = db.prepare('SELECT * FROM levels WHERE id = ?').get(req.params.id);
  if (!level) return res.status(404).json({ error: 'Level not found.' });

  const { title, description, sort_order, is_active } = req.body || {};
  db.prepare(
    `UPDATE levels SET title = ?, description = ?, sort_order = ?, is_active = ? WHERE id = ?`
  ).run(
    title ?? level.title,
    description ?? level.description,
    sort_order ?? level.sort_order,
    is_active === undefined ? level.is_active : (is_active ? 1 : 0),
    level.id
  );
  res.json({ level: db.prepare('SELECT * FROM levels WHERE id = ?').get(level.id) });
});

router.delete('/admin/levels/:id', (req, res) => {
  const level = db.prepare('SELECT * FROM levels WHERE id = ?').get(req.params.id);
  if (!level) return res.status(404).json({ error: 'Level not found.' });
  db.prepare('DELETE FROM levels WHERE id = ?').run(level.id);
  res.json({ success: true });
});

/* ------------------------------------------------------------------ *
 *  Question management
 * ------------------------------------------------------------------ */

router.get('/admin/levels/:id/questions', (req, res) => {
  const questions = db.prepare('SELECT * FROM questions WHERE level_id = ? ORDER BY id ASC').all(req.params.id);
  res.json({ questions });
});

router.post('/admin/questions', (req, res) => {
  const { level_id, title, description, code, language, correct_answer, case_sensitive } = req.body || {};
  if (!level_id || !title || !correct_answer) {
    return res.status(400).json({ error: 'level_id, title and correct_answer are required.' });
  }
  const level = db.prepare('SELECT * FROM levels WHERE id = ?').get(level_id);
  if (!level) return res.status(404).json({ error: 'Level not found.' });

  const info = db
    .prepare(
      `INSERT INTO questions (level_id, title, description, code, language, correct_answer, case_sensitive)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(level_id, title, description || '', code || '', language || 'C++', String(correct_answer), case_sensitive ? 1 : 0);

  res.status(201).json({ question: db.prepare('SELECT * FROM questions WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/admin/questions/:id', (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found.' });

  const { title, description, code, language, correct_answer, case_sensitive } = req.body || {};
  db.prepare(
    `UPDATE questions SET title = ?, description = ?, code = ?, language = ?, correct_answer = ?, case_sensitive = ? WHERE id = ?`
  ).run(
    title ?? q.title,
    description ?? q.description,
    code ?? q.code,
    language ?? q.language,
    correct_answer !== undefined ? String(correct_answer) : q.correct_answer,
    case_sensitive === undefined ? q.case_sensitive : (case_sensitive ? 1 : 0),
    q.id
  );
  res.json({ question: db.prepare('SELECT * FROM questions WHERE id = ?').get(q.id) });
});

router.delete('/admin/questions/:id', (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
  res.json({ success: true });
});

/* ------------------------------------------------------------------ *
 *  Competition state controls
 * ------------------------------------------------------------------ */

function setStatus(status, extraSql) {
  db.prepare(`UPDATE competition SET status = ? ${extraSql || ''} WHERE id = 1`).run(status);
  const competition = svc.getCompetition();
  sse.broadcast('admin', { type: 'competition_status', status });
  sse.broadcast('leaderboard', svc.computeLeaderboard());
  return competition;
}

router.post('/admin/competition/start', (req, res) => {
  const competition = svc.getCompetition();
  if (competition.status === 'RUNNING') return res.status(400).json({ error: 'Competition is already running.' });
  db.prepare(`UPDATE competition SET status = 'RUNNING', started_at = COALESCE(started_at, datetime('now')) WHERE id = 1`).run();
  sse.broadcast('admin', { type: 'competition_status', status: 'RUNNING' });
  sse.broadcast('leaderboard', svc.computeLeaderboard());
  res.json({ competition: svc.getCompetition() });
});

router.post('/admin/competition/pause', (req, res) => {
  db.prepare(`UPDATE competition SET status = 'PAUSED', paused_at = datetime('now') WHERE id = 1`).run();
  sse.broadcast('admin', { type: 'competition_status', status: 'PAUSED' });
  res.json({ competition: svc.getCompetition() });
});

router.post('/admin/competition/resume', (req, res) => {
  db.prepare(`UPDATE competition SET status = 'RUNNING', paused_at = NULL WHERE id = 1`).run();
  sse.broadcast('admin', { type: 'competition_status', status: 'RUNNING' });
  res.json({ competition: svc.getCompetition() });
});

router.post('/admin/competition/end', (req, res) => {
  db.prepare(`UPDATE competition SET status = 'ENDED', ended_at = datetime('now') WHERE id = 1`).run();
  sse.broadcast('admin', { type: 'competition_status', status: 'ENDED' });
  res.json({ competition: svc.getCompetition() });
});

router.post('/admin/competition/reset', (req, res) => {
  const resetAll = db.transaction(() => {
    db.prepare('DELETE FROM attempts').run();
    db.prepare('DELETE FROM player_levels').run();
    db.prepare('DELETE FROM players').run();
    db.prepare(
      `UPDATE competition SET status = 'NOT_STARTED', started_at = NULL, paused_at = NULL, ended_at = NULL WHERE id = 1`
    ).run();
  });
  resetAll();
  sse.broadcast('admin', { type: 'competition_reset' });
  sse.broadcast('leaderboard', []);
  res.json({ success: true, competition: svc.getCompetition() });
});

module.exports = router;
