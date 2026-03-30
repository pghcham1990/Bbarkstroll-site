const express = require('express');
const router = express.Router();
const { authenticate } = require('../lib/auth');
const db = require('../lib/db');

const GUARD_URL = process.env.GUARD_URL || 'http://127.0.0.1:8091';

async function guardFetch(path, body) {
  const r = await fetch(GUARD_URL + '/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

router.post('/login', async (req, res) => {
  try {
    const { username, password, challenge_id, code } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

    const ip = req.ip;
    const user_agent = req.headers['user-agent'];

    // --- Challenge verification flow ---
    if (challenge_id && code) {
      try {
        const vResult = await guardFetch('/verify', { challenge_id, code });
        if (vResult.status !== 'verified') {
          return res.status(401).json({ error: vResult.error || 'Invalid verification code' });
        }
      } catch (guardErr) {
        // Guard down during verify — deny (can't skip challenge once started)
        console.error('Guard verify error:', guardErr.message);
        return res.status(502).json({ error: 'Verification service unavailable. Try again.' });
      }

      // Code verified — now check password
      const user = authenticate(username, password);
      if (!user) {
        guardFetch('/login-failure', { app: 'barkstroll', user_id: username, ip }).catch(() => {});
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Success
      guardFetch('/login-success', { app: 'barkstroll', user_id: username, ip, user_agent }).catch(() => {});
      req.session.user = user;
      return res.json({ ok: true, user });
    }

    // --- Normal login flow ---
    // Look up user email for Guard
    let email = '';
    try {
      const row = db.prepare('SELECT email FROM users WHERE username = ?').get(username);
      if (row) email = row.email;
    } catch (e) { /* ignore */ }

    // Check with Guard
    try {
      const guardResult = await guardFetch('/check', {
        app: 'barkstroll',
        user_id: username,
        email: email || username + '@unknown',
        ip,
        user_agent
      });

      if (guardResult.status === 'locked') {
        const tierMsg = guardResult.tier === 3
          ? 'Account permanently locked. Contact support.'
          : `Account locked (Tier ${guardResult.tier}). Try again later.`;
        return res.status(423).json({ error: tierMsg, locked: true, tier: guardResult.tier, unlock_at: guardResult.unlock_at });
      }

      if (guardResult.status === 'challenge') {
        return res.json({ challenge: true, challenge_id: guardResult.challenge_id });
      }

      // status === 'allow' — proceed with normal password check below
    } catch (guardErr) {
      // Guard is down — fall back to normal login (don't break auth)
      console.error('Guard check error:', guardErr.message);
    }

    // Validate password
    const user = authenticate(username, password);
    if (!user) {
      guardFetch('/login-failure', { app: 'barkstroll', user_id: username, ip }).catch(() => {});
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Success
    guardFetch('/login-success', { app: 'barkstroll', user_id: username, ip, user_agent }).catch(() => {});
    req.session.user = user;
    res.json({ ok: true, user });
  } catch (err) {
    console.error('Login error:', err);
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
