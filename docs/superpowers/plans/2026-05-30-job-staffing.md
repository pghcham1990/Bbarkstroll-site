# Job Staffing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a saved Bark & Stroll proposal into a staffable job — assign a walker per day, track fill %, and (only when 100% filled + Scott clicks Post) create the appointments and hand Scott a walker summary.

**Architecture:** An idempotent boot migration adds `documents.visits_json` + `jobs` + `job_assignments` tables. A pure, unit-tested logic module (`lib/jobs-logic.js`) computes day-rows from visits, fill status, conflict flags, and the walker summary. A new `routes/jobs.js` exposes create/get/patch/assign-all/post endpoints. A Job panel renders on the customer card.

**Tech Stack:** Node + Express, better-sqlite3, `node --test`, vanilla JS frontend (`public/js/`).

---

## Pre-flight (read before Task 1)

- **Working dir:** `/opt/barkstroll`, branch **master** (served live; work in place, commit per task).
- **⚠️ Dirty tree:** never `git add -A`. Stage only the files each task names; run `git status` + `git diff --cached` before every commit.
- **Test runner:** `npm test` runs `node --test` over `test/*.test.js`. Tests set `process.env.BARKSTROLL_DB_PATH` to a tmp file BEFORE requiring `../lib/db` (see `test/employee-documents.test.js` / `test/cancel-email.test.js`).
- **Migration pattern (copy this):** `migrate-employee-documents.js` — a `STATEMENTS` array of `CREATE TABLE IF NOT EXISTS` / `ALTER`-safe statements, a `migrate(database)` that runs each, a `if (require.main === module)` standalone runner, and `module.exports = { migrate }`. Boot calls it in `server.js:33`: `require('./migrate-employee-documents').migrate(require('./lib/db'));`.
- **Key existing facts:**
  - `lib/db.js` is just the connection (exports the `db`). Schema lives in `init-db.js` + `migrate-*.js`.
  - `documents` insert is `routes/documents.js:366` (cols: customer_id, type, doc_number, file_id, filename, html_content, conversation, status).
  - Appointments batch insert pattern: `routes/appointments.js:153` (`db.transaction`, INSERT with shared `batch_id`). Appointments with `email_sent = 1` are skipped by the background mailer (`sendPendingEmails`, selects `email_sent = 0`).
  - Employees: Shannon(1) Scott(2) Liz(3) Debra(4) Allison(5) Tiffany(6). Service **Custom Care = id 5**.
  - Router mounting: `server.js` mounts admin routers via `app.use('/admin/api', adminOnly, require('./routes/X'))`. Frontend calls them as `api('/jobs/...')` (the `/admin/api` prefix is added by the `api()` helper).
  - Frontend globals (in `public/js/app.js`): `api(path, opts)`, `toast(msg, type)`, `esc(s)`. Router: `render_<view>(mainEl)` keyed off the hash (`route()` at app.js:128). Customer detail + documents list rendered in `public/js/views/customers.js` (docs block ~line 327, the Invoice/Proposal buttons ~line 343).
- **Deliberate decision — Post does NOT auto-email:** the existing appointment flow emails client+walker. Cris hasn't confirmed and walkers route through Scott (no direct walker emails). So Post inserts appointments with `email_sent = 1` (silent — background mailer skips them) and returns a walker summary for Scott to forward. This satisfies the spec's "summary to Scott" notification decision and overrides the spec's looser "sends ICS" line. GCal push stays a manual `/mcp` step (job records `gcal_synced = 0`).
- **Safety copy:** `cp routes/documents.js /tmp/documents.js.pre-jobs && cp public/js/views/customers.js /tmp/customers.js.pre-jobs`.

---

## Task 1: Migration — visits_json + jobs + job_assignments

**Files:**
- Create: `migrate-jobs.js`
- Create: `test/jobs-migration.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd /opt/barkstroll && node --test test/jobs-migration.test.js`
Expected: FAIL — `Cannot find module '../migrate-jobs'`.

- [ ] **Step 3: Implement `migrate-jobs.js`**

```js
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
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd /opt/barkstroll && node --test test/jobs-migration.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire migration into boot**

In `server.js`, right after line 33 (`require('./migrate-employee-documents').migrate(...)`), add:

```js
require('./migrate-jobs').migrate(require('./lib/db')); // idempotent; ensures job staffing tables exist on every boot
```

Verify: `cd /opt/barkstroll && node --check server.js && echo OK` → `OK`.

- [ ] **Step 6: Commit**

```bash
cd /opt/barkstroll
git add migrate-jobs.js test/jobs-migration.test.js server.js
git diff --cached --stat
git commit -m "job staffing: migration — documents.visits_json + jobs + job_assignments

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pure staffing logic module

