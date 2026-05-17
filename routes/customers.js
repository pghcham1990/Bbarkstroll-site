const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// List customers (with optional search)
// Extra computed fields per row:
//   dog_count        — count of dogs on file
//   note_count       — count of customer_notes timeline entries (used to infer "replied" for prospects)
//   last_service_at  — most recent past appointment (status != cancelled, start_time <= now); null = never used us
//   out_of_area      — 1 if prospect notes carry the [OUT OF AREA] tag written by the public contact form
router.get('/customers', (req, res) => {
  try {
    const q = req.query.q;
    const baseSelect = `
      SELECT
        c.*,
        COUNT(DISTINCT d.id) AS dog_count,
        COUNT(DISTINCT n.id) AS note_count,
        MAX(CASE WHEN a.status != 'cancelled' AND a.start_time <= datetime('now') THEN a.start_time END) AS last_service_at,
        CASE WHEN c.notes LIKE '[OUT OF AREA]%' THEN 1 ELSE 0 END AS out_of_area
      FROM customers c
      LEFT JOIN dogs d ON d.customer_id = c.id
      LEFT JOIN customer_notes n ON n.customer_id = c.id
      LEFT JOIN appointments a ON a.customer_id = c.id
    `;
    let rows;
    if (q) {
      const like = `%${q}%`;
      rows = db.prepare(`
        ${baseSelect}
        WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
        GROUP BY c.id ORDER BY c.last_name, c.first_name
      `).all(like, like, like, like);
    } else {
      rows = db.prepare(`
        ${baseSelect}
        GROUP BY c.id ORDER BY c.last_name, c.first_name
      `).all();
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single customer + dogs
router.get('/customers/:id', (req, res) => {
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    customer.dogs = db.prepare('SELECT * FROM dogs WHERE customer_id = ? ORDER BY name').all(req.params.id);
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create customer
router.post('/customers', (req, res) => {
  try {
    const { first_name, last_name, email, phone, address, notes, status, rate } = req.body;
    if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name required' });
    const result = db.prepare(
      'INSERT INTO customers (first_name, last_name, email, phone, address, notes, status, rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(first_name, last_name, email || null, phone || null, address || null, notes || null, status || 'active', rate ? parseFloat(rate) : null);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update customer
router.put('/customers/:id', (req, res) => {
  try {
    const { first_name, last_name, email, phone, address, notes, status, rate } = req.body;
    if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name required' });
    db.prepare(
      "UPDATE customers SET first_name=?, last_name=?, email=?, phone=?, address=?, notes=?, status=?, rate=?, updated_at=datetime('now') WHERE id=?"
    ).run(first_name, last_name, email || null, phone || null, address || null, notes || null, status || 'active', rate ? parseFloat(rate) : null, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete customer
router.delete('/customers/:id', (req, res) => {
  try {
    const appts = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE customer_id=? AND status='scheduled'").get(req.params.id).c;
    if (appts > 0) return res.status(400).json({ error: 'Cannot delete customer with scheduled appointments' });
    db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Dogs ---

// List dogs for customer
router.get('/customers/:customerId/dogs', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM dogs WHERE customer_id = ? ORDER BY name').all(req.params.customerId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create dog
router.post('/customers/:customerId/dogs', (req, res) => {
  try {
    const { name, breed, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Dog name required' });
    const result = db.prepare(
      'INSERT INTO dogs (customer_id, name, breed, notes) VALUES (?, ?, ?, ?)'
    ).run(req.params.customerId, name, breed || null, notes || null);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update dog
router.put('/dogs/:id', (req, res) => {
  try {
    const { name, breed, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Dog name required' });
    db.prepare('UPDATE dogs SET name=?, breed=?, notes=? WHERE id=?').run(name, breed || null, notes || null, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete dog
router.delete('/dogs/:id', (req, res) => {
  try {
    const appts = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE dog_id=? AND status='scheduled'").get(req.params.id).c;
    if (appts > 0) return res.status(400).json({ error: 'Cannot delete dog with scheduled appointments' });
    db.prepare('DELETE FROM dogs WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
