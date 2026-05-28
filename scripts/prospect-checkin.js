// One-off warm check-in to the 4 standing prospects (Scott, 2026-05-27).
// Sends SEPARATELY to each (never CC'd), branded locked template, records a
// per-recipient idempotency row in email_sends so a re-run / retry won't double-send,
// and drops a dated customer_note. Scheduled to fire 9:00 AM ET Wed 5/28 (13:00 UTC).
//
//   node scripts/prospect-checkin.js          # live send (each prospect, once)
//   node scripts/prospect-checkin.js --dry     # render HTML preview, no send
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const nodemailer = require('nodemailer');
const db = require('../lib/db');

const DRY = process.argv.includes('--dry');

// The 4 prospect customers (status='prospect') as of 2026-05-27.
const PROSPECTS = [
  { id: 4,  first: 'Tara',   dog: 'Gracie',  email: 'taraoneill81@yahoo.com' },
  { id: 5,  first: 'Chuck',  dog: 'Louie',   email: 'llcarlos48@yahoo.com' },
  { id: 9,  first: 'Trista', dog: 'Fitz',    email: 'tstoops20@yahoo.com' },
  { id: 12, first: 'Lea',    dog: 'Chester', email: 'lsalvador83@hotmail.com' },
];

const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function buildHtml({ first, dog }) {
  return `
<div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#faf8f4;border-radius:12px;overflow:hidden;border:1px solid #e8e5e0;">
  <div style="background:#14613a;padding:24px 32px;text-align:center;">
    <img src="https://barkstroll.com/bridgeville-bark-stroll-logo.png" alt="Bridgeville Bark & Stroll" style="max-height:60px;margin-bottom:8px;" />
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#ffffff;letter-spacing:0.02em;">Bridgeville Bark &amp; Stroll</div>
  </div>
  <div style="padding:32px;color:#2a2a28;font-size:15px;line-height:1.7;">
    <p>Hi ${escHtml(first)},</p>
    <p>Just wanted to check in and see how things are going with ${escHtml(dog)}!</p>
    <p>If you&rsquo;re ever interested in working with Bark &amp; Stroll, please don&rsquo;t hesitate to let us know &mdash; we&rsquo;d love to help out whenever you need us.</p>
    <p>Hope all is well!</p>
    <p style="margin-top:24px;"><strong>Scott</strong><br/><span style="color:#c4a44e;">Bridgeville Bark &amp; Stroll</span></p>
  </div>
  <div style="background:#0d4428;padding:16px 32px;text-align:center;">
    <span style="color:rgba(255,255,255,0.6);font-size:12px;">Bridgeville Bark &amp; Stroll &middot; Bridgeville, PA</span>
  </div>
</div>`;
}

const SUBJECT = 'Checking in from Bark & Stroll 🐾';
const SCOPE = 'prospect_checkin_2026_05_28';

async function main() {
  const from = `"Bark & Stroll" <${process.env.GMAIL_USER}>`;

  if (DRY) {
    console.log('--- DRY RUN, no email sent ---');
    console.log('From:', from);
    console.log('Subject:', SUBJECT);
    for (const p of PROSPECTS) {
      console.log(`\n=== ${p.first} (${p.email}) ===`);
      console.log(buildHtml(p));
    }
    return;
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set in /opt/barkstroll/.env');
  }
  const t = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  const already = db.prepare(
    'SELECT 1 FROM email_sends WHERE scope_type=? AND scope_id=? AND recipient_role=? LIMIT 1'
  );
  const record = db.prepare(
    'INSERT OR IGNORE INTO email_sends (scope_type, scope_id, recipient_role, recipient_email) VALUES (?,?,?,?)'
  );
  const addNote = db.prepare(
    "INSERT INTO customer_notes (customer_id, text, created_at) VALUES (?, ?, datetime('now'))"
  );

  for (const p of PROSPECTS) {
    if (already.get(SCOPE, String(p.id), 'prospect')) {
      console.log(`skip ${p.first} (${p.email}) — already sent`);
      continue;
    }
    await t.sendMail({
      from,
      to: p.email,
      replyTo: process.env.GMAIL_USER,
      subject: SUBJECT,
      html: buildHtml(p),
    });
    record.run(SCOPE, String(p.id), 'prospect', p.email);
    addNote.run(p.id, 'Sent warm check-in email (how are things, open door to work together). Branded template.');
    console.log(`sent ${p.first} (${p.email})`);
  }
  console.log('done.');
}

main().catch(e => { console.error(e); process.exit(1); });
