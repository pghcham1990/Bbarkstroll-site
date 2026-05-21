require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { requireAuth, requireRole } = require('./lib/auth');

// SSRF startup guard: GUARD_URL and BPD_MAILER_URL are used as URL prefixes
// for server-side fetch() calls that carry sensitive payloads (TOTP tokens,
// session cookies, AI drafts). If misconfigured to point at an arbitrary host
// the server will happily ship credentials there. Fail loud at boot so a bad
// env edit doesn't go unnoticed.
function assertLoopbackUrl(name, val) {
  if (!val) return; // optional: missing env disables the integration
  let u;
  try { u = new URL(val); } catch (_) { throw new Error(`${name} is not a valid URL: ${val}`); }
  const host = u.hostname.toLowerCase();
  const ok = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (!ok) throw new Error(`${name} must point at loopback (localhost/127.0.0.1); got ${host}`);
}
assertLoopbackUrl('GUARD_URL', process.env.GUARD_URL);
assertLoopbackUrl('BPD_MAILER_URL', process.env.BPD_MAILER_URL);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8081;

// Middleware
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
require('fs').mkdirSync(require('path').join(__dirname, 'data', 'secure-docs'), { recursive: true, mode: 0o700 });
require('./migrate-employee-documents').migrate(require('./lib/db')); // idempotent; ensures W-9 doc tables exist on every boot
const SqliteStore = require('./lib/session-store');
app.use(session({
  store: SqliteStore(),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: 8 * 3600 * 1000,
  },
}));

// HMAC-token check for public calendar feeds. Mirrors the generator in lib/email.js.
function verifyCalToken(prefix, id, providedToken) {
  if (!providedToken || typeof providedToken !== 'string') return false;
  const secret = process.env.BARKSTROLL_CAL_SECRET || process.env.SESSION_SECRET || '';
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(prefix + ':' + String(id)).digest('hex').slice(0, 16);
  if (providedToken.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(expected));
}

// Tiny in-memory rate limiter for public endpoints. No new dep.
// SECURITY: every unique source IP creates an entry. Without pruning the Map
// grows unboundedly across weeks of public traffic / bot scans, eventually
// pushing the process toward OOM. Sweep expired entries opportunistically.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  const PRUNE_THRESHOLD = 5000;
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const e = hits.get(ip);
    if (!e || e.resetAt < now) {
      if (hits.size > PRUNE_THRESHOLD) {
        for (const [k, v] of hits) {
          if (v.resetAt < now) hits.delete(k);
        }
      }
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    e.count++;
    if (e.count > max) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}
const contactLimiter = rateLimit({ windowMs: 60_000, max: 4 });
const applicantLimiter = rateLimit({ windowMs: 60_000, max: 3 });

