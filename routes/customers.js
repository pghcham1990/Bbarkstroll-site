const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// List customers (with optional search)
router.get('/customers', (req, res) => {
  const q = req.query.q;
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT c.*, COUNT(d.id) as dog_count FROM customers c
      LEFT JOIN dogs d ON d.customer_id = c.id
      WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
      GROUP BY c.id ORDER BY c.last_name, c.first_name
    `).all(like, like, like, like);
  } else {
    rows = db.prepare(`
      SELECT c.*, COUNT(d.id) as dog_count FROM customers c
      LEFT JOIN dogs d ON d.customer_id = c.id
      GROUP BY c.id ORDER BY c.last_name, c.first_name
    `).all();
  }
  res.json(rows);
});

// Get single customer + dogs
router.get('/customers/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  customer.dogs = db.prepare('SELECT * FROM dogs WHERE customer_id = ? ORDER BY name').all(req.params.id);
  res.json(customer);
});

// Create customer
router.post('/customers', (req, res) => {
  const { first_name, last_name, email, phone, address, notes } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name required' });
  const result = db.prepare(
    'INSERT INTO customers (first_name, last_name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(first_name, last_name, email || null, phone || null, address || null, notes || null);
  res.json({ ok: true, id: result.lastInsertRowid });
});

// Update customer
router.put('/customers/:id', (req, res) => {
  const { first_name, last_name, email, phone, address, notes } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name required' });
  db.prepare(
    "UPDATE customers SET first_name=?, last_name=?, email=?, phone=?, address=?, notes=?, updated_at=datetime('now') WHERE id=?"
  ).run(first_name, last_name, email || null, phone || null, address || null, notes || null, req.params.id);
  res.json({ ok: true });
});

// Delete customer
router.delete('/customers/:id', (req, res) => {
  const appts = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE customer_id=? AND status='scheduled'").get(req.params.id).c;
  if (appts > 0) return res.status(400).json({ error: 'Cannot delete customer with scheduled appointments' });
  db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// --- Dogs ---

// List dogs for customer
router.get('/customers/:customerId/dogs', (req, res) => {
  const rows = db.prepare('SELECT * FROM dogs WHERE customer_id = ? ORDER BY name').all(req.params.customerId);
  res.json(rows);
});

// Create dog
router.post('/customers/:customerId/dogs', (req, res) => {
  const { name, breed, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Dog name required' });
  const result = db.prepare(
    'INSERT INTO dogs (customer_id, name, breed, notes) VALUES (?, ?, ?, ?)'
  ).run(req.params.customerId, name, breed || null, notes || null);
  res.json({ ok: true, id: result.lastInsertRowid });
});

// Update dog
router.put('/dogs/:id', (req, res) => {
  const { name, breed, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Dog name required' });
  db.prepare('UPDATE dogs SET name=?, breed=?, notes=? WHERE id=?').run(name, breed || null, notes || null, req.params.id);
  res.json({ ok: true });
});

// Delete dog
router.delete('/dogs/:id', (req, res) => {
  const appts = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE dog_id=? AND status='scheduled'").get(req.params.id).c;
  if (appts > 0) return res.status(400).json({ error: 'Cannot delete dog with scheduled appointments' });
  db.prepare('DELETE FROM dogs WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