**Files:**
- Create: `lib/jobs-logic.js`
- Create: `test/jobs-logic.test.js`

This module is pure (no DB, no HTTP) so the staffing rules are fully unit-testable.

- [ ] **Step 1: Write the failing test**

```js
// test/jobs-logic.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  uniqueDates, fillStatus, hasConflict, buildWalkerSummary,
} = require('../lib/jobs-logic');

const CRIS_VISITS = [
  { date: '2026-07-16', time: '3:00 PM', label: 'Afternoon Visit' },
  { date: '2026-07-16', time: '9:00 PM', label: 'Evening Visit' },
  ...['17','18','19','20','21'].flatMap(d => [
    { date: `2026-07-${d}`, time: '8:00 AM', label: 'Morning Visit' },
    { date: `2026-07-${d}`, time: '3:00 PM', label: 'Afternoon Visit' },
    { date: `2026-07-${d}`, time: '9:00 PM', label: 'Evening Visit' },
  ]),
];

test('uniqueDates: distinct sorted dates from visits', () => {
  const dates = uniqueDates(CRIS_VISITS);
  assert.deepStrictEqual(dates, ['2026-07-16','2026-07-17','2026-07-18','2026-07-19','2026-07-20','2026-07-21']);
});

test('fillStatus: counts assigned vs total days', () => {
  const assignments = [
    { date: '2026-07-16', employee_id: 6 },
    { date: '2026-07-17', employee_id: null },
    { date: '2026-07-18', employee_id: 2 },
    { date: '2026-07-19', employee_id: 2 },
    { date: '2026-07-20', employee_id: null },
    { date: '2026-07-21', employee_id: null },
  ];
  const s = fillStatus(assignments);
  assert.strictEqual(s.total, 6);
  assert.strictEqual(s.filled, 3);
  assert.strictEqual(s.open, 3);
  assert.strictEqual(s.percent, 50);
  assert.strictEqual(s.complete, false);
});

test('fillStatus: 100% when all assigned', () => {
  const s = fillStatus([{ date: 'a', employee_id: 1 }, { date: 'b', employee_id: 2 }]);
  assert.strictEqual(s.percent, 100);
  assert.strictEqual(s.complete, true);
});

test('hasConflict: true when an existing appt falls on the same date', () => {
  // existing appts for the employee, as ISO start_times
  const existing = ['2026-07-17T19:00:00.000Z'];
  assert.strictEqual(hasConflict(existing, '2026-07-17'), true);
  assert.strictEqual(hasConflict(existing, '2026-07-18'), false);
  assert.strictEqual(hasConflict([], '2026-07-17'), false);
});

test('buildWalkerSummary: groups days by walker with their visit times', () => {
  const assignments = [
    { date: '2026-07-16', employee_id: 6, employee_name: 'Tiffany Condupa' },
    { date: '2026-07-18', employee_id: 2, employee_name: 'Scott Rocca' },
    { date: '2026-07-19', employee_id: 2, employee_name: 'Scott Rocca' },
  ];
  const summary = buildWalkerSummary(assignments, CRIS_VISITS, { customerName: "Cris O'Connor", dogNames: 'Maggie' });
  // one block per walker
  assert.strictEqual(summary.length, 2);
  const tiff = summary.find(w => w.employee_id === 6);
  assert.strictEqual(tiff.days.length, 1);
  assert.deepStrictEqual(tiff.days[0].times, ['3:00 PM', '9:00 PM']);
  const scott = summary.find(w => w.employee_id === 2);
  assert.strictEqual(scott.days.length, 2);
  assert.deepStrictEqual(scott.days[0].times, ['8:00 AM', '3:00 PM', '9:00 PM']);
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd /opt/barkstroll && node --test test/jobs-logic.test.js`
Expected: FAIL — `Cannot find module '../lib/jobs-logic'`.

- [ ] **Step 3: Implement `lib/jobs-logic.js`**

