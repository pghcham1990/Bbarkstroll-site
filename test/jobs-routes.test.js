// test/jobs-routes.test.js
const { test, before } = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path'); const fs = require('fs');

let db, jobsLogic;
before(() => {
  const tmp = path.join(os.tmpdir(), `bs-jobs-routes-${process.pid}.db`);
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  process.env.BARKSTROLL_DB_PATH = tmp;
  db = require('../lib/db');
  // minimal schema
  db.prepare('CREATE TABLE customers (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, address TEXT)').run();
  db.prepare('CREATE TABLE dogs (id INTEGER PRIMARY KEY, customer_id INTEGER, name TEXT)').run();
  db.prepare('CREATE TABLE employees (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, active INTEGER DEFAULT 1)').run();
  db.prepare('CREATE TABLE documents (id INTEGER PRIMARY KEY, customer_id INTEGER, type TEXT, doc_number TEXT)').run();
  db.prepare(`CREATE TABLE appointments (id INTEGER PRIMARY KEY, customer_id INTEGER, dog_id INTEGER, employee_id INTEGER, service_id INTEGER, start_time TEXT, end_time TEXT, status TEXT DEFAULT 'scheduled', notes TEXT, email_sent INTEGER DEFAULT 0, batch_id TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`).run();
  require('../migrate-jobs').migrate(db);
  // seed
  db.prepare("INSERT INTO customers (id, first_name, last_name, address) VALUES (20,'Cris','OConnor','McDonald PA')").run();
  db.prepare("INSERT INTO dogs (id, customer_id, name) VALUES (24,20,'Maggie')").run();
  db.prepare("INSERT INTO employees (id, first_name, last_name) VALUES (2,'Scott','Rocca'),(6,'Tiffany','Condupa')").run();
  const visits = JSON.stringify([
    { date:'2026-07-16', time:'3:00 PM', label:'Afternoon Visit' },
    { date:'2026-07-16', time:'9:00 PM', label:'Evening Visit' },
    { date:'2026-07-17', time:'8:00 AM', label:'Morning Visit' },
  ]);
  db.prepare("INSERT INTO documents (id, customer_id, type, doc_number, visits_json) VALUES (10,20,'proposal','#BBS-2026-0716',?)").run(visits);
  jobsLogic = require('../routes/jobs')._internals; // pure handlers exposed for testing
});

test('createJobForDocument: builds one assignment per distinct date', () => {
  const job = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  assert.ok(job.id);
  assert.strictEqual(job.assignments.length, 2); // 2026-07-16 and 2026-07-17
  assert.strictEqual(job.assignments.every(a => a.employee_id == null), true);
});

test('createJobForDocument: idempotent — second call returns same job', () => {
  const a = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  const b = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM jobs WHERE document_id=10').get().n, 1);
});

test('setAssignment: assigns then clears a day', () => {
  const job = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  jobsLogic.setAssignment(db, job.id, '2026-07-16', 6);
  let view = jobsLogic.getJobView(db, job.id);
  assert.strictEqual(view.fill.filled, 1);
  jobsLogic.setAssignment(db, job.id, '2026-07-16', null);
  view = jobsLogic.getJobView(db, job.id);
  assert.strictEqual(view.fill.filled, 0);
});

test('assignAll: fills only open days', () => {
  const job = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  jobsLogic.setAssignment(db, job.id, '2026-07-16', 6); // pre-assign one
  jobsLogic.assignAllOpen(db, job.id, 2);
  const view = jobsLogic.getJobView(db, job.id);
  assert.strictEqual(view.fill.complete, true);
  const sixteenth = view.assignments.find(a => a.date === '2026-07-16');
  assert.strictEqual(sixteenth.employee_id, 6, 'pre-assigned day not overwritten');
});

test('postJob: rejected unless 100% filled', () => {
  const job = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  assert.throws(() => jobsLogic.postJob(db, job.id), /not fully staffed/i);
});

test('postJob: creates one appointment per visit + walker summary, marks posted', () => {
  const job = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  jobsLogic.assignAllOpen(db, job.id, 2); // Scott on all days
  const result = jobsLogic.postJob(db, job.id);
  const appts = db.prepare('SELECT * FROM appointments WHERE batch_id=?').all(result.batch_id);
  assert.strictEqual(appts.length, 3, 'one appointment per visit');
  assert.strictEqual(appts.every(a => a.email_sent === 1), true, 'silent — no auto-email');
  assert.strictEqual(appts.every(a => a.service_id === 5), true, 'Custom Care');
  assert.strictEqual(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id).status, 'posted');
  assert.ok(result.walkerSummary.length >= 1);
});

test('postJob: cannot post twice', () => {
  const job = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  jobsLogic.assignAllOpen(db, job.id, 2);
  jobsLogic.postJob(db, job.id);
  assert.throws(() => jobsLogic.postJob(db, job.id), /already posted/i);
});

test('setAssignment: rejects employee_id=0 (treated as open, not "filled")', () => {
  const job = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  jobsLogic.setAssignment(db, job.id, '2026-07-16', 0); // invalid sentinel
  const view = jobsLogic.getJobView(db, job.id);
  const sixteenth = view.assignments.find(a => a.date === '2026-07-16');
  assert.strictEqual(sixteenth.employee_id, null, '0 normalized to null (open)');
  assert.strictEqual(view.fill.filled, 0, 'a 0 does not count as filled');
});

test('postJob: each day posts with its OWN walker (not one for all)', () => {
  const job = jobsLogic.createJobForDocument(db, { customer_id: 20, document_id: 10 });
  jobsLogic.setAssignment(db, job.id, '2026-07-16', 6); // Tiffany
  jobsLogic.setAssignment(db, job.id, '2026-07-17', 2); // Scott
  const result = jobsLogic.postJob(db, job.id);
  const appts = db.prepare('SELECT start_time, employee_id FROM appointments WHERE batch_id=?').all(result.batch_id);
  const on16 = appts.filter(a => a.start_time.slice(0, 10) === '2026-07-16');
  const on17 = appts.filter(a => a.start_time.slice(0, 10) === '2026-07-17');
  assert.strictEqual(on16.length, 2);
  assert.ok(on16.every(a => a.employee_id === 6), '16th = Tiffany');
  assert.strictEqual(on17.length, 1);
  assert.strictEqual(on17[0].employee_id, 2, '17th = Scott');
});
