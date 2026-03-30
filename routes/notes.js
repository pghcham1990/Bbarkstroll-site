const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../lib/db');

const ATTACHMENTS_DIR = path.join(__dirname, '..', 'data', 'attachments');

// Multer config — unique filenames, preserve extension
const storage = multer.diskStorage({
  destination: ATTACHMENTS_DIR,
  filename: (_req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Serve attachments (auth required — mounted under /admin/api)
router.get('/attachments/:filename', (req, res) => {
  const filePath = path.join(ATTACHMENTS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

// Get notes for a customer (newest first)
router.get('/customers/:id/notes', (req, res) => {
  const notes = db.prepare(
    'SELECT id, text, attachment_file, attachment_name, created_at FROM customer_notes WHERE customer_id = ? ORDER BY created_at DESC, id DESC'
  ).all(req.params.id);
  res.json(notes);
});

// Add a note (with optional attachment)
router.post('/customers/:id/notes', upload.single('attachment'), (req, res) => {
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
});

// Delete a note (also delete attachment file)
router.delete('/notes/:id', (req, res) => {
  const note = db.prepare('SELECT attachment_file FROM customer_notes WHERE id = ?').get(req.params.id);
  if (note && note.attachment_file) {
    const filePath = path.join(ATTACHMENTS_DIR, note.attachment_file);
    try { fs.unlinkSync(filePath); } catch (e) { /* file may already be gone */ }
  }
  db.prepare('DELETE FROM customer_notes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