```js
'use strict';

// Distinct visit dates, ascending. visits = [{date,time,label}].
function uniqueDates(visits) {
  return [...new Set((visits || []).map(v => v.date))].sort((a, b) => a.localeCompare(b));
}

// The times for one date, in chronological order (reuses docgen-render's timeRank).
const { timeRank } = require('./docgen-render');
function timesForDate(visits, date) {
  return (visits || [])
    .filter(v => v.date === date)
    .sort((a, b) => timeRank(a.time) - timeRank(b.time))
    .map(v => v.time);
}

// assignments = [{date, employee_id|null}]. Day is filled when employee_id set.
function fillStatus(assignments) {
  const total = (assignments || []).length;
  const filled = (assignments || []).filter(a => a.employee_id != null).length;
  const open = total - filled;
  const percent = total === 0 ? 0 : Math.round((filled / total) * 100);
  return { total, filled, open, percent, complete: total > 0 && open === 0 };
}

// existingStarts = array of ISO start_time strings for ONE employee's other appts.
// Conflict = any existing appt on the same calendar date (YYYY-MM-DD prefix).
function hasConflict(existingStarts, date) {
  return (existingStarts || []).some(s => String(s).slice(0, 10) === date);
}

// Group assigned days by walker, attaching each day's visit times. Open days excluded.
function buildWalkerSummary(assignments, visits, meta = {}) {
  const byWalker = new Map();
  for (const a of assignments || []) {
    if (a.employee_id == null) continue;
    if (!byWalker.has(a.employee_id)) {
      byWalker.set(a.employee_id, {
        employee_id: a.employee_id,
        employee_name: a.employee_name || '',
        days: [],
      });
    }
    byWalker.get(a.employee_id).days.push({ date: a.date, times: timesForDate(visits, a.date) });
  }
  const out = [...byWalker.values()];
  for (const w of out) w.days.sort((x, y) => x.date.localeCompare(y.date));
  out.sort((a, b) => a.employee_id - b.employee_id);
  out.customerName = meta.customerName;  // harmless metadata for callers
  out.dogNames = meta.dogNames;
  return out;
}

module.exports = { uniqueDates, timesForDate, fillStatus, hasConflict, buildWalkerSummary };
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd /opt/barkstroll && node --test test/jobs-logic.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /opt/barkstroll
git add lib/jobs-logic.js test/jobs-logic.test.js
git commit -m "job staffing: pure logic module (dates, fill status, conflicts, walker summary)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Persist visits_json on save + backfill Cris

**Files:**
- Modify: `routes/documents.js` (the `/documents/save` insert, ~line 322 + 366)
- Create: `backfill-cris-visits.js` (one-shot)

- [ ] **Step 1: Add `visits_json` to the save endpoint**

In `routes/documents.js`, change the destructure at ~line 322 from:
```js
    const { customer_id, doc_type, html_content, conversation, doc_number } = req.body;
```
to:
```js
    const { customer_id, doc_type, html_content, conversation, doc_number, visits_json } = req.body;
```

Change the INSERT (~line 366) from:
```js
      INSERT INTO documents (customer_id, type, doc_number, file_id, filename, html_content, conversation, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'saved')
```
to:
```js
      INSERT INTO documents (customer_id, type, doc_number, file_id, filename, html_content, conversation, status, visits_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'saved', ?)
```

And add the bound value after `JSON.stringify(conversation || [])` in the `.run(...)` call:
```js
      JSON.stringify(conversation || []),
      visits_json ? JSON.stringify(typeof visits_json === 'string' ? JSON.parse(visits_json) : visits_json) : null
```

Verify: `cd /opt/barkstroll && node --check routes/documents.js && echo OK` → `OK`.

- [ ] **Step 2: Write the backfill for Cris's existing proposal**

```js
// backfill-cris-visits.js — one-shot. Cris's proposal (#BBS-2026-0716) predates visits_json.
const db = require('./lib/db');
const visits = [
  { date: '2026-07-16', time: '3:00 PM', label: 'Afternoon Visit' },
  { date: '2026-07-16', time: '9:00 PM', label: 'Evening Visit' },
];
for (const d of ['17','18','19','20','21']) {
  visits.push({ date: `2026-07-${d}`, time: '8:00 AM', label: 'Morning Visit' });
  visits.push({ date: `2026-07-${d}`, time: '3:00 PM', label: 'Afternoon Visit' });
  visits.push({ date: `2026-07-${d}`, time: '9:00 PM', label: 'Evening Visit' });
}
const row = db.prepare("SELECT id FROM documents WHERE customer_id=20 AND doc_number='#BBS-2026-0716'").get();
if (!row) { console.error('Cris proposal not found'); process.exit(1); }
db.prepare('UPDATE documents SET visits_json=? WHERE id=?').run(JSON.stringify(visits), row.id);
console.log('Backfilled doc', row.id, 'with', visits.length, 'visits');
```

- [ ] **Step 3: Run the backfill + verify**

```bash
cd /opt/barkstroll && node backfill-cris-visits.js
node -e "const db=require('./lib/db'); const r=db.prepare(\"SELECT id, json_array_length(visits_json) AS n FROM documents WHERE customer_id=20 AND doc_number='#BBS-2026-0716'\").get(); console.log(r);"
```
Expected: backfill prints `... with 17 visits`; verify prints `{ id: 10, n: 17 }` (id may differ).

- [ ] **Step 4: Commit**

```bash
cd /opt/barkstroll
git add routes/documents.js backfill-cris-visits.js
git diff --cached --stat
git commit -m "job staffing: persist visits_json on document save + backfill Cris proposal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Jobs API routes

