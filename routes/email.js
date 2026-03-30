const express = require('express');
const router = express.Router();

const MAILER_URL = process.env.BPD_MAILER_URL;
const MAILER_KEY = process.env.BPD_MAILER_API_KEY;

async function mailerFetch(path, opts = {}) {
  const res = await fetch(MAILER_URL + path, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': MAILER_KEY,
      ...opts.headers
    },
    ...opts
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Mailer service error');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Send email
router.post('/email/send', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body are required' });
    }
    const sent_by = req.session.user.display_name || req.session.user.username;
    const result = await mailerFetch('/api/send', {
      method: 'POST',
      body: JSON.stringify({ to, subject, body, sent_by })
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// AI draft
router.post('/email/draft', async (req, res) => {
  try {
    const { prompt, context } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    const result = await mailerFetch('/api/draft', {
      method: 'POST',
      body: JSON.stringify({ prompt, context })
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Bulk send email to multiple recipients
router.post('/email/bulk', async (req, res) => {
  try {
    const { emails, subject, body } = req.body;
    if (!emails || !emails.length || !subject || !body) {
      return res.status(400).json({ error: 'emails array, subject, and body are required' });
    }
    const sent_by = req.session.user.display_name || req.session.user.username;
    let sent = 0, failed = 0;
    for (const to of emails) {
      try {
        await mailerFetch('/api/send', {
          method: 'POST',
          body: JSON.stringify({ to, subject, body, sent_by })
        });
        sent++;
      } catch { failed++; }
    }
    res.json({ ok: true, sent, failed, total: emails.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Email log for a recipient
router.get('/email/log/:email', async (req, res) => {
  try {
    const result = await mailerFetch('/api/log/' + encodeURIComponent(req.params.email));
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Get inbox (received emails)
router.get('/email/inbox', async (req, res) => {
  try {
    const result = await mailerFetch('/api/inbox?limit=' + (req.query.limit || 50) + '&offset=' + (req.query.offset || 0));
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Get conversation thread with a contact
router.get('/email/threads/:email', async (req, res) => {
  try {
    const result = await mailerFetch('/api/threads/' + encodeURIComponent(req.params.email));
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Get contacts list
router.get('/email/contacts', async (req, res) => {
  try {
    const result = await mailerFetch('/api/contacts');
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Manual inbox refresh
router.post('/email/refresh', async (req, res) => {
  try {
    const result = await mailerFetch('/api/inbox/refresh', { method: 'POST' });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Reply in thread (send with in_reply_to for threading)
router.post('/email/reply', async (req, res) => {
  try {
    const { to, subject, body, in_reply_to } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body are required' });
    }
    const sent_by = req.session.user.display_name || req.session.user.username;
    const result = await mailerFetch('/api/send', {
      method: 'POST',
      body: JSON.stringify({ to, subject, body, sent_by, in_reply_to })
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
