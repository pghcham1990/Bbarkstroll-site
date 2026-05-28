const express = require('express');
const router = express.Router();
const db = require('../lib/db');

let sendAppointmentEmail;
let sendBatchAppointmentEmail;
try {
  const emailLib = require('../lib/email');
  sendAppointmentEmail = emailLib.sendAppointmentEmail;
  sendBatchAppointmentEmail = emailLib.sendBatchAppointmentEmail;
} catch {
  sendAppointmentEmail = null;
  sendBatchAppointmentEmail = null;
}

function newBatchId() {
  return 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function fetchApptWithJoins(id) {
  const row = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.address as customer_address,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN employees e ON e.id = a.employee_id JOIN services s ON s.id = a.service_id
    WHERE a.id = ?
  `).get(id);
  if (row) attachDogInfo(row);
  return row;
}

// Email quiet hours: only send between 8am-8pm Eastern
function isQuietHours() {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = eastern.getHours();
  return hour < 8 || hour >= 20;
}

// Helpers for multi-dog support
function getApptDogs(appointmentId) {
  return db.prepare(
    'SELECT d.id, d.name, d.breed FROM appointment_dogs ad JOIN dogs d ON d.id = ad.dog_id WHERE ad.appointment_id = ?'
  ).all(appointmentId);
}
function formatDogNames(dogs) { return dogs.map(d => d.name).join(', '); }
function formatDogsWithBreed(dogs) { return dogs.map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', '); }

function attachDogInfo(row) {
  const dogs = getApptDogs(row.id);
  row.dogs = dogs;
  row.dog_names = formatDogNames(dogs);
  row.dog_names_with_breed = formatDogsWithBreed(dogs);
  return row;
}

// List appointments with optional date range and filters
router.get('/appointments', (req, res) => {
  const { start, end, employee_id, customer_id } = req.query;
  let sql = `
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name, s.duration_min as service_duration
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN employees e ON e.id = a.employee_id
    JOIN services s ON s.id = a.service_id
    WHERE 1=1
  `;
  const params = [];
  if (start) { sql += ' AND a.start_time >= ?'; params.push(start); }
  if (end) { sql += ' AND a.start_time < ?'; params.push(end); }
  if (employee_id) { sql += ' AND a.employee_id = ?'; params.push(employee_id); }
  if (customer_id) { sql += ' AND a.customer_id = ?'; params.push(customer_id); }
  sql += ' ORDER BY a.start_time';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(attachDogInfo));
});

// Get single appointment
router.get('/appointments/:id', (req, res) => {
  const row = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name, s.duration_min as service_duration
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN employees e ON e.id = a.employee_id
    JOIN services s ON s.id = a.service_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  attachDogInfo(row);
  res.json(row);
});

// Create appointment
router.post('/appointments', async (req, res) => {
  const { customer_id, dog_ids, dog_id, employee_id, service_id, start_time, end_time, notes } = req.body;
  // Support both dog_ids (new) and dog_id (legacy)
  const resolvedDogIds = dog_ids || (dog_id ? [dog_id] : []);
  if (!customer_id || !resolvedDogIds.length || !employee_id || !service_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const result = db.prepare(
    'INSERT INTO appointments (customer_id, dog_id, employee_id, service_id, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(customer_id, resolvedDogIds[0], employee_id, service_id, start_time, end_time, notes || null);

  const apptId = result.lastInsertRowid;

  // Insert junction rows
  const insertDog = db.prepare('INSERT INTO appointment_dogs (appointment_id, dog_id) VALUES (?, ?)');
  for (const did of resolvedDogIds) {
    insertDog.run(apptId, did);
  }

  // Send email notification (skip during quiet hours: before 8am or after 8pm ET)
  let emailSent = false;
  let emailQueued = false;
  if (sendAppointmentEmail && !isQuietHours()) {
    try {
      const appt = db.prepare(`
        SELECT a.*,
          c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.address as customer_address,
          e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
          s.name as service_name
        FROM appointments a
        JOIN customers c ON c.id = a.customer_id
        JOIN employees e ON e.id = a.employee_id JOIN services s ON s.id = a.service_id
        WHERE a.id = ?
      `).get(apptId);
      attachDogInfo(appt);
      await sendAppointmentEmail(appt);
      db.prepare('UPDATE appointments SET email_sent = 1 WHERE id = ?').run(apptId);
      emailSent = true;
    } catch (err) {
      console.error('Email send failed:', err.message);
    }
  } else if (sendAppointmentEmail && isQuietHours()) {
    emailQueued = true;
    console.log('Appointment ' + apptId + ' email queued — quiet hours (will send at 8am ET)');
  }

  res.json({ ok: true, id: apptId, email_sent: emailSent, email_queued: emailQueued });
});

// Batch-create appointments: one POST, one email per recipient for the whole run
router.post('/appointments/batch', async (req, res) => {
  const { customer_id, dog_ids, employee_id, service_id, notes, visits } = req.body;
  if (!customer_id || !employee_id || !service_id || !Array.isArray(dog_ids) || !dog_ids.length || !Array.isArray(visits) || !visits.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  for (const v of visits) {
    if (!v.start_time || !v.end_time) return res.status(400).json({ error: 'Each visit needs start_time and end_time' });
  }

  const batchId = newBatchId();
  const ids = [];

  const insertAppt = db.prepare(
    'INSERT INTO appointments (customer_id, dog_id, employee_id, service_id, start_time, end_time, notes, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertDog = db.prepare('INSERT INTO appointment_dogs (appointment_id, dog_id) VALUES (?, ?)');

  const tx = db.transaction(() => {
    for (const v of visits) {
      const result = insertAppt.run(customer_id, dog_ids[0], employee_id, service_id, v.start_time, v.end_time, notes || null, batchId);
      const apptId = result.lastInsertRowid;
      for (const did of dog_ids) insertDog.run(apptId, did);
      ids.push(apptId);
    }
  });
  tx();

  let emailSent = false;
  let emailQueued = false;
  if (sendBatchAppointmentEmail && !isQuietHours()) {
    try {
      const appts = ids.map(fetchApptWithJoins);
      await sendBatchAppointmentEmail(appts);
      const markSent = db.prepare('UPDATE appointments SET email_sent = 1 WHERE id = ?');
      const markAll = db.transaction(() => { for (const id of ids) markSent.run(id); });
      markAll();
      emailSent = true;
    } catch (err) {
      console.error('Batch email send failed:', err.message);
    }
  } else if (sendBatchAppointmentEmail && isQuietHours()) {
    emailQueued = true;
    console.log('Batch ' + batchId + ' email queued — quiet hours (will send at 8am ET)');
  }

  res.json({ ok: true, ids, batch_id: batchId, email_sent: emailSent, email_queued: emailQueued });
});

// Update appointment
router.put('/appointments/:id', (req, res) => {
  const { customer_id, dog_ids, dog_id, employee_id, service_id, start_time, end_time, notes, status } = req.body;
  const resolvedDogIds = dog_ids || (dog_id ? [dog_id] : []);
  db.prepare(
    "UPDATE appointments SET customer_id=?, dog_id=?, employee_id=?, service_id=?, start_time=?, end_time=?, notes=?, status=?, updated_at=datetime('now') WHERE id=?"
  ).run(customer_id, resolvedDogIds[0] || dog_id, employee_id, service_id, start_time, end_time, notes || null, status || 'scheduled', req.params.id);

  // Update junction table
  if (resolvedDogIds.length) {
    db.prepare('DELETE FROM appointment_dogs WHERE appointment_id = ?').run(req.params.id);
    const insertDog = db.prepare('INSERT INTO appointment_dogs (appointment_id, dog_id) VALUES (?, ?)');
    for (const did of resolvedDogIds) {
      insertDog.run(req.params.id, did);
    }
  }

  res.json({ ok: true });
});

// Hard delete — admin tooling only. The calendar UI's "Cancel Appointment"
// button uses POST /appointments/:id/cancel (below), which soft-cancels and
// emails all three parties. Don't wire this DELETE to user-facing UI.
router.delete('/appointments/:id', (req, res) => {
  db.prepare('DELETE FROM appointment_dogs WHERE appointment_id = ?').run(req.params.id);
  db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Soft-cancel: flip status to 'cancelled', stamp cancelled_at/_by, and email
// client + walker + owner with a METHOD:CANCEL ICS so their calendars
// auto-remove the event. Bypasses quiet hours — missing a cancel is worse
// than waking someone up.
router.post('/appointments/:id/cancel', async (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT id, status FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.status === 'completed') return res.status(400).json({ error: 'Cannot cancel a completed visit' });
  if (existing.status === 'cancelled') return res.json({ ok: true, already_cancelled: true });

  const cancelledBy = (req.session && req.session.user && (req.session.user.display_name || req.session.user.username)) || 'admin';
  db.prepare(`
    UPDATE appointments
       SET status = 'cancelled',
           cancelled_at = datetime('now'),
           cancelled_by = ?,
           updated_at = datetime('now')
     WHERE id = ?
  `).run(cancelledBy, id);

  // Lazily-loaded email lib (mirrors the create flow's try/require pattern).
  let sendCancellationEmail = null;
  try { sendCancellationEmail = require('../lib/email').sendCancellationEmail; } catch {}

  let emailSent = false;
  let emailError = null;
  if (sendCancellationEmail) {
    try {
      const appt = fetchApptWithJoins(id);
      // Inject cancelled_by so the email body can render it.
      appt.cancelled_by = cancelledBy;
      await sendCancellationEmail(appt);
      emailSent = true;
    } catch (err) {
      console.error('Cancellation email failed for appt ' + id + ':', err.message);
      emailError = err.message;
    }
  }

  res.json({ ok: true, email_sent: emailSent, email_error: emailError });
});

// Process queued emails (called by background job in server.js).
// Groups by batch_id so multi-visit bookings get a single batched email.
// SECURITY: re-entrancy guard. The interval fires every 60s; if SMTP sends
// take longer than 60s the next tick selects the same email_sent=0 rows and
// double-sends. Module-level _emailJobRunning guards against overlap.
// (See also: project memory "no double sends".)
let _emailJobRunning = false;
async function sendPendingEmails() {
  if (_emailJobRunning) return;
  if (!sendAppointmentEmail || isQuietHours()) return;
  _emailJobRunning = true;
  try { return await _sendPendingEmailsInner(); }
  finally { _emailJobRunning = false; }
}

async function _sendPendingEmailsInner() {
  const pending = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.address as customer_address,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN employees e ON e.id = a.employee_id JOIN services s ON s.id = a.service_id
    WHERE a.email_sent = 0 AND a.status = 'scheduled'
    ORDER BY a.start_time
  `).all();

  const batches = new Map();
  const singles = [];
  for (const appt of pending) {
    attachDogInfo(appt);
    if (appt.batch_id) {
      if (!batches.has(appt.batch_id)) batches.set(appt.batch_id, []);
      batches.get(appt.batch_id).push(appt);
    } else {
      singles.push(appt);
    }
  }

  const markSent = db.prepare('UPDATE appointments SET email_sent = 1 WHERE id = ?');

  for (const [batchId, appts] of batches) {
    if (!sendBatchAppointmentEmail) break;
    try {
      await sendBatchAppointmentEmail(appts);
      const tx = db.transaction(() => { for (const a of appts) markSent.run(a.id); });
      tx();
      console.log('Sent queued batch email ' + batchId + ' (' + appts.length + ' visits)');
    } catch (err) {
      console.error('Queued batch email failed for ' + batchId + ':', err.message);
    }
  }

  for (const appt of singles) {
    try {
      await sendAppointmentEmail(appt);
      markSent.run(appt.id);
      console.log('Sent queued email for appointment ' + appt.id);
    } catch (err) {
      console.error('Queued email failed for appointment ' + appt.id + ':', err.message);
    }
  }
}

module.exports = router;
module.exports.sendPendingEmails = sendPendingEmails;