**Files:**
- Create: `routes/jobs.js`
- Modify: `server.js` (mount the router)
- Create: `test/jobs-routes.test.js`

- [ ] **Step 1: Write the failing integration test**

```js
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
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd /opt/barkstroll && node --test test/jobs-routes.test.js`
Expected: FAIL — `Cannot find module '../routes/jobs'`.

- [ ] **Step 3: Implement `routes/jobs.js`**

The pure-ish DB handlers live in `_internals` (DB passed in) so the test can drive them without HTTP; the Express routes are thin wrappers over them using the shared `db`.

```js
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireRole } = require('../lib/auth');
const logic = require('../lib/jobs-logic');

const CUSTOM_CARE_SERVICE_ID = 5;
const VISIT_MINUTES = 30;

function newBatchId() {
  return 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function getDocVisits(database, documentId) {
  const doc = database.prepare('SELECT visits_json FROM documents WHERE id=?').get(documentId);
  if (!doc || !doc.visits_json) return [];
  try { return JSON.parse(doc.visits_json); } catch { return []; }
}

// Compute a visit's start/end ISO from its date + "8:00 AM" time string (treated as ET wall-clock).
// We store the literal local time as ISO without tz math — matches how existing appts are stored/displayed.
function visitToTimes(date, time) {
  const m = String(time).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let h = m ? parseInt(m[1], 10) % 12 : 12;
  if (m && /PM/i.test(m[3])) h += 12;
  const min = m ? parseInt(m[2], 10) : 0;
  const hh = String(h).padStart(2, '0'); const mm = String(min).padStart(2, '0');
  const start = `${date}T${hh}:${mm}:00.000Z`;
  const endDate = new Date(`${date}T${hh}:${mm}:00.000Z`);
  endDate.setUTCMinutes(endDate.getUTCMinutes() + VISIT_MINUTES);
  return { start_time: start, end_time: endDate.toISOString() };
}

function getJobView(database, jobId) {
  const job = database.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) return null;
  const visits = getDocVisits(database, job.document_id);
  const assignments = database.prepare(`
    SELECT ja.id, ja.date, ja.employee_id,
           e.first_name || ' ' || e.last_name AS employee_name
    FROM job_assignments ja
    LEFT JOIN employees e ON e.id = ja.employee_id
    WHERE ja.job_id = ? ORDER BY ja.date
  `).all(jobId);
  // attach per-day times + conflict flag
  for (const a of assignments) {
    a.times = logic.timesForDate(visits, a.date);
    if (a.employee_id != null) {
      const existing = database.prepare(
        "SELECT start_time FROM appointments WHERE employee_id=? AND status IN ('scheduled','completed')"
      ).all(a.employee_id).map(r => r.start_time);
      a.conflict = logic.hasConflict(existing, a.date);
    } else {
      a.conflict = false;
    }
  }
  return { job, visits, assignments, fill: logic.fillStatus(assignments) };
}

function createJobForDocument(database, { customer_id, document_id }) {
  const existing = database.prepare('SELECT id FROM jobs WHERE document_id=?').get(document_id);
  if (existing) return getJobView(database, existing.id);
  const visits = getDocVisits(database, document_id);
  const dates = logic.uniqueDates(visits);
  if (!dates.length) throw new Error('proposal has no visits to staff');
  const info = database.prepare('INSERT INTO jobs (customer_id, document_id) VALUES (?, ?)').run(customer_id, document_id);
  const ins = database.prepare('INSERT INTO job_assignments (job_id, date) VALUES (?, ?)');
  const tx = database.transaction(() => { for (const d of dates) ins.run(info.lastInsertRowid, d); });
  tx();
  return getJobView(database, info.lastInsertRowid);
}

function setAssignment(database, jobId, date, employee_id) {
  database.prepare("UPDATE job_assignments SET employee_id=?, updated_at=datetime('now') WHERE job_id=? AND date=?")
    .run(employee_id, jobId, date);
  database.prepare("UPDATE jobs SET updated_at=datetime('now') WHERE id=?").run(jobId);
  return getJobView(database, jobId);
}

function assignAllOpen(database, jobId, employee_id) {
  database.prepare("UPDATE job_assignments SET employee_id=?, updated_at=datetime('now') WHERE job_id=? AND employee_id IS NULL")
    .run(employee_id, jobId);
  database.prepare("UPDATE jobs SET updated_at=datetime('now') WHERE id=?").run(jobId);
  return getJobView(database, jobId);
}

function postJob(database, jobId) {
  const view = getJobView(database, jobId);
  if (!view) throw new Error('job not found');
  if (view.job.status === 'posted') throw new Error('job already posted');
  if (!view.fill.complete) throw new Error('job not fully staffed');

  const customer = database.prepare('SELECT * FROM customers WHERE id=?').get(view.job.customer_id);
  const dog = database.prepare('SELECT id FROM dogs WHERE customer_id=? ORDER BY id LIMIT 1').get(view.job.customer_id);
  const batchId = newBatchId();
  const insAppt = database.prepare(
    'INSERT INTO appointments (customer_id, dog_id, employee_id, service_id, start_time, end_time, notes, email_sent, batch_id) VALUES (?,?,?,?,?,?,?,1,?)'
  );
  const byDate = new Map(view.assignments.map(a => [a.date, a.employee_id]));
  const tx = database.transaction(() => {
    for (const v of view.visits) {
      const emp = byDate.get(v.date);
      const t = visitToTimes(v.date, v.time);
      insAppt.run(view.job.customer_id, dog ? dog.id : null, emp, CUSTOM_CARE_SERVICE_ID, t.start_time, t.end_time, `Job #${jobId} — ${v.label}`, batchId);
    }
    database.prepare("UPDATE jobs SET status='posted', gcal_synced=0, updated_at=datetime('now') WHERE id=?").run(jobId);
  });
  tx();

  const dogNames = database.prepare('SELECT name FROM dogs WHERE customer_id=?').all(view.job.customer_id).map(d => d.name).join(', ');
  const walkerSummary = logic.buildWalkerSummary(
    view.assignments, view.visits,
    { customerName: `${customer.first_name} ${customer.last_name}`, dogNames }
  );
  return { ok: true, batch_id: batchId, walkerSummary, gcal_pending: true };
}

