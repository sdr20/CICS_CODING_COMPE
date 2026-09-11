const express = require('express');
const router = express.Router();
const svc = require('../services/competitionService');
const sse = require('../services/sse');

/* GET /api/leaderboard -> one-off snapshot (used for first paint) */
router.get('/leaderboard', (req, res) => {
  res.json({ leaderboard: svc.computeLeaderboard(), competition: svc.getCompetition() });
});

/* GET /api/leaderboard/stream -> Server-Sent Events, pushes on every change */
router.get('/leaderboard/stream', (req, res) => {
  sse.subscribe('leaderboard', res);
  // Send an immediate snapshot so the client doesn't wait for the next change.
  res.write(`data: ${JSON.stringify(svc.computeLeaderboard())}\n\n`);
});

module.exports = router;
