const express = require('express');
const router = express.Router();
const db = require('../lib/db');

router.get('/applicants', (req, res) => {
  const rows = db.prepare(`
    SELECT id, created_at, full_name, preferred_name, email, phone, zip, closest_area,
           hours_hoping, status, scott_notes, bgcheck_sent_at, rejected_at
    FROM applicants
    ORDER BY
      CASE status WHEN 'new' THEN 0 WHEN 'reviewed' THEN 1 WHEN 'finalist' THEN 2
                  WHEN 'bgcheck_sent' THEN 3 WHEN 'hired' THEN 4 WHEN 'rejected' THEN 5 END,
      created_at DESC
  `).all();
  res.json({ applicants: rows });
});

router.get('/applicants/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const row = db.prepare('SELECT * FROM applicants WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ applicant: row });
});

router.patch('/applicants/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const allowedStatuses = ['new','reviewed','finalist','bgcheck_sent','hired','rejected'];
  const updates = [];
  const values = [];
  if (req.body.status !== undefined) {
    if (!allowedStatuses.includes(req.body.status)) return res.status(400).json({ error: 'Bad status' });
    updates.push('status = ?'); values.push(req.body.status);
    if (req.body.status === 'rejected') {
      updates.push("rejected_at = datetime('now')");
      updates.push("delete_after = datetime('now', '+1 year')");
    }
  }
  if (req.body.scott_notes !== undefined) {
    updates.push('scott_notes = ?'); values.push(req.body.scott_notes ? String(req.body.scott_notes) : null);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(id);
  db.prepare('UPDATE applicants SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
  const updated = db.prepare('SELECT * FROM applicants WHERE id = ?').get(id);
  res.json({ applicant: updated });
});

router.post('/applicants/:id/send-bgcheck', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const row = db.prepare('SELECT * FROM applicants WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  try {
    const { sendApplicantFinalistDisclosure } = require('../lib/email');
    await sendApplicantFinalistDisclosure(row);
    db.prepare("UPDATE applicants SET status = 'bgcheck_sent', bgcheck_sent_at = datetime('now') WHERE id = ?").run(id);
    const updated = db.prepare('SELECT * FROM applicants WHERE id = ?').get(id);
    res.json({ applicant: updated });
  } catch (err) {
    console.error('[bgcheck-send] failed:', err.message);
    res.status(500).json({ error: 'Email send failed: ' + err.message });
  }
});

module.exports = router;