// ---- HTTP wrappers (use the shared db) ----
router.post('/jobs', requireRole('admin'), (req, res) => {
  try {
    const { customer_id, document_id } = req.body;
    if (!customer_id || !document_id) return res.status(400).json({ error: 'customer_id and document_id required' });
    res.json(createJobForDocument(db, { customer_id, document_id }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/jobs/by-document/:documentId', requireRole('admin'), (req, res) => {
  const row = db.prepare('SELECT id FROM jobs WHERE document_id=?').get(req.params.documentId);
  if (!row) return res.json(null);
  res.json(getJobView(db, row.id));
});

router.get('/jobs/:id', requireRole('admin'), (req, res) => {
  const view = getJobView(db, req.params.id);
  if (!view) return res.status(404).json({ error: 'not found' });
  res.json(view);
});

router.patch('/jobs/:id/assignments', requireRole('admin'), (req, res) => {
  try {
    const { date, employee_id } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    res.json(setAssignment(db, req.params.id, date, employee_id ?? null));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/jobs/:id/assign-all', requireRole('admin'), (req, res) => {
  try {
    const { employee_id } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    res.json(assignAllOpen(db, req.params.id, employee_id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/jobs/:id/post', requireRole('admin'), (req, res) => {
  try { res.json(postJob(db, req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
module.exports._internals = { createJobForDocument, getJobView, setAssignment, assignAllOpen, postJob, visitToTimes };
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd /opt/barkstroll && node --test test/jobs-routes.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Mount the router**

In `server.js`, after line 419 (`...require('./routes/employee-documents'))`), add:
```js
app.use('/admin/api', adminOnly, require('./routes/jobs'));
```
Verify: `cd /opt/barkstroll && node --check server.js && echo OK` → `OK`.

- [ ] **Step 6: Commit**

```bash
cd /opt/barkstroll
git add routes/jobs.js server.js test/jobs-routes.test.js
git diff --cached --stat
git commit -m "job staffing: jobs API (create/get/assign/assign-all/post) + silent appointment creation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — Job panel on the customer card

**Files:**
- Create: `public/js/views/jobs-panel.js`
- Modify: `public/app.html` (load the new script)
- Modify: `public/js/views/customers.js` (add "Staff this job" per proposal + a panel mount point)

- [ ] **Step 1: Confirm how view scripts are loaded**

Run: `cd /opt/barkstroll && grep -n "views/.*\.js" public/app.html | head`
Expected: a list of `<script src="/admin/static/js/views/*.js">` tags. You'll add `jobs-panel.js` alongside them.

- [ ] **Step 2: Add the "Staff this job" button + panel container in customers.js**

In `public/js/views/customers.js`, in the documents list map (~line 332), give proposals a Staff button. Change the `doc-actions` block to include, for proposals only:
```js
            ${d.type === 'proposal' ? `<button class="btn btn-outline btn-sm" onclick="openJobPanel(${customerId}, ${d.id})">🗂 Staff this job</button>` : ''}
```
And add an empty mount point right after the Documents section's closing `</div>` (before the section's final return backtick close):
```html
      <div id="jobPanelMount"></div>
```
Verify the file still parses: `cd /opt/barkstroll && node --check public/js/views/customers.js && echo OK` → `OK`.

- [ ] **Step 3: Implement `public/js/views/jobs-panel.js`**

```js
// Job staffing panel — rendered into #jobPanelMount on the customer card.
// Uses the global api(), toast(), esc() helpers from app.js.
let _jobState = { customerId: null, documentId: null, view: null, employees: [] };

async function openJobPanel(customerId, documentId) {
  _jobState.customerId = customerId;
  _jobState.documentId = documentId;
  try {
    if (!_jobState.employees.length) _jobState.employees = await api('/employees');
    let view = await api('/jobs/by-document/' + documentId);
    if (!view) view = await api('/jobs', { method: 'POST', body: { customer_id: customerId, document_id: documentId } });
    _jobState.view = view;
    renderJobPanel();
    document.getElementById('jobPanelMount').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast('Could not open job: ' + e.message, 'err'); }
}

function walkerOptions(selected) {
  const opts = ['<option value="">— open —</option>'];
  for (const e of _jobState.employees.filter(e => e.active)) {
    const name = esc(e.first_name + ' ' + e.last_name);
    opts.push(`<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${name}</option>`);
  }
  return opts.join('');
}

function renderJobPanel() {
  const mount = document.getElementById('jobPanelMount');
  if (!mount || !_jobState.view) return;
  const { job, assignments, fill } = _jobState.view;
  const posted = job.status === 'posted';

  const rows = assignments.map(a => `
    <div class="job-day" style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #eee">
      <div style="width:120px;font-weight:600">${esc(fmtJobDate(a.date))}</div>
      <div style="flex:1;color:#666;font-size:13px">${esc((a.times || []).join(' · '))}</div>
      <div>
        ${posted
          ? `<span>${esc(a.employee_name || '—')}</span>`
          : `<select onchange="assignDay('${a.date}', this.value)" style="padding:4px">${walkerOptions(a.employee_id)}</select>`}
      </div>
      <div style="width:24px;text-align:center">${a.employee_id ? (a.conflict ? '<span title="This walker has another visit that day">⚠️</span>' : '✓') : ''}</div>
    </div>
  `).join('');

  const bulk = posted ? '' : `
    <div style="margin:8px 0;display:flex;gap:8px;align-items:center">
      <span style="font-size:13px;color:#666">Assign all open days to:</span>
      <select id="bulkWalker" style="padding:4px">${walkerOptions(null)}</select>
      <button class="btn btn-outline btn-sm" onclick="assignAllOpen()">Apply</button>
    </div>`;

  mount.innerHTML = `
    <div class="detail-section" style="margin-top:14px;border:1px solid #e2ddd5;border-radius:6px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="detail-section-title">🗂 Job — ${posted ? 'Posted ✓' : 'Staffing'}</span>
        <span style="font-size:13px;color:${fill.complete ? '#3a5c3a' : '#a06b00'}">${fill.filled} of ${fill.total} days · ${fill.percent}%</span>
      </div>
      <div style="height:6px;background:#eee;border-radius:3px;overflow:hidden;margin-bottom:10px">
        <div style="height:100%;width:${fill.percent}%;background:${fill.complete ? '#3a5c3a' : '#c8a84b'}"></div>
      </div>
      ${bulk}
      ${rows}
      ${posted
        ? `<p style="margin-top:10px;color:#3a5c3a;font-size:13px">Appointments created. Google Calendar sync pending (push via connector).</p>`
        : `<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center">
             <span style="font-size:13px;color:#666">${fill.open ? fill.open + ' day(s) still open' : 'All days staffed — ready to post'}</span>
             <button class="btn btn-primary btn-sm" onclick="postJob()" ${fill.complete ? '' : 'disabled'}>Post job →</button>
           </div>`}
    </div>`;
}

function fmtJobDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

async function assignDay(date, value) {
  try {
    _jobState.view = await api('/jobs/' + _jobState.view.job.id + '/assignments', {
      method: 'PATCH', body: { date, employee_id: value ? Number(value) : null },
    });
    renderJobPanel();
  } catch (e) { toast('Assign failed: ' + e.message, 'err'); }
}

async function assignAllOpen() {
  const v = document.getElementById('bulkWalker').value;
  if (!v) { toast('Pick a walker first', 'err'); return; }
  try {
    _jobState.view = await api('/jobs/' + _jobState.view.job.id + '/assign-all', { method: 'POST', body: { employee_id: Number(v) } });
    renderJobPanel();
  } catch (e) { toast('Assign-all failed: ' + e.message, 'err'); }
}

async function postJob() {
  if (!confirm('Post this job? This creates the appointments. Walkers will be summarized for you to text.')) return;
  try {
    const result = await api('/jobs/' + _jobState.view.job.id + '/post', { method: 'POST', body: {} });
    _jobState.view = await api('/jobs/' + _jobState.view.job.id);
    renderJobPanel();
    showWalkerSummary(result.walkerSummary);
    toast('Job posted — appointments created');
  } catch (e) { toast('Post failed: ' + e.message, 'err'); }
}

function showWalkerSummary(summary) {
  const lines = (summary || []).map(w => {
    const days = w.days.map(d => `  ${fmtJobDate(d.date)}: ${d.times.join(', ')}`).join('\n');
    return `${w.employee_name}:\n${days}`;
  }).join('\n\n');
  const text = `Bark & Stroll — walker assignments\n\n${lines}`;
  const mount = document.getElementById('jobPanelMount');
  const box = document.createElement('div');
  box.className = 'detail-section';
  box.style = 'margin-top:10px;border:1px solid #c8a84b;border-radius:6px;padding:12px';
  box.innerHTML = `<div class="detail-section-title">📋 Walker summary (copy &amp; text to each walker)</div>
    <textarea readonly style="width:100%;height:160px;margin-top:8px;font-family:monospace;font-size:12px">${esc(text)}</textarea>`;
  mount.appendChild(box);
}
```

- [ ] **Step 4: Load the script in app.html**

In `public/app.html`, alongside the other `views/*.js` script tags, add:
```html
<script src="/admin/static/js/views/jobs-panel.js"></script>
```
Verify it's referenced: `cd /opt/barkstroll && grep -c "jobs-panel.js" public/app.html` → `1`.

- [ ] **Step 5: Syntax-check the new JS**

Run: `cd /opt/barkstroll && node --check public/js/views/jobs-panel.js && node --check public/js/views/customers.js && echo OK`
Expected: `OK`.

- [ ] **Step 6: Restart + manual smoke (Scott)**

```bash
cd /opt/barkstroll && systemctl restart barkstroll.service && sleep 2 && systemctl is-active barkstroll.service
```
Then hard-refresh the admin app, open Cris's customer card → Documents → her proposal shows **🗂 Staff this job** → click → the Job panel shows 6 days (Jul 16–21) with walker dropdowns and a 0% meter. Assign Tiffany→16, Scott→18,19; "Assign all open days" → Scott; meter hits 100%; **Post job** enabled → click → appointments created, walker summary box appears.

- [ ] **Step 7: Commit**

```bash
cd /opt/barkstroll
git add public/js/views/jobs-panel.js public/js/views/customers.js public/app.html
git diff --cached --stat
git commit -m "job staffing: Job panel on customer card (assign, fill meter, post, walker summary)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full verification + cleanup

**Files:** none (verification)

- [ ] **Step 1: Full suite green**

Run: `cd /opt/barkstroll && npm test 2>&1 | tail -25`
Expected: all tests pass — the new `jobs-migration` (3), `jobs-logic` (5), `jobs-routes` (7) plus all pre-existing suites. No regressions.

- [ ] **Step 2: Live endpoint smoke over HTTPS (real DB)**

```bash
cd /opt/barkstroll
node -e "const db=require('./lib/db'); const j=require('./routes/jobs')._internals; const v=j.createJobForDocument(db,{customer_id:20,document_id:(db.prepare(\"SELECT id FROM documents WHERE customer_id=20 AND doc_number='#BBS-2026-0716'\").get().id)}); console.log('job', v.job.id, 'days', v.assignments.length, 'fill', v.fill.percent+'%');"
```
Expected: `job <id> days 6 fill 0%` (Cris's real proposal → 6 day-rows). This proves the real backfilled `visits_json` drives the job.

- [ ] **Step 3: Confirm no stray appointments were created during smoke**

```bash
cd /opt/barkstroll && node -e "const db=require('./lib/db'); console.log('cris appts', db.prepare('SELECT COUNT(*) n FROM appointments WHERE customer_id=20').get().n);"
```
Expected: unchanged from before (the smoke only created a draft job, never posted). If a test job row was created in the live DB, remove it:
```bash
node -e "const db=require('./lib/db'); const r=db.prepare('SELECT id FROM jobs WHERE customer_id=20').get(); if(r){db.prepare('DELETE FROM job_assignments WHERE job_id=?').run(r.id); db.prepare('DELETE FROM jobs WHERE id=?').run(r.id); console.log('cleaned test job', r.id);} else console.log('no test job');"
```
(The real job gets created fresh by Scott from the UI.)

- [ ] **Step 4: WIP hygiene audit**

```bash
cd /opt/barkstroll
git status --short
git log --oneline -7
```
Confirm only intended files were committed across Tasks 1–5 (`migrate-jobs.js`, `lib/jobs-logic.js`, `routes/jobs.js`, `routes/documents.js`, `server.js`, `backfill-cris-visits.js`, `public/js/views/jobs-panel.js`, `public/js/views/customers.js`, `public/app.html`, plus the three test files) — no unrelated WIP swept in.

- [ ] **Step 5: Commit the plan doc**

```bash
cd /opt/barkstroll
git add docs/superpowers/plans/2026-05-30-job-staffing.md
git commit -m "job staffing: implementation plan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes (author)

- **Spec coverage:** "Staff this job" from proposal ✓ (T5). visits_json on documents ✓ (T1 col, T3 persist+backfill). jobs/job_assignments tables ✓ (T1). Whole-day assignment ✓ (one row per date, T4). Bulk assign-all ✓ (T4 `assignAllOpen`, T5 UI). Fill meter ✓ (T2 `fillStatus`, T5). Post gate (100% + explicit click) ✓ (T4 `postJob` throws <100%; T5 button disabled + confirm). Walker summary to Scott ✓ (T2 `buildWalkerSummary`, T4 returns it, T5 copy box). Conflict warn-but-allow ✓ (T2 `hasConflict`, T4 flags, T5 ⚠ but select still works). Custom Care service ✓ (T4 const 5). GCal pending flag ✓ (T4 `gcal_synced=0`, T5 note). Draft persistence ✓ (status stays 'draft', nothing expires). Job on customer card ✓ (T5 mount).
- **Deliberate spec deviation:** Post creates appointments with `email_sent=1` (silent) and does NOT auto-email client/walkers (spec's "sends ICS" line). Rationale: Cris unconfirmed + walkers route through Scott. Notification = Scott summary, matching the locked decision. Flagged here and in Pre-flight.
- **Placeholder scan:** none — every step has full code/commands.
- **Type consistency:** `_internals` names (`createJobForDocument`, `getJobView`, `setAssignment`, `assignAllOpen`, `postJob`, `visitToTimes`) match between T4 impl and test. `fillStatus` shape (`total/filled/open/percent/complete`) consistent T2↔T4↔T5. visit shape `{date,time,label}` consistent throughout. Frontend fns (`openJobPanel`, `assignDay`, `assignAllOpen`, `postJob`, `showWalkerSummary`) all defined in T5 and referenced from the rendered HTML.
- **Risk RESOLVED (verified):** `visitToTimes` stores the literal wall-clock time as a `Z` ISO with no tz conversion. Confirmed this matches the existing booking convention at `public/js/views/calendar.js:180` — comment: "build ISO timestamp, local-naive (no tz suffix conversion); matches existing data: 'YYYY-MM-DDTHH:MM:00.000Z'", building `startISO = ` + "`${dateStr}T${pad(h)}:${pad(min)}:00.000Z`". So "3:00 PM" → `...T15:00:00.000Z`, consistent with all existing appointments. No tz bug; do NOT add tz math.
- **WIP:** B&S tree is dirty; every task stages only its named files.
