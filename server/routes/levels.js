const express = require('express');
const router = express.Router();
const svc = require('../services/competitionService');

/* GET /api/levels -> public list of active levels (no answers, no per-player state) */
router.get('/levels', (req, res) => {
  const levels = svc.getActiveLevels().map((l) => ({
    id: l.id,
    level_number: l.level_number,
    title: l.title,
    description: l.description
  }));
  res.json({ levels });
});

module.exports = router;
