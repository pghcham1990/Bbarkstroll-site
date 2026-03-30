require('dotenv').config();
const db = require('./lib/db');

// Create customer_notes table
db.exec(`
  CREATE TABLE IF NOT EXISTS customer_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id);
`);

console.log('Created customer_notes table');

// Migrate existing notes
const customers = db.prepare("SELECT id, first_name, last_name, notes FROM customers WHERE notes IS NOT NULL AND notes != ''").all();

const insert = db.prepare('INSERT INTO customer_notes (customer_id, text, created_at) VALUES (?, ?, ?)');

for (const c of customers) {
  const notes = c.notes.trim();
  if (!notes) continue;

  // Try to split on date patterns: "3/25/2026:", "03/14/2026 -", or double newlines
  // First, try splitting on date-prefixed entries
  const datePattern = /(?:^|\n\n)(\d{1,2}\/\d{1,2}\/\d{4})\s*[:\-\u2013]\s*/;
  const parts = notes.split(/\n\n/);

  const entries = [];
  let currentEntry = null;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check if this part starts with a date
    const dateMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[:\-\u2013]\s*(.*)/s);
    if (dateMatch) {
      const [, month, day, year, text] = dateMatch;
      const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T12:00:00`;
      entries.push({ text: text.trim(), date: isoDate });
    } else {
      // No date prefix — use a generic early date or group with previous
      // If it's the first entry, treat as the earliest note
      entries.push({ text: trimmed, date: null });
    }
  }

  // For entries without dates, assign them the customer's created_at or a default
  const customerCreated = db.prepare('SELECT created_at FROM customers WHERE id = ?').get(c.id);
  const defaultDate = customerCreated?.created_at || '2026-01-01T12:00:00';

  for (const entry of entries) {
    insert.run(c.id, entry.text, entry.date || defaultDate);
  }

  console.log(`Migrated ${entries.length} notes for ${c.first_name} ${c.last_name}`);
}

console.log('Migration complete');
