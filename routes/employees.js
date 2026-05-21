const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// Flat contractor pay per completed 30-min visit. Drives the $600 IRS 1099-NEC
// reporting threshold for 'contractor' crew. (The dashboard earnings widget uses a
// separate house-cut model; this figure is specifically what we PAY the walker.)
const WALKER_PAY_PER_VISIT = 20;
const IRS_1099_THRESHOLD = 600;

// Year-to-date count of completed, billable (non Meet & Greet) visits per employee.
function ytdVisits(employeeId, year) {
  return db.prepare(`
    SELECT COUNT(*) c FROM appointments a
    LEFT JOIN services s ON s.id = a.service_id
    WHERE a.employee_id = ? AND a.status = 'completed'
      AND a.start_time >= ? AND a.start_time < ?
      AND COALESCE(s.name, '') <> 'Meet & Greet'
  `).get(employeeId, `${year}-01-01`, `${year + 1}-01-01`).c;
}

function decorate(rows) {
  const year = new Date().getFullYear();
  const w9Stmt = db.prepare(
    "SELECT 1 FROM employee_documents WHERE employee_id = ? AND doc_type = 'w9' LIMIT 1"
  );
  for (const e of rows) {
    e.has_w9 = !!w9Stmt.get(e.id);
    if (e.crew_type === 'contractor') {
      const visits = ytdVisits(e.id, year);
      e.ytd_visits = visits;
      e.ytd_paid = visits * WALKER_PAY_PER_VISIT;
      e.over_1099_threshold = e.ytd_paid >= IRS_1099_THRESHOLD;
    }
  }
  return rows;
}

// List employees
router.get('/employees', (req, res) => {
  const active = req.query.active;
  let rows;
  if (active !== undefined) {
    rows = db.prepare('SELECT * FROM employees WHERE active = ? ORDER BY last_name, first_name').all(Number(active));
  } else {
    rows = db.prepare('SELECT * FROM employees ORDER BY active DESC, last_name, first_name').all();
  }
  res.json(decorate(rows));
});

// Get single employee
router.get('/employees/:id', (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  res.json(emp);
});

// Create employee
router.post('/employees', (req, res) => {
  const { first_name, last_name, email, phone, crew_type } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name required' });
  const crew = crew_type === 'core' ? 'core' : 'contractor'; // new hires default to 1099 contractor
  const result = db.prepare(
    'INSERT INTO employees (first_name, last_name, email, phone, crew_type) VALUES (?, ?, ?, ?, ?)'
  ).run(first_name, last_name, email || null, phone || null, crew);
  res.json({ ok: true, id: result.lastInsertRowid });
});

// Update employee
router.put('/employees/:id', (req, res) => {
  const { first_name, last_name, email, phone, active, crew_type } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name required' });
  const crew = crew_type === 'core' ? 'core' : (crew_type === 'contractor' ? 'contractor' : null);
  db.prepare('UPDATE employees SET first_name=?, last_name=?, email=?, phone=?, active=?, crew_type=COALESCE(?, crew_type) WHERE id=?').run(
    first_name, last_name, email || null, phone || null, active !== undefined ? Number(active) : 1, crew, req.params.id
  );
  res.json({ ok: true });
});

// Deactivate employee (soft delete)
router.delete('/employees/:id', (req, res) => {
  db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
