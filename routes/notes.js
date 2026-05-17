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
