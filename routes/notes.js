const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../lib/db');

const ATTACHMENTS_DIR = path.join(__dirname, '..', 'data', 'attachments');
const ATTACHMENTS_DIR_REAL = fs.realpathSync(ATTACHMENTS_DIR);

// File extensions that should not be served back as content even if they
// somehow get uploaded — they'd render in-browser with executable MIME types.
const DISALLOWED_EXTS = new Set(['.html', '.htm', '.js', '.mjs', '.svg', '.xhtml', '.xml']);

// Multer config — unique filenames, allowlist extensions
const storage = multer.diskStorage({
  destination: ATTACHMENTS_DIR,
  filename: (_req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    cb(null, unique + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    if (DISALLOWED_EXTS.has(ext)) {
      return cb(new Error('File type not allowed (executable content)'));
    }
    cb(null, true);
  }
});

// Serve attachments (auth required — mounted under /admin/api).
// SECURITY: confine the resolved path inside ATTACHMENTS_DIR so a crafted
// filename like "../../lib/db.js" cannot escape into the source tree.
// Also force Content-Disposition: attachment so any leaked .html / .svg never
// renders in-browser with its native MIME type.
router.get('/attachments/:filename', (req, res) => {
  try {
    const requested = req.params.filename;
    // Reject anything containing path separators or null bytes outright.
    if (/[\/\\\0]/.test(requested) || requested === '..' || requested === '.') {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(ATTACHMENTS_DIR, requested);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(ATTACHMENTS_DIR_REAL + path.sep)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', 'attachment');
    res.sendFile(resolved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get notes for a customer (newest first)
router.get('/customers/:id/notes', (req, res) => {
  try {
    const notes = db.prepare(
      'SELECT id, text, attachment_file, attachment_name, created_at FROM customer_notes WHERE customer_id = ? ORDER BY created_at DESC, id DESC'
    ).all(req.params.id);
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unified activity timeline: customer_notes + the call ledger (call_log — recordings/transcripts/
// coaching/outcome) merged into ONE chronological stream. The call ledger was previously invisible on
// the customer card (only the global Phone tab showed it). Auto-generated call-mirror notes are excluded
// so a single call isn't shown 2-3 times — the call_log row is the single source for calls.
router.get('/customers/:id/activity', (req, res) => {
  try {
    const id = req.params.id;
    const cust = db.prepare('SELECT email FROM customers WHERE id = ?').get(id);
    const email = cust && cust.email ? cust.email : null;
    const notes = db.prepare(
      `SELECT id, text, attachment_file, attachment_name, created_at FROM customer_notes
        WHERE customer_id = ?
          AND text NOT LIKE 'Outbound call placed to%'
          AND text NOT LIKE 'Created automatically from an inbound%'`
    ).all(id);
    const calls = db.prepare(
      `SELECT id, call_sid, direction, status, duration_sec, voicemail_transcript, outcome,
              recording_path, coaching, coach_status, started_at
         FROM call_log WHERE contact_table = 'customers' AND contact_id = ?`
    ).all(id);
    // Email streams key by the client's EMAIL (no customer_id on these tables).
    // email_sends: client-facing roles ONLY (owner/employee BCC copies go to one internal address).
    // inbox_events: inbound/replies/soft-bounces. bounce_hard EXCLUDED — inbox-tick.js already writes
    //   a customer_notes row for hard bounces (already in this stream → would double-count).
    let outboundMail = [], inboundMail = [];
    if (email) {
      outboundMail = db.prepare(
        `SELECT id, scope_type, recipient_role, recipient_email, sent_at
           FROM email_sends
          WHERE recipient_email = ? COLLATE NOCASE
            AND recipient_role IN ('customer','client','prospect')`
      ).all(email);
      inboundMail = db.prepare(
        `SELECT id, from_email, subject, snippet, classification, received_at, created_at
           FROM inbox_events
          WHERE from_email = ? COLLATE NOCASE
            AND classification IN ('inbound','human_reply','auto_reply','bounce_soft')`
      ).all(email);
    }
    const items = [];
    for (const n of notes) items.push({ kind: 'note', ts: n.created_at, id: n.id, text: n.text,
      attachment_file: n.attachment_file, attachment_name: n.attachment_name });
    for (const c of calls) {
      let coachSummary = '';
      try { const co = JSON.parse(c.coaching || 'null'); if (co && co.summary) coachSummary = String(co.summary); } catch (_) {}
      items.push({ kind: 'call', ts: c.started_at, id: c.id, call_sid: c.call_sid,
        direction: c.direction, status: c.status, duration_sec: c.duration_sec, outcome: c.outcome,
        voicemail_transcript: c.voicemail_transcript, coach_summary: coachSummary,
        has_recording: !!c.recording_path,
        has_transcript: c.coach_status === 'coached' || c.coach_status === 'summarized' });
    }
    for (const e of outboundMail) {
      const label = e.scope_type === 'appt' ? 'Appointment confirmation'
        : (e.scope_type === 'checkin' || e.scope_type === 'prospect_checkin_2026_05_28') ? 'Check-in email'
        : e.scope_type === 'batch' ? 'Batch email' : 'Confirmation email';
      items.push({ kind: 'email_out', ts: e.sent_at, id: e.id, label, to: e.recipient_email });
    }
    for (const m of inboundMail) {
      items.push({ kind: 'email_in', ts: m.received_at || m.created_at, id: m.id,
        classification: m.classification, subject: m.subject, snippet: m.snippet, from: m.from_email });
    }
    // inbox_events.received_at is ISO-Z; notes/call_log/email_sends are SQLite 'YYYY-MM-DD HH:MM:SS'.
    // localeCompare mis-orders mixed formats; Date.parse normalizes both (V8 parses the space form).
    items.sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));   // newest first
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a note (with optional attachment)
router.post('/customers/:id/notes', upload.single('attachment'), (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    const file = req.file;

    if (!text && !file) return res.status(400).json({ error: 'Note text or attachment is required' });

    const result = db.prepare(
      'INSERT INTO customer_notes (customer_id, text, attachment_file, attachment_name) VALUES (?, ?, ?, ?)'
    ).run(
      req.params.id,
      text || null,
      file ? file.filename : null,
      file ? file.originalname : null
    );
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a note (also delete attachment file)
router.delete('/notes/:id', (req, res) => {
  try {
    const note = db.prepare('SELECT attachment_file FROM customer_notes WHERE id = ?').get(req.params.id);
    if (note && note.attachment_file) {
      const filePath = path.join(ATTACHMENTS_DIR, note.attachment_file);
      try { fs.unlinkSync(filePath); } catch (e) { /* file may already be gone */ }
    }
    db.prepare('DELETE FROM customer_notes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
