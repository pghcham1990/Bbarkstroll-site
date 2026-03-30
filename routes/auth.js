const express = require('express');
const router = express.Router();
const { authenticate } = require('../lib/auth');

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
    const user = authenticate(username, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.user = user;
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  try {
    req.session.destroy();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', (req, res) => {
  try {
    if (req.session && req.session.user) return res.json({ user: req.session.user });
    res.status(401).json({ error: 'Not authenticated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
