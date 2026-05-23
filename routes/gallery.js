const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../lib/db');

const PUBLIC_IMG_DIR = '/var/www/barkstroll.com/gallery/img';
const MANIFEST_PATH = '/var/www/barkstroll.com/gallery/photos.json';
const MAX_WIDTH = 1600;
const THUMB_WIDTH = 600;
const WEBP_QUALITY = 85;

db.prepare(`
  CREATE TABLE IF NOT EXISTS gallery_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    thumb_filename TEXT NOT NULL,
    caption TEXT,
    dog_name TEXT,
    consent INTEGER NOT NULL DEFAULT 1,
    is_published INTEGER NOT NULL DEFAULT 1,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Optional link from a gallery photo to the client it belongs to.
try { db.prepare('ALTER TABLE gallery_photos ADD COLUMN customer_id INTEGER').run(); } catch (e) { /* already exists */ }

// Explicit display order. Lower = earlier in the gallery. New uploads get the
// next value (max+1) so they append to the END, preserving the curated order.
try { db.prepare('ALTER TABLE gallery_photos ADD COLUMN sort_order INTEGER').run(); } catch (e) { /* already exists */ }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WebP, or HEIC images are allowed'));
    }
    cb(null, true);
  }
});

function watermarkSvg(width, height) {
  const text = 'barkstroll.com';
  const fontSize = Math.max(14, Math.round(height * 0.025));
  const padX = Math.round(fontSize * 0.7);
  const padY = Math.round(fontSize * 0.45);
  const charW = fontSize * 0.55;
  const pillW = Math.round(text.length * charW + padX * 2);
  const pillH = Math.round(fontSize + padY * 2);
  const x = width - pillW - Math.round(fontSize * 0.8);
  const y = height - pillH - Math.round(fontSize * 0.8);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <g transform="translate(${x},${y})">
        <rect width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="rgba(13,68,40,0.55)"/>
        <text x="${pillW / 2}" y="${pillH / 2 + fontSize * 0.36}"
              font-family="Georgia, 'Times New Roman', serif"
              font-size="${fontSize}" font-weight="600"
              fill="rgba(196,164,78,0.95)" text-anchor="middle"
              letter-spacing="0.04em">${text}</text>
      </g>
    </svg>
  `);
}

async function processAndSave(buffer) {
  const id = crypto.randomBytes(6).toString('hex');
  const fullName = id + '.webp';
  const thumbName = id + '-thumb.webp';

  const meta = await sharp(buffer).metadata();
  const orientedBase = sharp(buffer).rotate();

  const resizedFull = await orientedBase
    .clone()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const fullW = resizedFull.info.width;
  const fullH = resizedFull.info.height;

  await sharp(resizedFull.data)
    .webp({ quality: WEBP_QUALITY })
    .toFile(path.join(PUBLIC_IMG_DIR, fullName));

  const resizedThumb = await orientedBase
    .clone()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const thumbW = resizedThumb.info.width;
  const thumbH = resizedThumb.info.height;

  await sharp(resizedThumb.data)
    .webp({ quality: WEBP_QUALITY })
    .toFile(path.join(PUBLIC_IMG_DIR, thumbName));

  return { id, fullName, thumbName, width: fullW, height: fullH, originalMeta: meta };
}

function regenerateManifest() {
  const rows = db.prepare(
    `SELECT id, filename, thumb_filename, caption, dog_name, width, height, created_at
     FROM gallery_photos WHERE is_published = 1
     ORDER BY COALESCE(sort_order, 999999) ASC, id ASC`
  ).all();

  const photos = rows.map(r => ({
    id: r.id,
    src: '/gallery/img/' + r.filename,
    thumb: '/gallery/img/' + r.thumb_filename,
    caption: r.caption || '',
    dog_name: r.dog_name || '',
    width: r.width,
    height: r.height,
    created_at: r.created_at
  }));

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
    updated_at: new Date().toISOString(),
    count: photos.length,
    photos
  }, null, 2));
}

router.get('/gallery', (_req, res) => {
  try {
    const rows = db.prepare(
      `SELECT id, filename, thumb_filename, caption, dog_name, consent, is_published,
              width, height, created_at
       FROM gallery_photos ORDER BY COALESCE(sort_order, 999999) ASC, id ASC`
    ).all();
    res.json(rows.map(r => ({
      ...r,
      thumb_url: '/gallery/img/' + r.thumb_filename,
      full_url: '/gallery/img/' + r.filename
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/gallery', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
    if (req.body.consent !== 'true' && req.body.consent !== true) {
      return res.status(400).json({ error: 'Consent confirmation required' });
    }

    const processed = await processAndSave(req.file.buffer);

    // Optional client link: when a real customer is chosen, store it on the photo
    // and make this photo that client's avatar (newest linked photo wins).
    const customerId = parseInt(req.body.customer_id, 10);
    const customer = customerId
      ? db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId)
      : null;

    const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM gallery_photos').get().n;
    const result = db.prepare(
      `INSERT INTO gallery_photos (filename, thumb_filename, caption, dog_name, consent, is_published, width, height, customer_id, sort_order)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`
    ).run(
      processed.fullName,
      processed.thumbName,
      (req.body.caption || '').trim() || null,
      (req.body.dog_name || '').trim() || null,
      processed.width,
      processed.height,
      customer ? customer.id : null,
      nextOrder
    );

    if (customer) {
      db.prepare('UPDATE customers SET avatar_photo_id = ? WHERE id = ?')
        .run(result.lastInsertRowid, customer.id);
    }

    regenerateManifest();
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('[gallery] upload error:', err.message);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

router.patch('/gallery/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { caption, dog_name, is_published } = req.body;
    db.prepare(
      `UPDATE gallery_photos SET
        caption = COALESCE(?, caption),
        dog_name = COALESCE(?, dog_name),
        is_published = COALESCE(?, is_published)
       WHERE id = ?`
    ).run(
      caption !== undefined ? (caption || '').trim() || null : null,
      dog_name !== undefined ? (dog_name || '').trim() || null : null,
      is_published !== undefined ? (is_published ? 1 : 0) : null,
      id
    );
    regenerateManifest();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/gallery/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const row = db.prepare('SELECT filename, thumb_filename FROM gallery_photos WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    // If this photo was any client's avatar, revert them to their initial.
    db.prepare('UPDATE customers SET avatar_photo_id = NULL WHERE avatar_photo_id = ?').run(id);

    db.prepare('DELETE FROM gallery_photos WHERE id = ?').run(id);

    for (const f of [row.filename, row.thumb_filename]) {
      const p = path.join(PUBLIC_IMG_DIR, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    regenerateManifest();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Photo is too large (15MB max)' });
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: err.message || 'Server error' });
});

if (!fs.existsSync(MANIFEST_PATH)) regenerateManifest();

module.exports = router;
