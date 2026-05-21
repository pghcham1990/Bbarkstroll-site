const express = require('express');
const router = express.Router();
const db = require('../lib/db');

router.get('/applicants', (req, res) => {
  const rows = db.prepare(`
    SELECT id, created_at, full_name, preferred_name, email, phone, zip, closest_area,
           hours_hoping, status, scott_notes, bgcheck_sent_at, rejected_at
    FROM applicants
    ORDER BY
      CASE status WHEN 'lead' THEN 0 WHEN 'new' THEN 1 WHEN 'reviewed' THEN 2 WHEN 'finalist' THEN 3
                  WHEN 'bgcheck_sent' THEN 4 WHEN 'agreement_sent' THEN 5 WHEN 'hired' THEN 6 WHEN 'rejected' THEN 7 END,
      created_at DESC
  `).all();
  res.json({ applicants: rows });
});

router.post('/applicants/lead', (req, res) => {
  const { full_name, email, phone, scott_notes } = req.body || {};
  if (!full_name || !String(full_name).trim()) return res.status(400).json({ error: 'Name required' });
  if (!email || !String(email).trim()) return res.status(400).json({ error: 'Email required' });

  const cleanEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id, status FROM applicants WHERE LOWER(email) = ?').get(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'Applicant with this email already exists (id ' + existing.id + ', status ' + existing.status + ')' });
  }

  // Lead stubs use empty strings for the NOT NULL form fields. The public submit
  // endpoint upserts by email and fills them in when the applicant fills out /join.
  const attestSnapshot = JSON.stringify({ source: 'manual_lead', added_at: new Date().toISOString() });
  const result = db.prepare(`
    INSERT INTO applicants (
      full_name, email, phone, zip,
      is_18_plus, has_transport, closest_area,
      days_available, time_windows, hours_hoping,
      owned_dogs, sizes_ok,
      why_interested, tricky_situation,
      attestations, status, scott_notes
    ) VALUES (?, ?, ?, '', 0, 0, '', '[]', '[]', '', 0, '[]', '', '', ?, 'lead', ?)
  `).run(
    String(full_name).trim(),
    cleanEmail,
    phone ? String(phone).trim() : '',
    attestSnapshot,
    scott_notes ? String(scott_notes) : null
  );

  const row = db.prepare('SELECT * FROM applicants WHERE id = ?').get(result.lastInsertRowid);
  res.json({ applicant: row });
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
  const allowedStatuses = ['lead','new','reviewed','finalist','bgcheck_sent','agreement_sent','hired','rejected'];
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

router.post('/applicants/:id/send-checkr-headsup', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const row = db.prepare('SELECT * FROM applicants WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'bgcheck_sent') return res.status(409).json({ error: 'Heads-up only valid while status is bgcheck_sent (current: ' + row.status + ')' });
  if (row.checkr_heads_up_sent_at) return res.status(409).json({ error: 'Heads-up already sent at ' + row.checkr_heads_up_sent_at });

  try {
    const { sendApplicantCheckrHeadsUp } = require('../lib/email');
    await sendApplicantCheckrHeadsUp(row);
    db.prepare("UPDATE applicants SET checkr_heads_up_sent_at = datetime('now') WHERE id = ?").run(id);
    const updated = db.prepare('SELECT * FROM applicants WHERE id = ?').get(id);
    res.json({ applicant: updated });
  } catch (err) {
    console.error('[checkr-headsup-send] failed:', err.message);
    res.status(500).json({ error: 'Email send failed: ' + err.message });
  }
});

router.post('/applicants/:id/send-agreement', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const row = db.prepare('SELECT * FROM applicants WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  try {
    const { sendApplicantContractorAgreement } = require('../lib/email');
    await sendApplicantContractorAgreement(row);
    db.prepare("UPDATE applicants SET status = 'agreement_sent' WHERE id = ?").run(id);
    const updated = db.prepare('SELECT * FROM applicants WHERE id = ?').get(id);
    res.json({ applicant: updated });
  } catch (err) {
    console.error('[agreement-send] failed:', err.message);
    res.status(500).json({ error: 'Email send failed: ' + err.message });
  }
});

module.exports = router;
