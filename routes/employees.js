const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// List employees
router.get('/employees', (req, res) => {
  const active = req.query.active;
  let rows;
  if (active !== undefined) {
    rows = db.prepare('SELECT * FROM employees WHERE active = ? ORDER BY last_name, first_name').all(Number(active));
  } else {
    rows = db.prepare('SELECT * FROM employees ORDER BY active DESC, last_name, first_name').all();
  }
  res.json(rows);
});

// Get single employee
router.get('/employees/:id', (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  res.json(emp);
});

// Create employee
router.post('/employees', (req, res) => {
  const { first_name, last_name, email, phone } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name required' });
  const result = db.prepare(
    'INSERT INTO employees (first_name, last_name, email, phone) VALUES (?, ?, ?, ?)'
  ).run(first_name, last_name, email || null, phone || null);
  res.json({ ok: true, id: result.lastInsertRowid });
});

// Update employee
router.put('/employees/:id', (req, res) => {
  const { first_name, last_name, email, phone, active } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name required' });
  db.prepare('UPDATE employees SET first_name=?, last_name=?, email=?, phone=?, active=? WHERE id=?').run(
    first_name, last_name, email || null, phone || null, active !== undefined ? Number(active) : 1, req.params.id
  );
  res.json({ ok: true });
});

// Deactivate employee (soft delete)
router.delete('/employees/:id', (req, res) => {
  db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
