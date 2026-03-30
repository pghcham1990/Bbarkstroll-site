const express = require('express');
const router = express.Router();
const db = require('../lib/db');

let sendAppointmentEmail;
try { sendAppointmentEmail = require('../lib/email').sendAppointmentEmail; } catch { sendAppointmentEmail = null; }

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

// Delete appointment (hard delete)
router.delete('/appointments/:id', (req, res) => {
  db.prepare('DELETE FROM appointment_dogs WHERE appointment_id = ?').run(req.params.id);
  db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Process queued emails (called by background job in server.js)
async function sendPendingEmails() {
  if (!sendAppointmentEmail || isQuietHours()) return;
  const pending = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.address as customer_address,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN employees e ON e.id = a.employee_id JOIN services s ON s.id = a.service_id
    WHERE a.email_sent = 0 AND a.status = 'scheduled'
  `).all();
  for (const appt of pending) {
    try {
      attachDogInfo(appt);
      await sendAppointmentEmail(appt);
      db.prepare('UPDATE appointments SET email_sent = 1 WHERE id = ?').run(appt.id);
      console.log('Sent queued email for appointment ' + appt.id);
    } catch (err) {
      console.error('Queued email failed for appointment ' + appt.id + ':', err.message);
    }
  }
}

module.exports = router;
module.exports.sendPendingEmails = sendPendingEmails;
