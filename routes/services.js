const express = require('express');
const router = express.Router();
const db = require('../lib/db');

router.get('/services', (_req, res) => {
  const rows = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY name').all();
  res.json(rows);
});

module.exports = router;
