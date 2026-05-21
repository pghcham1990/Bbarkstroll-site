const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');

const LOGO_PATH = '/var/www/barkstroll.com/bridgeville-bark-stroll-logo-512.webp';
const OUT_WIDTH = 1080; // Facebook-friendly width

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WebP, or HEIC images are allowed'));
    }
    cb(null, true);
  }
});

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Full-size SVG overlay: optional top headline band + bottom brand bar (gradient,
// business name, URL/phone). The logo image is composited separately on top of this.
function brandOverlaySvg(W, H, headline, subtext) {
  const barH = Math.round(H * 0.14);
  const barY = H - barH;
  const logoBox = Math.round(barH * 0.74);
  const textX = Math.round(barH * 0.78) + logoBox; // sits right of the logo
  const nameSize = Math.round(barH * 0.30);
  const urlSize = Math.round(barH * 0.20);

  // Optional headline banner across the top.
  let headBand = '';
  if (headline) {
    const hSize = Math.round(H * 0.052);
    const hPadY = Math.round(hSize * 0.55);
    const bandH = hSize + hPadY * 2 + (subtext ? Math.round(hSize * 0.7) : 0);
    const subSize = Math.round(hSize * 0.62);
    headBand = `
      <rect x="0" y="0" width="${W}" height="${bandH}" fill="rgba(13,68,40,0.82)"/>
      <rect x="0" y="${bandH}" width="${W}" height="${Math.max(3, Math.round(H*0.006))}" fill="#c4a44e"/>
      <text x="${W / 2}" y="${hPadY + hSize * 0.82}" font-family="Georgia, 'Times New Roman', serif"
            font-size="${hSize}" font-weight="700" fill="#faf8f4" text-anchor="middle"
            letter-spacing="0.01em">${esc(headline)}</text>
      ${subtext ? `<text x="${W / 2}" y="${hPadY + hSize * 0.82 + subSize * 1.5}" font-family="-apple-system, Arial, sans-serif"
            font-size="${subSize}" font-weight="500" fill="rgba(196,164,78,0.95)" text-anchor="middle">${esc(subtext)}</text>` : ''}
    `;
  }

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(13,68,40,0)"/>
          <stop offset="38%" stop-color="rgba(13,68,40,0.55)"/>
          <stop offset="100%" stop-color="rgba(13,68,40,0.92)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${barY - Math.round(barH * 0.5)}" width="${W}" height="${barH + Math.round(barH * 0.5)}" fill="url(#bg)"/>
      <text x="${textX}" y="${barY + barH * 0.46}" font-family="Georgia, 'Times New Roman', serif"
            font-size="${nameSize}" font-weight="700" fill="#faf8f4">Bridgeville Bark &amp; Stroll</text>
      <text x="${textX}" y="${barY + barH * 0.78}" font-family="-apple-system, Arial, sans-serif"
            font-size="${urlSize}" font-weight="500" fill="rgba(196,164,78,0.95)" letter-spacing="0.04em">barkstroll.com  ·  (412) 992-1480</text>
      ${headBand}
    </svg>
  `);
}

// POST /admin/api/brand-image  (multipart: photo, headline?, subtext?)
router.post('/brand-image', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const headline = (req.body.headline || '').slice(0, 80);
    const subtext = (req.body.subtext || '').slice(0, 90);

    const base = sharp(req.file.buffer).rotate();
    const resized = await base.resize({ width: OUT_WIDTH, withoutEnlargement: false }).toBuffer({ resolveWithObject: true });
    const W = resized.info.width;
    const H = resized.info.height;

    const barH = Math.round(H * 0.14);
    const logoBox = Math.round(barH * 0.74);
    const logoBuf = await sharp(LOGO_PATH).resize({ width: logoBox, height: logoBox, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const logoLeft = Math.round(barH * 0.28);
    const logoTop = H - barH + Math.round((barH - logoBox) / 2);

    const out = await sharp(resized.data)
      .composite([
        { input: brandOverlaySvg(W, H, headline, subtext), top: 0, left: 0 },
        { input: logoBuf, top: logoTop, left: logoLeft },
      ])
      .png()
      .toBuffer();

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="barkstroll-branded.png"');
    res.send(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
