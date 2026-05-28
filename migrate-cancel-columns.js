'use strict';

// Adds cancelled_at and cancelled_by columns to appointments. Both nullable,
// no default, no backfill. Safe to run repeatedly — checks pragma first.
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(appointments)').all().map(c => c.name);
  if (!cols.includes('cancelled_at')) {
    db.exec('ALTER TABLE appointments ADD COLUMN cancelled_at TEXT');
  }
  if (!cols.includes('cancelled_by')) {
    db.exec('ALTER TABLE appointments ADD COLUMN cancelled_by TEXT');
  }
}

module.exports = { migrate };

if (require.main === module) {
  const db = require('./lib/db');
  migrate(db);
  console.log('migrate-cancel-columns: done');
  db.close();
}
