const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// Which gallery photo is this client's avatar (null = colored initial). Set on gallery upload.
try { db.prepare('ALTER TABLE customers ADD COLUMN avatar_photo_id INTEGER').run(); } catch (e) { /* already exists */ }

// Loyalty gifts: one earned every 25 completed visits, logged per client when given.
// gift_number 1 = the 25-visit milestone, 2 = 50, etc. given_at is an Eastern YYYY-MM-DD date.
db.prepare(`CREATE TABLE IF NOT EXISTS customer_gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  gift_number INTEGER NOT NULL,
  description TEXT,
  given_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`).run();

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
        COUNT(DISTINCT CASE WHEN a.status = 'completed' AND COALESCE(sv.name,'') <> 'Meet & Greet' THEN a.id END) AS completed_count,
        COUNT(DISTINCT CASE WHEN a.status IN ('completed','scheduled') AND COALESCE(sv.name,'') <> 'Meet & Greet' THEN a.id END) AS booked_count,
        COALESCE(c.rate, 0) * COUNT(DISTINCT CASE WHEN a.status IN ('completed','scheduled') AND COALESCE(sv.name,'') <> 'Meet & Greet' THEN a.id END) AS lifetime_revenue,
        MAX(CASE WHEN a.status != 'cancelled' AND a.start_time <= datetime('now') THEN a.start_time END) AS last_service_at,
        (SELECT COUNT(*) FROM customer_gifts g WHERE g.customer_id = c.id) AS gifts_given,
        CASE WHEN c.notes LIKE '[OUT OF AREA]%' THEN 1 ELSE 0 END AS out_of_area,
        (SELECT '/gallery/img/' || thumb_filename FROM gallery_photos WHERE id = c.avatar_photo_id) AS avatar_url
      FROM customers c
      LEFT JOIN dogs d ON d.customer_id = c.id
      LEFT JOIN customer_notes n ON n.customer_id = c.id
      LEFT JOIN appointments a ON a.customer_id = c.id
      LEFT JOIN services sv ON sv.id = a.service_id
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
    const customer = db.prepare(`
      SELECT c.*,
        (SELECT '/gallery/img/' || thumb_filename FROM gallery_photos WHERE id = c.avatar_photo_id) AS avatar_url
      FROM customers c WHERE c.id = ?
    `).get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    customer.dogs = db.prepare('SELECT * FROM dogs WHERE customer_id = ? ORDER BY name').all(req.params.id);

    // Spend pace: average visits per active week (Eastern), times the client's rate.
    // Active week = a distinct Mon-anchored week with at least one non-cancelled visit.
    const rate = customer.rate || 0;
    // Meet & Greets are unpaid intro visits — never count toward value/loyalty metrics.
    const visits = db.prepare(
      "SELECT a.start_time FROM appointments a LEFT JOIN services s ON s.id = a.service_id WHERE a.customer_id = ? AND a.status IN ('completed','scheduled') AND COALESCE(s.name,'') <> 'Meet & Greet'"
    ).all(req.params.id);
    const completed = db.prepare(
      "SELECT COUNT(*) c FROM appointments a LEFT JOIN services s ON s.id = a.service_id WHERE a.customer_id = ? AND a.status = 'completed' AND COALESCE(s.name,'') <> 'Meet & Greet'"
    ).get(req.params.id).c;
    const weekSet = new Set();
    for (const v of visits) {
      const et = new Date(new Date(v.start_time).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dow = (et.getDay() + 6) % 7;
      et.setDate(et.getDate() - dow);
      weekSet.add(`${et.getFullYear()}-${et.getMonth() + 1}-${et.getDate()}`);
    }
    const activeWeeks = Math.max(1, weekSet.size);
    const visitsPerWeek = visits.length / activeWeeks;
    customer.completed_count = completed;
    customer.booked_count = visits.length;
    customer.lifetime_revenue = rate * visits.length;
    customer.gifts = db.prepare('SELECT * FROM customer_gifts WHERE customer_id = ? ORDER BY gift_number, id').all(req.params.id);
    customer.gifts_given = customer.gifts.length;
    customer.pace = {
      visits_per_week: visitsPerWeek,
      per_week: visitsPerWeek * rate,
      per_month: visitsPerWeek * rate * 4.333,
      per_year: visitsPerWeek * rate * 52,
    };
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

// --- Loyalty gifts ---

// Log a gift handed to a client. gift_number defaults to the next un-logged milestone.
router.post('/customers/:id/gifts', (req, res) => {
  try {
    const cust = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
    if (!cust) return res.status(404).json({ error: 'Customer not found' });
    const { description, given_at, gift_number } = req.body;
    const given = db.prepare('SELECT COUNT(*) c FROM customer_gifts WHERE customer_id = ?').get(req.params.id).c;
    const num = gift_number ? parseInt(gift_number, 10) : given + 1;
    const date = (given_at || '').trim() || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const result = db.prepare(
      'INSERT INTO customer_gifts (customer_id, gift_number, description, given_at) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, num, (description || '').trim() || null, date);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a logged gift (undo).
router.delete('/gifts/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM customer_gifts WHERE id = ?').run(req.params.id);
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
    const { name, breed, notes, walker_instructions } = req.body;
    if (!name) return res.status(400).json({ error: 'Dog name required' });
    const result = db.prepare(
      'INSERT INTO dogs (customer_id, name, breed, notes, walker_instructions) VALUES (?, ?, ?, ?, ?)'
    ).run(req.params.customerId, name, breed || null, notes || null, walker_instructions || null);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update dog
router.put('/dogs/:id', (req, res) => {
  try {
    const { name, breed, notes, walker_instructions } = req.body;
    if (!name) return res.status(400).json({ error: 'Dog name required' });
    db.prepare('UPDATE dogs SET name=?, breed=?, notes=?, walker_instructions=? WHERE id=?').run(name, breed || null, notes || null, walker_instructions || null, req.params.id);
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
