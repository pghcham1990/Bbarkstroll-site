const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireRole } = require('../lib/auth');

let sendRequestNotification, sendAppointmentEmail;
try {
  const email = require('../lib/email');
  sendRequestNotification = email.sendRequestNotification;
  sendAppointmentEmail = email.sendAppointmentEmail;
} catch { sendRequestNotification = null; sendAppointmentEmail = null; }

// Helpers for multi-dog support (shared with appointments.js)
function getApptDogs(appointmentId) {
  return db.prepare(
    'SELECT d.id, d.name, d.breed FROM appointment_dogs ad JOIN dogs d ON d.id = ad.dog_id WHERE ad.appointment_id = ?'
  ).all(appointmentId);
}
function attachDogInfo(row) {
  const dogs = getApptDogs(row.id);
  row.dogs = dogs;
  row.dog_names = dogs.map(d => d.name).join(', ');
  row.dog_names_with_breed = dogs.map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ');
  return row;
}

// Email quiet hours
function isQuietHours() {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = eastern.getHours();
  return hour < 8 || hour >= 20;
}

// ============================================================
//  EXCLUSIVE WALKER ASSIGNMENTS
//  customer_id → employee_id (only this walker handles them)
// ============================================================
const EXCLUSIVE_WALKERS = {
  3: 2,  // Kara McCusker → Scott Rocca only
};

// ============================================================
//  CUSTOMER ENDPOINTS (role: customer)
// ============================================================

// GET /api/portal/my-appointments — customer's appointments
router.get('/my-appointments', requireRole('customer'), (req, res) => {
  const customerId = req.session.user.customer_id;
  const rows = db.prepare(`
    SELECT a.id, a.customer_id, a.employee_id, a.service_id, a.start_time, a.end_time, a.status, a.notes,
      e.first_name as employee_name,
      s.name as service_name, s.duration_min as service_duration
    FROM appointments a
    JOIN employees e ON e.id = a.employee_id
    JOIN services s ON s.id = a.service_id
    WHERE a.customer_id = ?
    ORDER BY a.start_time
  `).all(customerId);
  res.json(rows.map(attachDogInfo));
});

