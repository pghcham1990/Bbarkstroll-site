const express = require('express');
const router = express.Router();
const db = require('../lib/db');

let sendAppointmentEmail;
try { sendAppointmentEmail = require('../lib/email').sendAppointmentEmail; } catch { sendAppointmentEmail = null; }

// List appointments with optional date range and filters
router.get('/appointments', (req, res) => {
  const { start, end, employee_id, customer_id } = req.query;
  let sql = `
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
      d.name as dog_name, d.breed as dog_breed,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name, s.duration_min as service_duration
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN dogs d ON d.id = a.dog_id
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
  res.json(db.prepare(sql).all(...params));
});

// Get single appointment
router.get('/appointments/:id', (req, res) => {
  const row = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
      d.name as dog_name, d.breed as dog_breed,
      e.first_name || ' ' || e.last_name as employee_name, e.email as employee_email,
      s.name as service_name, s.duration_min as service_duration
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN dogs d ON d.id = a.dog_id
    JOIN employees e ON e.id = a.employee_id
    JOIN services s ON s.id = a.service_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Create appointment
router.post('/appointments', async (req, res) => {
  const { customer_id, dog_id, employee_id, service_id, start_time, end_time, notes } = req.body;
  if (!customer_id || !dog_id || !employee_id || !service_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const result = db.prepare(
    'INSERT INTO appointments (customer_id, dog_id, employee_id, service_id, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(customer_id, dog_id, employee_id, service_id, start_time, end_time, notes || null);

  const apptId = result.lastInsertRowid;

  // Send email notification
  let emailSent = false;
  if (sendAppointmentEmail) {
    try {
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
      `).get(apptId);
      await sendAppointmentEmail(appt);
      db.prepare('UPDATE appointments SET email_sent = 1 WHERE id = ?').run(apptId);
      emailSent = true;
    } catch (err) {
      console.error('Email send failed:', err.message);
    }
  }

  res.json({ ok: true, id: apptId, email_sent: emailSent });
});

// Update appointment
router.put('/appointments/:id', (req, res) => {
  const { customer_id, dog_id, employee_id, service_id, start_time, end_time, notes, status } = req.body;
  db.prepare(
    "UPDATE appointments SET customer_id=?, dog_id=?, employee_id=?, service_id=?, start_time=?, end_time=?, notes=?, status=?, updated_at=datetime('now') WHERE id=?"
  ).run(customer_id, dog_id, employee_id, service_id, start_time, end_time, notes || null, status || 'scheduled', req.params.id);
  res.json({ ok: true });
});

// Cancel appointment
router.delete('/appointments/:id', (req, res) => {
  db.prepare("UPDATE appointments SET status='cancelled', updated_at=datetime('now') WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
