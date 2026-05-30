// migrate-jobs.js — idempotent. Adds proposal visit storage + job staffing tables.
function columnExists(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

function migrate(database) {
  // 1. Structured visit data on proposals/invoices (nullable; backfilled separately)
  if (!columnExists(database, 'documents', 'visits_json')) {
    database.prepare(`ALTER TABLE documents ADD COLUMN visits_json TEXT`).run();
  }

  // 2. One job per staffed proposal
  database.prepare(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'draft',
      gcal_synced INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  // 3. One row per day; employee_id null = open
  database.prepare(`
    CREATE TABLE IF NOT EXISTS job_assignments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      date        TEXT    NOT NULL,
      employee_id INTEGER,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  database.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_document ON jobs(document_id)`).run();
  database.prepare(`CREATE INDEX IF NOT EXISTS idx_jobassign_job ON job_assignments(job_id)`).run();
}

if (require.main === module) {
  const db = require('./lib/db');
  migrate(db);
  console.log('Migrated: documents.visits_json, jobs, job_assignments');
}

module.exports = { migrate };
