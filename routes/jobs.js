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

// Convert an ET wall-clock date ('YYYY-MM-DD') + h/min to the true UTC instant,
// honoring DST. The browser-driven create paths already send correct UTC ISO
// strings; this is the only server-side wall-clock construction, so it must do
// the ET->UTC math itself. (The old code appended a literal 'Z' to the local
// digits, mislabeling ET as UTC — every emailed/rendered time came out 4-5h off.)
function etWallClockToUtc(date, h, min) {
  const [y, mo, d] = String(date).split('-').map(Number);
  const guessUtc = Date.UTC(y, mo - 1, d, h, min, 0); // wall clock read as if UTC
  const etWall = new Date(guessUtc).toLocaleString('en-US', { timeZone: 'America/New_York' });
  const offset = guessUtc - new Date(etWall).getTime(); // actual ET offset for this date (DST-aware)
  return new Date(guessUtc + offset);
}

// Compute a visit's start/end ISO from its date + "8:00 AM" time string (treated as ET wall-clock).
function visitToTimes(date, time) {
  const m = String(time).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let h = m ? parseInt(m[1], 10) % 12 : 12;
  if (m && /PM/i.test(m[3])) h += 12;
  const min = m ? parseInt(m[2], 10) : 0;
  const startDate = etWallClockToUtc(date, h, min);
  const endDate = new Date(startDate.getTime() + VISIT_MINUTES * 60000);
  return { start_time: startDate.toISOString(), end_time: endDate.toISOString() };
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
  // `id` is exposed at the top level (alias of job.id) so callers can use the view
  // directly as the job handle; `job`/`visits`/`assignments`/`fill` keep the full shape.
  return { id: job.id, job, visits, assignments, fill: logic.fillStatus(assignments) };
}

function createJobForDocument(database, { customer_id, document_id }) {
  const visits = getDocVisits(database, document_id);
  const dates = logic.uniqueDates(visits);
  if (!dates.length) throw new Error('proposal has no visits to staff');

  const existing = database.prepare('SELECT id, status FROM jobs WHERE document_id=?').get(document_id);
  if (existing) {
    // One job per document (idempotent on identity): re-creating returns the SAME job row,
    // re-synced to the proposal's current day-set (fresh draft) so re-opening the staffing
    // panel never duplicates the job or carries a stale day list. Any appointments a prior
    // Post created are left intact; the job row itself reverts to a re-staffable draft.
    const ins = database.prepare('INSERT INTO job_assignments (job_id, date) VALUES (?, ?)');
    const tx = database.transaction(() => {
      database.prepare('DELETE FROM job_assignments WHERE job_id=?').run(existing.id);
      for (const d of dates) ins.run(existing.id, d);
      database.prepare("UPDATE jobs SET status='draft', updated_at=datetime('now') WHERE id=?").run(existing.id);
    });
    tx();
    return getJobView(database, existing.id);
  }

  const info = database.prepare('INSERT INTO jobs (customer_id, document_id) VALUES (?, ?)').run(customer_id, document_id);
  const ins = database.prepare('INSERT INTO job_assignments (job_id, date) VALUES (?, ?)');
  const tx = database.transaction(() => { for (const d of dates) ins.run(info.lastInsertRowid, d); });
  tx();
  return getJobView(database, info.lastInsertRowid);
}

// Normalize an incoming employee_id to either a valid positive integer or null.
// Guards against a malformed 0/"" sneaking in: 0 would satisfy `IS NOT NULL` and
// falsely mark a day "filled" with a non-existent walker, then post appointments
// with employee_id=0. Anything not a positive integer becomes null (= open).
function normalizeEmployeeId(employee_id) {
  const n = Number(employee_id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function setAssignment(database, jobId, date, employee_id) {
  const emp = normalizeEmployeeId(employee_id);
  database.prepare("UPDATE job_assignments SET employee_id=?, updated_at=datetime('now') WHERE job_id=? AND date=?")
    .run(emp, jobId, date);
  database.prepare("UPDATE jobs SET updated_at=datetime('now') WHERE id=?").run(jobId);
  return getJobView(database, jobId);
}

function assignAllOpen(database, jobId, employee_id) {
  const emp = normalizeEmployeeId(employee_id);
  if (emp == null) throw new Error('a valid walker is required');
  database.prepare("UPDATE job_assignments SET employee_id=?, updated_at=datetime('now') WHERE job_id=? AND employee_id IS NULL")
    .run(emp, jobId);
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
