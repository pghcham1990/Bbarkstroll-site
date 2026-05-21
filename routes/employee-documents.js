const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../lib/db');
const { encryptBuffer, decryptBuffer } = require('../lib/doc-crypto');

const DOCS_DIR = process.env.SECURE_DOCS_DIR || '/opt/barkstroll/data/secure-docs';
fs.mkdirSync(DOCS_DIR, { recursive: true, mode: 0o700 });

const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

function actorOf(req) {
  return req.session && req.session.user ? req.session.user.username : null;
}

function logAccess(documentId, action, actor) {
  db.prepare('INSERT INTO employee_document_access (document_id, action, actor) VALUES (?, ?, ?)')
    .run(documentId, action, actor || null);
}

// List a walker's documents (metadata only)
router.get('/employees/:id/documents', (req, res) => {
  const rows = db.prepare(
    'SELECT id, doc_type, original_name, mime_type, byte_size, uploaded_at, uploaded_by FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC'
  ).all(req.params.id);
  res.json(rows);
});

// Upload a W-9 (doc_type forced to 'w9')
router.post('/employees/:id/documents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file, or file type not allowed (PDF, JPG, PNG only)' });
  const emp = db.prepare('SELECT id FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Walker not found' });

  const enc = encryptBuffer(req.file.buffer);
  const storedFile = crypto.randomUUID() + '.enc';
  fs.writeFileSync(path.join(DOCS_DIR, storedFile), enc.ciphertext, { mode: 0o600 });

  const actor = actorOf(req);
  const result = db.prepare(
    `INSERT INTO employee_documents (employee_id, doc_type, original_name, mime_type, byte_size, stored_file, iv_hex, tag_hex, uploaded_by)
     VALUES (?, 'w9', ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.params.id, req.file.originalname, req.file.mimetype, req.file.size, storedFile, enc.ivHex, enc.tagHex, actor);

  logAccess(result.lastInsertRowid, 'upload', actor);
  res.json({ ok: true, id: result.lastInsertRowid });
});

// View / download a document
router.get('/employees/:id/documents/:docId/file', (req, res) => {
  const doc = db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?')
    .get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  let plaintext;
  try {
    const blob = fs.readFileSync(path.join(DOCS_DIR, doc.stored_file));
    plaintext = decryptBuffer(blob, doc.iv_hex, doc.tag_hex);
  } catch (e) {
    return res.status(500).json({ error: 'Could not read document' });
  }

  const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
  logAccess(doc.id, disposition === 'attachment' ? 'download' : 'view', actorOf(req));

  const safeName = doc.original_name.replace(/"/g, '');
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', disposition + '; filename="' + safeName + '"');
  res.send(plaintext);
});

// Delete a document (blob + row)
router.delete('/employees/:id/documents/:docId', (req, res) => {
  const doc = db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?')
    .get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(path.join(DOCS_DIR, doc.stored_file)); } catch (e) { /* already gone */ }
  logAccess(doc.id, 'delete', actorOf(req));
  db.prepare('DELETE FROM employee_documents WHERE id = ?').run(doc.id);
  res.json({ ok: true });
});

module.exports = router;
