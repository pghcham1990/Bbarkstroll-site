require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { requireAuth } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 8081;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
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

// Public .ics download (no auth — linked from emails)
const db = require('./lib/db');
const { generateICS } = require('./lib/ics');
app.get('/admin/cal/:id.ics', (req, res) => {
  const appt = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.address as customer_address,
      d.name as dog_name, d.breed as dog_breed,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id JOIN dogs d ON d.id = a.dog_id
    JOIN employees e ON e.id = a.employee_id JOIN services s ON s.id = a.service_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!appt) return res.status(404).send('Not found');
  const attendeeEmails = [appt.customer_email, appt.employee_email].filter(Boolean);
  const ics = generateICS(appt, attendeeEmails);
  res.set({ 'Content-Type': 'text/calendar', 'Content-Disposition': 'attachment; filename=appointment.ics' });
  res.send(ics);
});

// Auth routes (no auth required)
app.use('/admin/api', require('./routes/auth'));

// Protected API routes
app.use('/admin/api', requireAuth, require('./routes/customers'));
app.use('/admin/api', requireAuth, require('./routes/employees'));
app.use('/admin/api', requireAuth, require('./routes/services'));
app.use('/admin/api', requireAuth, require('./routes/appointments'));

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
});
