const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS employee_documents (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
     doc_type      TEXT    NOT NULL DEFAULT 'w9',
     original_name TEXT    NOT NULL,
     mime_type     TEXT    NOT NULL,
     byte_size     INTEGER NOT NULL,
     stored_file   TEXT    NOT NULL,
     iv_hex        TEXT    NOT NULL,
     tag_hex       TEXT    NOT NULL,
     uploaded_at   TEXT    NOT NULL DEFAULT (datetime('now')),
     uploaded_by   TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS employee_document_access (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     document_id INTEGER NOT NULL REFERENCES employee_documents(id) ON DELETE CASCADE,
     action      TEXT    NOT NULL,
     actor       TEXT,
     at          TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_empdocs_employee ON employee_documents(employee_id)`,
];

function migrate(database) {
  for (const sql of STATEMENTS) database.prepare(sql).run();
}

if (require.main === module) {
  const db = require('./lib/db');
  migrate(db);
  console.log('Migrated: employee_documents, employee_document_access');
}

module.exports = { migrate };
