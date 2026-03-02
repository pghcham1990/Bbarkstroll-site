const express = require('express');
const router = express.Router();
const { authenticate } = require('../lib/auth');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  const user = authenticate(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.user = user;
  res.json({ ok: true, user });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ user: req.session.user });
  res.status(401).json({ error: 'Not authenticated' });
});

module.exports = router;