// Login page
app.get('/portal', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Static assets for admin app
app.use('/admin/static', express.static(path.join(__dirname, 'public')));

// Customer portal
app.get('/client', requireAuth, requireRole('customer'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// Walker portal
app.get('/walker', requireAuth, requireRole('walker'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'walker.html'));
});

// Portal API routes
app.use('/api/portal', requireAuth, require('./routes/portal'));

// Public .ics download (no auth — linked from emails)
const db = require('./lib/db');
const { generateICS, generateBatchICS } = require('./lib/ics');

// Public batched .ics download (multi-visit bookings — linked from emails).
// HMAC token in `?t=` prevents enumeration by ID; without it, every customer's
// name, email, address, and walker assignment was scrapeable.
app.get('/admin/cal/batch/:batch_id.ics', (req, res) => {
  if (!verifyCalToken('batch', req.params.batch_id, req.query.t)) return res.status(404).send('Not found');
  const rows = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.address as customer_address,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN employees e ON e.id = a.employee_id JOIN services s ON s.id = a.service_id
    WHERE a.batch_id = ?
    ORDER BY a.start_time
  `).all(req.params.batch_id);
  if (!rows.length) return res.status(404).send('Not found');
  for (const appt of rows) {
    const dogs = db.prepare(
      'SELECT d.id, d.name, d.breed FROM appointment_dogs ad JOIN dogs d ON d.id = ad.dog_id WHERE ad.appointment_id = ?'
    ).all(appt.id);
    appt.dogs = dogs;
    appt.dog_names = dogs.map(d => d.name).join(', ');
    appt.dog_names_with_breed = dogs.map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ');
  }
  const attendeeEmails = [rows[0].customer_email, rows[0].employee_email].filter(Boolean);
  const ics = generateBatchICS(rows, attendeeEmails);
  res.set({ 'Content-Type': 'text/calendar', 'Content-Disposition': 'attachment; filename=visits.ics' });
  res.send(ics);
});

app.get('/admin/cal/:id.ics', (req, res) => {
  if (!verifyCalToken('appt', req.params.id, req.query.t)) return res.status(404).send('Not found');
  const appt = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.address as customer_address,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN employees e ON e.id = a.employee_id JOIN services s ON s.id = a.service_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!appt) return res.status(404).send('Not found');
  // Attach multi-dog info from junction table
  const dogs = db.prepare(
    'SELECT d.id, d.name, d.breed FROM appointment_dogs ad JOIN dogs d ON d.id = ad.dog_id WHERE ad.appointment_id = ?'
  ).all(appt.id);
  appt.dogs = dogs;
  appt.dog_names = dogs.map(d => d.name).join(', ');
  appt.dog_names_with_breed = dogs.map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ');
  const attendeeEmails = [appt.customer_email, appt.employee_email].filter(Boolean);
  const ics = generateICS(appt, attendeeEmails);
  res.set({ 'Content-Type': 'text/calendar', 'Content-Disposition': 'attachment; filename=appointment.ics' });
  res.send(ics);
});

// Public contact form endpoint (no auth required)
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, phone, email, dog_names, city, out_of_area, website } = req.body;
    // Honeypot: real users never fill this hidden field. Bots do.
    // Return 200 so they don't learn the form is gated.
    if (website && String(website).trim() !== '') return res.json({ ok: true });
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

    // Split name into first/last
    const parts = name.trim().split(/\s+/);
    const first_name = parts[0];
    const last_name = parts.slice(1).join(' ') || '';

    // Check if customer already exists by email
    const existing = db.prepare('SELECT id FROM customers WHERE email = ?').get(email.trim());
    if (!existing) {
      // Create as prospect
      const submittedOn = new Date().toLocaleDateString('en-US');
      const cityPart = city ? ' City: ' + city + '.' : '';
      const flag = out_of_area ? '[OUT OF AREA] ' : '';
      const notes = flag + 'Form submission ' + submittedOn + '.' + cityPart;
      const result = db.prepare(
        "INSERT INTO customers (first_name, last_name, email, phone, notes, status) VALUES (?, ?, ?, ?, ?, 'prospect')"
      ).run(first_name, last_name, email.trim(), phone || null, notes);

      // Add dogs if provided
      if (dog_names) {
        const dogInsert = db.prepare('INSERT INTO dogs (customer_id, name) VALUES (?, ?)');
        dog_names.split(',').map(d => d.trim()).filter(Boolean).forEach(dogName => {
          dogInsert.run(result.lastInsertRowid, dogName);
        });
      }
    }

    // Notify Scott (owner) — branded, contains every field. Lead-safe: log on failure
    // but never break the request, so a mailer outage can't 500 the form.
    try {
      const { sendContactFormNotification } = require('./lib/email');
      await sendContactFormNotification({
        name, email: email.trim(), phone, dog_names, city, out_of_area
      });
    } catch (notifyErr) {
      console.error('[contact] admin notification failed:', notifyErr.message);
    }

    // Send branded welcome email via BPD Mailer
    const MAILER_URL = process.env.BPD_MAILER_URL;
    const MAILER_KEY = process.env.BPD_MAILER_API_KEY;
    if (MAILER_URL && MAILER_KEY) {
      try {
        await fetch(MAILER_URL + '/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': MAILER_KEY },
          body: JSON.stringify({
            to: email.trim(),
            subject: 'Thanks for reaching out, Bridgeville Bark and Stroll',
            body: 'Hi ' + first_name + ',\n\nThank you for your interest in Bridgeville Bark & Stroll! We received your request and will get back to you within one business day.\n\nWe look forward to meeting you and ' + (dog_names || 'your pup') + '!\n\nScott\nBridgeville Bark & Stroll',
            sent_by: 'System'
          })
        });
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Contact form error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.post('/api/applicants/submit', applicantLimiter, async (req, res) => {
  try {
    const b = req.body || {};

    // Honeypot: bots fill `website`, humans don't see it.
    if (b.website && String(b.website).trim() !== '') return res.json({ ok: true });

    // Server-side validation. Mirror exactly what the form requires.
    const required = ['full_name', 'email', 'phone', 'zip', 'closest_area', 'hours_hoping', 'why_interested', 'tricky_situation'];
    for (const f of required) {
      if (!b[f] || String(b[f]).trim() === '') {
        return res.status(400).json({ error: 'Missing required field: ' + f });
      }
    }

    if (b.is_18_plus !== true && b.is_18_plus !== 'true' && b.is_18_plus !== 1) {
      return res.status(400).json({ error: 'Must be 18 or older to apply' });
    }

    const daysArr = Array.isArray(b.days_available) ? b.days_available : [];
    const timesArr = Array.isArray(b.time_windows) ? b.time_windows : [];
    const sizesArr = Array.isArray(b.sizes_ok) ? b.sizes_ok : [];
    if (!daysArr.length) return res.status(400).json({ error: 'Pick at least one day' });
    if (!timesArr.length) return res.status(400).json({ error: 'Pick at least one time window' });
    if (!sizesArr.length) return res.status(400).json({ error: 'Pick at least one dog size' });

    const attestKeys = ['att_18', 'att_truthful', 'att_no_cruelty', 'att_1099', 'att_consent', 'att_privacy'];
    for (const k of attestKeys) {
      if (b[k] !== true && b[k] !== 'true' && b[k] !== 1) {
        return res.status(400).json({ error: 'All attestations must be checked' });
      }
    }

    const attestSnapshot = JSON.stringify({
      checked_at: new Date().toISOString(),
      ip: req.ip,
      keys: attestKeys
    });

    const cleanEmail = String(b.email).trim().toLowerCase();
    const existing = db.prepare('SELECT id, status FROM applicants WHERE LOWER(email) = ?').get(cleanEmail);

    let applicantId;
    if (existing && existing.status === 'lead') {
      // Upsert: stub lead row gets filled in with the full application and promoted to 'new'.
      db.prepare(`
        UPDATE applicants SET
          full_name = ?, preferred_name = ?, phone = ?, zip = ?,
          is_18_plus = ?, has_transport = ?, closest_area = ?,
          days_available = ?, time_windows = ?, hours_hoping = ?,
          owned_dogs = ?, experience_note = ?, sizes_ok = ?,
          uncomfortable = ?, allergies = ?, why_interested = ?, tricky_situation = ?,
          ref1_name = ?, ref1_phone = ?, ref1_relation = ?,
          ref2_name = ?, ref2_phone = ?, ref2_relation = ?,
          refs_on_request = ?, attestations = ?, status = 'new'
        WHERE id = ?
      `).run(
        String(b.full_name).trim(),
        b.preferred_name ? String(b.preferred_name).trim() : null,
        String(b.phone).trim(),
        String(b.zip).trim(),
        1,
        b.has_transport ? 1 : 0,
        String(b.closest_area).trim(),
        JSON.stringify(daysArr),
        JSON.stringify(timesArr),
        String(b.hours_hoping).trim(),
        b.owned_dogs ? 1 : 0,
        b.experience_note ? String(b.experience_note).trim() : null,
        JSON.stringify(sizesArr),
        b.uncomfortable ? String(b.uncomfortable).trim() : null,
        b.allergies ? String(b.allergies).trim() : null,
        String(b.why_interested).trim(),
        String(b.tricky_situation).trim(),
        b.ref1_name ? String(b.ref1_name).trim() : null,
        b.ref1_phone ? String(b.ref1_phone).trim() : null,
        b.ref1_relation ? String(b.ref1_relation).trim() : null,
        b.ref2_name ? String(b.ref2_name).trim() : null,
        b.ref2_phone ? String(b.ref2_phone).trim() : null,
        b.ref2_relation ? String(b.ref2_relation).trim() : null,
        b.refs_on_request ? 1 : 0,
        attestSnapshot,
        existing.id
      );
      applicantId = existing.id;
    } else if (existing) {
      // Real prior application exists at any non-lead status. Don't silently overwrite Scott's review work,
      // and don't hand the applicant back a contact path that invites repeat outreach. The client renders
      // `already_applied: true` as a full-page "on file" panel instead of a red form error.
      return res.status(409).json({
        already_applied: true,
        error: "Your application is already on file and active in our system."
      });
    } else {
      const result = db.prepare(`
        INSERT INTO applicants (
          full_name, preferred_name, email, phone, zip,
          is_18_plus, has_transport, closest_area,
          days_available, time_windows, hours_hoping,
          owned_dogs, experience_note, sizes_ok,
          uncomfortable, allergies, why_interested, tricky_situation,
          ref1_name, ref1_phone, ref1_relation,
          ref2_name, ref2_phone, ref2_relation,
          refs_on_request, attestations
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(b.full_name).trim(),
        b.preferred_name ? String(b.preferred_name).trim() : null,
        cleanEmail,
        String(b.phone).trim(),
        String(b.zip).trim(),
        1,
        b.has_transport ? 1 : 0,
        String(b.closest_area).trim(),
        JSON.stringify(daysArr),
        JSON.stringify(timesArr),
        String(b.hours_hoping).trim(),
        b.owned_dogs ? 1 : 0,
        b.experience_note ? String(b.experience_note).trim() : null,
        JSON.stringify(sizesArr),
        b.uncomfortable ? String(b.uncomfortable).trim() : null,
        b.allergies ? String(b.allergies).trim() : null,
        String(b.why_interested).trim(),
        String(b.tricky_situation).trim(),
        b.ref1_name ? String(b.ref1_name).trim() : null,
        b.ref1_phone ? String(b.ref1_phone).trim() : null,
        b.ref1_relation ? String(b.ref1_relation).trim() : null,
        b.ref2_name ? String(b.ref2_name).trim() : null,
        b.ref2_phone ? String(b.ref2_phone).trim() : null,
        b.ref2_relation ? String(b.ref2_relation).trim() : null,
        b.refs_on_request ? 1 : 0,
        attestSnapshot
      );
      applicantId = result.lastInsertRowid;
    }

    // Notify Scott. Don't break the submission if email is down.
    try {
      const { sendApplicantNotification } = require('./lib/email');
      const row = db.prepare('SELECT * FROM applicants WHERE id = ?').get(applicantId);
      await sendApplicantNotification(row);
    } catch (notifyErr) {
      console.error('[applicant-submit] notification failed:', notifyErr.message);
    }

    res.json({ ok: true, id: applicantId });
  } catch (err) {
    console.error('Applicant submit error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Auth routes (no auth required)
app.use('/admin/api', require('./routes/auth'));

// Protected API routes — admin role required. Previously any authenticated
// user (customer / walker portal sessions included) could enumerate the entire
// customer list, employee directory, earnings, and trigger bulk email. The
// portal API at /api/portal is gated separately above with its own role checks.
const adminOnly = [requireAuth, requireRole('admin')];
app.use('/admin/api', adminOnly, require('./routes/customers'));
app.use('/admin/api', adminOnly, require('./routes/employees'));
app.use('/admin/api', adminOnly, require('./routes/services'));
app.use('/admin/api', adminOnly, require('./routes/appointments'));
app.use('/admin/api', adminOnly, require('./routes/documents'));
app.use('/admin/api', adminOnly, require('./routes/earnings'));
app.use('/admin/api', adminOnly, require('./routes/email'));
app.use('/admin/api', adminOnly, require('./routes/notes'));
app.use('/admin/api', adminOnly, require('./routes/gallery'));
app.use('/admin/api', adminOnly, require('./routes/applicants'));
app.use('/admin/api', adminOnly, require('./routes/content'));
app.use('/admin/api', adminOnly, require('./routes/employee-documents'));

// SPA fallback — all /admin/* non-API routes serve the app shell
app.get('/admin/*', requireAuth, requireRole('admin'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Redirect /admin to /admin/app
app.get('/admin', (_req, res) => {
  res.redirect('/admin/app');
});

// JSON error handler — body-parser errors and unhandled throws come here.
// Without it, Express returns a default HTML error page that leaks framework details.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  console.error('[barkstroll] unhandled:', err && err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Bark & Stroll admin running on http://127.0.0.1:${PORT}`);

  // Background job: send queued emails once quiet hours end (checks every 60s)
  const { sendPendingEmails } = require('./routes/appointments');
  setInterval(() => {
    sendPendingEmails().catch(err => console.error('Pending email job error:', err.message));
  }, 60 * 1000);
});
