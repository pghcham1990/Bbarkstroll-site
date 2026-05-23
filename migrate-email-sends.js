// Per-recipient email idempotency. Each appointment/batch emails up to 3
// recipients (client, walker, owner). Recording each successful send lets a
// retry re-send ONLY the recipients that haven't gone yet, instead of
// re-blasting everyone when one recipient's send failed.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS email_sends (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     scope_type     TEXT NOT NULL,            -- 'appt' | 'batch'
     scope_id       TEXT NOT NULL,            -- appointment id or batch id
     recipient_role TEXT NOT NULL,            -- 'customer' | 'employee' | 'owner' | 'client' | 'walker'
     recipient_email TEXT,
     sent_at        TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE(scope_type, scope_id, recipient_role)
   )`,
];

function migrate(database) {
  for (const sql of STATEMENTS) database.prepare(sql).run();
}

if (require.main === module) {
  const db = require('./lib/db');
  migrate(db);
  console.log('Migrated: email_sends');
}

module.exports = { migrate };