// GET /api/portal/availability — all scheduled time blocks (date+time only)
router.get('/availability', requireRole('customer'), (req, res) => {
  const { start, end } = req.query;
  let sql = `SELECT a.start_time, a.end_time FROM appointments a WHERE a.status = 'scheduled'`;
  const params = [];
  if (start) { sql += ' AND a.start_time >= ?'; params.push(start); }
  if (end) { sql += ' AND a.start_time < ?'; params.push(end); }
  sql += ' ORDER BY a.start_time';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/portal/my-dogs
router.get('/my-dogs', requireRole('customer'), (req, res) => {
  const customerId = req.session.user.customer_id;
  res.json(db.prepare('SELECT id, name, breed FROM dogs WHERE customer_id = ?').all(customerId));
});

// GET /api/portal/services
router.get('/services', requireRole('customer', 'walker'), (req, res) => {
  res.json(db.prepare('SELECT id, name, duration_min FROM services WHERE active = 1 ORDER BY name').all());
});

// POST /api/portal/request — create appointment request
router.post('/request', requireRole('customer'), async (req, res) => {
  const customerId = req.session.user.customer_id;
  const { dog_ids, service_id, date, time, notes } = req.body;
  if (!dog_ids || !dog_ids.length || !service_id || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const result = db.prepare(
    'INSERT INTO appointment_requests (customer_id, service_id, preferred_date, preferred_time, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(customerId, service_id, date, time, notes || null);
  const requestId = result.lastInsertRowid;

  const insertDog = db.prepare('INSERT INTO appointment_request_dogs (request_id, dog_id) VALUES (?, ?)');
  for (const did of dog_ids) insertDog.run(requestId, did);

  // Send notification email to all active walkers + Scott
  if (sendRequestNotification) {
    try {
      const customer = db.prepare('SELECT first_name as name FROM customers WHERE id = ?').get(customerId);
      const dogs = db.prepare('SELECT d.name FROM appointment_request_dogs ard JOIN dogs d ON d.id = ard.dog_id WHERE ard.request_id = ?').all(requestId);
      const service = db.prepare('SELECT name FROM services WHERE id = ?').get(service_id);
      let notifyEmails;
      if (EXCLUSIVE_WALKERS[customerId]) {
        // Exclusive customer — only notify their assigned walker + owner
        const assignedEmp = db.prepare('SELECT email FROM employees WHERE id = ?').get(EXCLUSIVE_WALKERS[customerId]);
        notifyEmails = assignedEmp && assignedEmp.email ? [assignedEmp.email] : [];
        if (process.env.GMAIL_USER && !notifyEmails.includes(process.env.GMAIL_USER)) {
          notifyEmails.push(process.env.GMAIL_USER);
        }
      } else {
        const employees = db.prepare('SELECT email FROM employees WHERE active = 1 AND email IS NOT NULL').all();
        notifyEmails = employees.map(e => e.email);
        if (process.env.GMAIL_USER && !notifyEmails.includes(process.env.GMAIL_USER)) {
          notifyEmails.push(process.env.GMAIL_USER);
        }
      }
      await sendRequestNotification({
        customer_name: customer.name,
        dogs,
        dog_names: dogs.map(d => d.name).join(', '),
        service_name: service.name,
        preferred_date: date,
        preferred_time: time,
        notes: notes || null,
        notify_emails: notifyEmails
      });
    } catch (err) {
      console.error('Request notification email failed:', err.message);
    }
  }

  res.json({ ok: true, id: requestId });
});

// GET /api/portal/my-requests — customer's pending requests
router.get('/my-requests', requireRole('customer'), (req, res) => {
  const customerId = req.session.user.customer_id;
  const rows = db.prepare(`
    SELECT ar.*, s.name as service_name
    FROM appointment_requests ar
    JOIN services s ON s.id = ar.service_id
    WHERE ar.customer_id = ?
    ORDER BY ar.created_at DESC
  `).all(customerId);
  for (const row of rows) {
    row.dogs = db.prepare('SELECT d.id, d.name, d.breed FROM appointment_request_dogs ard JOIN dogs d ON d.id = ard.dog_id WHERE ard.request_id = ?').all(row.id);
    row.dog_names = row.dogs.map(d => d.name).join(', ');
  }
  res.json(rows);
});

// ============================================================
//  WALKER ENDPOINTS (role: walker)
// ============================================================

// GET /api/portal/walker/appointments — this walker's appointments
router.get('/walker/appointments', requireRole('walker'), (req, res) => {
  const employeeId = req.session.user.employee_id;
  const { start, end } = req.query;
  let sql = `
    SELECT a.id, a.customer_id, a.employee_id, a.service_id, a.start_time, a.end_time, a.status, a.notes,
      c.first_name as customer_name, c.address as customer_address,
      s.name as service_name, s.duration_min as service_duration
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN services s ON s.id = a.service_id
    WHERE a.employee_id = ?
  `;
  const params = [employeeId];
  if (start) { sql += ' AND a.start_time >= ?'; params.push(start); }
  if (end) { sql += ' AND a.start_time < ?'; params.push(end); }
  sql += ' ORDER BY a.start_time';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(attachDogInfo));
});

// GET /api/portal/walker/requests — all pending requests
// Filters out requests this walker has already declined (per-walker decline,
// stored in appointment_request_declines). Other walkers still see the request
// until someone accepts (or the request is cancelled).
router.get('/walker/requests', requireRole('walker'), (req, res) => {
  const employeeId = req.session.user.employee_id;
  const rows = db.prepare(`
    SELECT ar.*, s.name as service_name, s.duration_min as service_duration,
      c.first_name as customer_name
    FROM appointment_requests ar
    JOIN services s ON s.id = ar.service_id
    JOIN customers c ON c.id = ar.customer_id
    WHERE ar.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM appointment_request_declines d
        WHERE d.request_id = ar.id AND d.walker_employee_id = ?
      )
    ORDER BY ar.preferred_date, ar.preferred_time
  `).all(employeeId);
  const filtered = [];
  for (const row of rows) {
    // Hide exclusive-walker customers from other walkers
    if (EXCLUSIVE_WALKERS[row.customer_id] && EXCLUSIVE_WALKERS[row.customer_id] !== employeeId) continue;
    row.dogs = db.prepare('SELECT d.id, d.name, d.breed FROM appointment_request_dogs ard JOIN dogs d ON d.id = ard.dog_id WHERE ard.request_id = ?').all(row.id);
    row.dog_names = row.dogs.map(d => d.name).join(', ');
    row.declined_by_me = false;
    filtered.push(row);
  }
  res.json(filtered);
});

// POST /api/portal/walker/accept/:id — accept request → create appointment
router.post('/walker/accept/:id', requireRole('walker'), async (req, res) => {
  const employeeId = req.session.user.employee_id;
  const requestId = req.params.id;

  const request = db.prepare('SELECT * FROM appointment_requests WHERE id = ? AND status = ?').get(requestId, 'pending');
  if (!request) return res.status(404).json({ error: 'Request not found or already handled' });

  // Block non-assigned walkers from accepting exclusive customers
  if (EXCLUSIVE_WALKERS[request.customer_id] && EXCLUSIVE_WALKERS[request.customer_id] !== employeeId) {
    return res.status(403).json({ error: 'This client is assigned to another walker' });
  }

  // Get service duration
  const service = db.prepare('SELECT duration_min FROM services WHERE id = ?').get(request.service_id);
  const dur = service ? service.duration_min : 30;

  // Build start/end times from preferred_date + preferred_time
  const startDt = new Date(request.preferred_date + 'T' + request.preferred_time);
  const endDt = new Date(startDt.getTime() + dur * 60000);

  // Get dog ids
  const dogRows = db.prepare('SELECT dog_id FROM appointment_request_dogs WHERE request_id = ?').all(requestId);
  const dogIds = dogRows.map(d => d.dog_id);

  // Create real appointment
  const result = db.prepare(
    'INSERT INTO appointments (customer_id, dog_id, employee_id, service_id, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(request.customer_id, dogIds[0], employeeId, request.service_id, startDt.toISOString(), endDt.toISOString(), request.notes);
  const apptId = result.lastInsertRowid;

  // Insert junction rows
  const insertDog = db.prepare('INSERT INTO appointment_dogs (appointment_id, dog_id) VALUES (?, ?)');
  for (const did of dogIds) insertDog.run(apptId, did);

  // Mark request as accepted
  db.prepare("UPDATE appointment_requests SET status = 'accepted', accepted_by = ?, updated_at = datetime('now') WHERE id = ?").run(employeeId, requestId);

  // Send confirmation email (same as normal appointment flow)
  let emailSent = false;
  if (sendAppointmentEmail && !isQuietHours()) {
    try {
      const appt = db.prepare(`
        SELECT a.*,
          c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.address as customer_address,
          e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
          s.name as service_name
        FROM appointments a
        JOIN customers c ON c.id = a.customer_id
        JOIN employees e ON e.id = a.employee_id
        JOIN services s ON s.id = a.service_id
        WHERE a.id = ?
      `).get(apptId);
      attachDogInfo(appt);
      await sendAppointmentEmail(appt);
      db.prepare('UPDATE appointments SET email_sent = 1 WHERE id = ?').run(apptId);
      emailSent = true;
    } catch (err) {
      console.error('Confirmation email failed:', err.message);
    }
  }

  res.json({ ok: true, appointment_id: apptId, email_sent: emailSent });
});

// POST /api/portal/walker/decline/:id — decline for THIS walker only.
// Inserts into appointment_request_declines so the request stays visible to
// other walkers until someone accepts. The parent appointment_requests row is
// no longer flipped to 'declined' on individual walker actions.
router.post('/walker/decline/:id', requireRole('walker'), (req, res) => {
  const employeeId = req.session.user.employee_id;
  const requestId = req.params.id;
  const request = db.prepare('SELECT * FROM appointment_requests WHERE id = ? AND status = ?').get(requestId, 'pending');
  if (!request) return res.status(404).json({ error: 'Request not found or already handled' });
  db.prepare(
    'INSERT OR IGNORE INTO appointment_request_declines (request_id, walker_employee_id) VALUES (?, ?)'
  ).run(requestId, employeeId);
  res.json({ ok: true });
});

// POST /api/portal/report-issue — send bug report to Scott
const escapeHtml = require('escape-html');
function safeHeader(v) { return String(v || '').replace(/[\r\n]/g, ' ').slice(0, 200); }

router.post('/report-issue', requireRole('customer', 'walker', 'admin'), async (req, res) => {
  const message = String(req.body && req.body.message || '').slice(0, 4000);
  if (!message.trim()) return res.status(400).json({ error: 'Please describe the issue' });

  const user = req.session.user;
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });

  try {
    await t.sendMail({
      from: `"Bark & Stroll Portal" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: `Portal Issue Report from ${safeHeader(user.display_name)}`,
      html: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:500px;margin:0 auto">
          <div style="background:#c0392b;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
            <h1 style="margin:0;font-size:22px;font-weight:600">Issue Report</h1>
          </div>
          <div style="background:#ffffff;padding:24px;border:1px solid #e8e8e5;border-top:none;border-radius:0 0 12px 12px">
            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="padding:8px 0;color:#888;width:100px">From</td><td style="padding:8px 0;font-weight:600">${escapeHtml(user.display_name)}</td></tr>
              <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0">${escapeHtml(user.username)}</td></tr>
              <tr><td style="padding:8px 0;color:#888">Role</td><td style="padding:8px 0">${escapeHtml(user.role)}</td></tr>
              <tr><td style="padding:8px 0;color:#888">Issue</td><td style="padding:8px 0;white-space:pre-wrap">${escapeHtml(message)}</td></tr>
            </table>
          </div>
        </div>
      `
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Issue report email failed:', err.message);
    res.status(500).json({ error: 'Failed to send report' });
  }
});

module.exports = router;
