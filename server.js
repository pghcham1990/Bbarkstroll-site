require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { requireAuth, requireRole } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 8081;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const SqliteStore = require('./lib/session-store');
app.use(session({
  store: SqliteStore(),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 }
}));

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
const { generateICS } = require('./lib/ics');
app.get('/admin/cal/:id.ics', (req, res) => {
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
app.post('/api/contact', async (req, res) => {
  try {
    const { name, phone, email, dog_names } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

    // Split name into first/last
    const parts = name.trim().split(/\s+/);
    const first_name = parts[0];
    const last_name = parts.slice(1).join(' ') || '';

    // Check if customer already exists by email
    const existing = db.prepare('SELECT id FROM customers WHERE email = ?').get(email.trim());
    if (!existing) {
      // Create as prospect
      const notes = 'Form submission ' + new Date().toLocaleDateString('en-US') + '.';
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
            subject: 'Thanks for reaching out! — Bridgeville Bark & Stroll',
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

// Auth routes (no auth required)
app.use('/admin/api', require('./routes/auth'));

// Protected API routes
app.use('/admin/api', requireAuth, require('./routes/customers'));
app.use('/admin/api', requireAuth, require('./routes/employees'));
app.use('/admin/api', requireAuth, require('./routes/services'));
app.use('/admin/api', requireAuth, require('./routes/appointments'));
app.use('/admin/api', requireAuth, require('./routes/documents'));
app.use('/admin/api', requireAuth, require('./routes/earnings'));
app.use('/admin/api', requireAuth, require('./routes/email'));
app.use('/admin/api', requireAuth, require('./routes/notes'));

// SPA fallback — all /admin/* non-API routes serve the app shell
app.get('/admin/*', requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Redirect /admin to /admin/app
app.get('/admin', (_req, res) => {
  res.redirect('/admin/app');
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Bark & Stroll admin running on http://127.0.0.1:${PORT}`);

  // Background job: send queued emails once quiet hours end (checks every 60s)
  const { sendPendingEmails } = require('./routes/appointments');
  setInterval(() => {
    sendPendingEmails().catch(err => console.error('Pending email job error:', err.message));
  }, 60 * 1000);
});
