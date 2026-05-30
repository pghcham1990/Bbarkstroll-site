// test/jobs-migration.test.js
const { test, before } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

let db;
before(() => {
  const tmp = path.join(os.tmpdir(), `bs-jobs-mig-${process.pid}.db`);
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  process.env.BARKSTROLL_DB_PATH = tmp;
  db = require('../lib/db');
  // jobs tables reference customers/documents; create minimal stand-ins so FKs resolve
  db.prepare('CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY)').run();
  db.prepare('CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, type TEXT)').run();
  require('../migrate-jobs').migrate(db);
});

test('documents gains a visits_json column', () => {
  const cols = db.prepare('PRAGMA table_info(documents)').all().map(c => c.name);
  assert.ok(cols.includes('visits_json'), 'visits_json column added');
});

test('jobs and job_assignments tables exist with expected columns', () => {
  const jobCols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  for (const c of ['id','customer_id','document_id','status','gcal_synced','created_at','updated_at']) {
    assert.ok(jobCols.includes(c), `jobs.${c}`);
  }
  const aCols = db.prepare('PRAGMA table_info(job_assignments)').all().map(c => c.name);
  for (const c of ['id','job_id','date','employee_id','created_at','updated_at']) {
    assert.ok(aCols.includes(c), `job_assignments.${c}`);
  }
});

test('migrate is idempotent (safe to run twice)', () => {
  assert.doesNotThrow(() => require('../migrate-jobs').migrate(db));
});
