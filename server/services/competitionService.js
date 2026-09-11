const db = require('../database');

/* ---------------------------------------------------------------- *
 *  Small helpers
 * ---------------------------------------------------------------- */

function nowIso() {
  return new Date().toISOString();
}

function secondsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso.replace(' ', 'T') + (startIso.endsWith('Z') ? '' : 'Z'));
  const end = new Date(endIso.replace(' ', 'T') + (endIso.endsWith('Z') ? '' : 'Z'));
  const diff = Math.round((end.getTime() - start.getTime()) / 1000);
  return diff >= 0 ? diff : 0;
}

function getCompetition() {
  return db.prepare('SELECT * FROM competition WHERE id = 1').get();
}

function isCompetitionRunning() {
  return getCompetition().status === 'RUNNING';
}

/* ---------------------------------------------------------------- *
 *  Levels
 * ---------------------------------------------------------------- */

function getActiveLevels() {
  return db
    .prepare('SELECT * FROM levels WHERE is_active = 1 ORDER BY sort_order ASC, level_number ASC')
    .all();
}

function getQuestionForLevel(levelId) {
  // Support multiple questions per level in the schema; v1 uses one per level (first created).
  return db
    .prepare('SELECT * FROM questions WHERE level_id = ? ORDER BY id ASC LIMIT 1')
    .get(levelId);
}

/* ---------------------------------------------------------------- *
 *  Player progress / unlocking
 * ---------------------------------------------------------------- */

// Ensures a player_levels row exists for a given player+level with the given status,
// but never downgrades an existing more-advanced status.
function ensurePlayerLevel(playerId, levelId, status) {
  const existing = db
    .prepare('SELECT * FROM player_levels WHERE player_id = ? AND level_id = ?')
    .get(playerId, levelId);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO player_levels (player_id, level_id, status) VALUES (?, ?, ?)`
  ).run(playerId, levelId, status);
  return db.prepare('SELECT * FROM player_levels WHERE player_id = ? AND level_id = ?').get(playerId, levelId);
}

// Builds the full per-level status list for one player, unlocking Level 1 lazily on first read.
function getPlayerLevelStates(playerId) {
  const levels = getActiveLevels();
  const rows = db.prepare('SELECT * FROM player_levels WHERE player_id = ?').all(playerId);
  const byLevel = new Map(rows.map((r) => [r.level_id, r]));

  const states = [];
  let previousCompleted = true; // Level 1 is always unlockable.

  for (const level of levels) {
    let pl = byLevel.get(level.id);

    if (!pl && previousCompleted) {
      pl = ensurePlayerLevel(playerId, level.id, 'AVAILABLE');
    }

    const status = pl ? pl.status : 'LOCKED';
    states.push({
      level_id: level.id,
      level_number: level.level_number,
      title: level.title,
      description: level.description,
      status,
      started_at: pl ? pl.started_at : null,
      completed_at: pl ? pl.completed_at : null,
      elapsed_seconds: pl ? pl.elapsed_seconds : null
    });

    previousCompleted = status === 'COMPLETED';
  }

  return states;
}

function getPlayerById(playerId) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
}

/* ---------------------------------------------------------------- *
 *  Ranking / leaderboard
 * ---------------------------------------------------------------- */

function computeLeaderboard() {
  const players = db.prepare('SELECT * FROM players ORDER BY id ASC').all();

  const rows = players.map((p) => {
    const completedLevels = db
      .prepare(`SELECT COUNT(*) AS c FROM player_levels WHERE player_id = ? AND status = 'COMPLETED'`)
      .get(p.id).c;

    const timeSum = db
      .prepare(
        `SELECT COALESCE(SUM(elapsed_seconds), 0) AS s FROM player_levels
         WHERE player_id = ? AND status = 'COMPLETED'`
      )
      .get(p.id).s;

    const lastCompletion = db
      .prepare(
        `SELECT completed_at FROM player_levels
         WHERE player_id = ? AND status = 'COMPLETED'
         ORDER BY completed_at DESC LIMIT 1`
      )
      .get(p.id);

    const current = db
      .prepare(
        `SELECT l.level_number, l.title, pl.started_at FROM player_levels pl
         JOIN levels l ON l.id = pl.level_id
         WHERE pl.player_id = ? AND pl.status = 'IN_PROGRESS'
         LIMIT 1`
      )
      .get(p.id);

    return {
      player_id: p.id,
      username: p.username,
      status: p.status,
      completed_levels: completedLevels,
      total_time_seconds: timeSum,
      last_completion_at: lastCompletion ? lastCompletion.completed_at : null,
      current_level: current ? current.level_number : null,
      current_level_title: current ? current.title : null
    };
  });

  // Tie-break: (1) more completed levels, (2) lower total time, (3) earlier final completion.
  rows.sort((a, b) => {
    if (b.completed_levels !== a.completed_levels) return b.completed_levels - a.completed_levels;
    if (a.total_time_seconds !== b.total_time_seconds) return a.total_time_seconds - b.total_time_seconds;
    const at = a.last_completion_at ? new Date(a.last_completion_at).getTime() : Infinity;
    const bt = b.last_completion_at ? new Date(b.last_completion_at).getTime() : Infinity;
    return at - bt;
  });

  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/* ---------------------------------------------------------------- *
 *  Statistics
 * ---------------------------------------------------------------- */

function computeStatistics() {
  const totalLevels = getActiveLevels().length;
  const totalPlayers = db.prepare('SELECT COUNT(*) AS c FROM players').get().c;
  const completedPlayers = db
    .prepare(`SELECT COUNT(*) AS c FROM players WHERE status = 'COMPLETED'`)
    .get().c;
  const activePlayers = db
    .prepare(`SELECT COUNT(*) AS c FROM players WHERE status = 'ACTIVE'`)
    .get().c;

  const avgRow = db
    .prepare(`SELECT AVG(total_time_seconds) AS avg FROM players WHERE status = 'COMPLETED'`)
    .get();
  const averageCompletionSeconds = avgRow.avg ? Math.round(avgRow.avg) : null;

  const fastest = db
    .prepare(
      `SELECT username, total_time_seconds FROM players
       WHERE status = 'COMPLETED'
       ORDER BY total_time_seconds ASC LIMIT 1`
    )
    .get();

  return {
    total_levels: totalLevels,
    total_players: totalPlayers,
    active_players: activePlayers,
    completed_players: completedPlayers,
    average_completion_seconds: averageCompletionSeconds,
    fastest_player: fastest ? fastest.username : null,
    fastest_time_seconds: fastest ? fastest.total_time_seconds : null
  };
}

module.exports = {
  nowIso,
  secondsBetween,
  getCompetition,
  isCompetitionRunning,
  getActiveLevels,
  getQuestionForLevel,
  ensurePlayerLevel,
  getPlayerLevelStates,
  getPlayerById,
  computeLeaderboard,
  computeStatistics
};
